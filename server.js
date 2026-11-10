const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand, PutObjectTaggingCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const fs = require("fs");

const app = express();
const upload = multer({ dest: "uploads/" });

const { ListObjectsV2Command, GetObjectCommand, GetObjectTaggingCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

app.use(express.static(path.join(__dirname, "public")));

// Read S3-compatible config from env
const S3_ENDPOINT = process.env.RAILWAY_STORAGE_ENDPOINT || process.env.S3_ENDPOINT;
const S3_REGION = process.env.RAILWAY_STORAGE_REGION || process.env.AWS_REGION || "us-east-1";
const S3_KEY = process.env.RAILWAY_STORAGE_KEY || process.env.AWS_ACCESS_KEY_ID;
const S3_SECRET = process.env.RAILWAY_STORAGE_SECRET || process.env.AWS_SECRET_ACCESS_KEY;
const S3_BUCKET = process.env.RAILWAY_STORAGE_BUCKET || process.env.S3_BUCKET;

if (!S3_ENDPOINT || !S3_KEY || !S3_SECRET || !S3_BUCKET) {
  console.warn("Warning: Missing S3 configuration. Set RAILWAY_STORAGE_ENDPOINT, RAILWAY_STORAGE_KEY, RAILWAY_STORAGE_SECRET, and RAILWAY_STORAGE_BUCKET.");
}

const TEMP_UPLOADER_EMAIL = "countingstars897@gmail.com";

const s3Client = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_KEY,
    secretAccessKey: S3_SECRET
  },
  forcePathStyle: true
});

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});



app.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded." });

  const client = await pool.connect();
  const tags = normalizeTags(req.body?.tags || "");
  //const uploaderEmail = req.body?.uploaderEmail || "unknown@example.com";
  const uploaderEmail = TEMP_UPLOADER_EMAIL;
  const originalKey = `${Date.now()}-${req.file.originalname}`;
  const thumbnailKey = originalKey;
  const fileStream = fs.createReadStream(req.file.path);

  try {
    await client.query("BEGIN");

    // TEMPORARILY IGNORING THIS BECAUSE AUTHORIZATION IS INCOMPLETE
    /*
    // 1. Look up the allowed uploader
    const userResult = await client.query(
      `SELECT id FROM allowed_users WHERE email = $1`,
      [uploaderEmail]
    );


    
    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        error: "Uploader is not allowed"
      });
      
    }
    

    const uploadedBy = userResult.rows[0].id;
    */
    const userResult = await client.query(
      `SELECT id FROM allowed_users WHERE email = $1`,
      [uploaderEmail]
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(500).json({
        success: false,
        error: `Seed uploader ${uploaderEmail} does not exist`
      });
    }

    const uploadedBy = userResult.rows[0].id;

    // 2. Upload original image to R2/S3
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: originalKey,
      Body: fileStream,
      ContentType: req.file.mimetype
    }));

    // 3. Save the photo row
    const photoResult = await client.query(`
      INSERT INTO photos (
        original_object_key,
        thumbnail_object_key,
        uploaded_by
      ) VALUES ($1, $2, $3)
      RETURNING id
    `, [originalKey, thumbnailKey, uploadedBy]);

    const photoId = photoResult.rows[0].id;

    // 4. Save metadata row
    await client.query(`
      INSERT INTO original_photo_metadata (
        photo_id,
        original_filename,
        original_mime_type,
        stored_mime_type,
        file_size_bytes,
        width,
        height
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      photoId,
      req.file.originalname,
      req.file.mimetype,
      req.file.mimetype,
      req.file.size,
      null,
      null
    ]);

    // 5. Insert tags and photo_tags
    for (const tag of tags) {
      await client.query(`
        INSERT INTO tags (display_name, normalized_name)
        VALUES ($1, $2)
        ON CONFLICT (normalized_name) DO NOTHING
      `, [tag, tag]);

      await client.query(`
        INSERT INTO photo_tags (photo_id, tag_id)
        SELECT $1, t.id
        FROM tags t
        WHERE t.normalized_name = $2
        ON CONFLICT DO NOTHING
      `, [photoId, tag]);
    }

    await client.query("COMMIT");

    fs.unlink(req.file.path, () => { });

    res.json({
      success: true,
      photoId,
      key: originalKey,
      tags
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Upload error", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    client.release();
  }
});

function normalizeTags(raw = "") {
  return [...new Set(
    raw
      .split(",")
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean)
  )];
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});


app.get("/api/gallery", async (req, res) => {
  try {
    const tags = normalizeTags(req.query.tags || "");
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);

    let sql = `
      SELECT
        p.id,
        p.original_object_key,
        p.uploaded_at,
        COALESCE(
          json_agg(DISTINCT t.display_name ORDER BY t.display_name)
          FILTER (WHERE t.display_name IS NOT NULL),
          '[]'::json
        ) AS tags
      FROM photos p
      LEFT JOIN photo_tags pt ON pt.photo_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
    `;

    const params = [];
    if (tags.length) {
      sql += `
        WHERE EXISTS (
          SELECT 1
          FROM photo_tags pt2
          JOIN tags t2 ON t2.id = pt2.tag_id
          WHERE pt2.photo_id = p.id
          AND t2.normalized_name = ANY($1)
        )
      `;
      params.push(tags);
    }

    sql += `
      GROUP BY p.id, p.original_object_key, p.uploaded_at
      ORDER BY p.uploaded_at DESC
      LIMIT $${params.length + 1}
    `;

    params.push(limit);

    const result = await pool.query(sql, params);

    const items = await Promise.all(result.rows.map(async (row) => {
      const getCmd = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: row.original_object_key
      });

      const url = await getSignedUrl(s3Client, getCmd, { expiresIn: 3600 });

      return {
        id: row.id,
        key: row.original_object_key,
        url,
        uploadedAt: row.uploaded_at,
        tags: row.tags || []
      };
    }));

    res.json({ success: true, items });
  } catch (err) {
    console.error("Gallery query error", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/photo/:id", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.original_object_key,
        p.uploaded_at,
        u.email AS uploader_email,
        COALESCE(
          json_agg(DISTINCT t.display_name ORDER BY t.display_name)
          FILTER (WHERE t.display_name IS NOT NULL),
          '[]'::json
        ) AS tags
      FROM photos p
      LEFT JOIN allowed_users u ON u.id = p.uploaded_by
      LEFT JOIN photo_tags pt ON pt.photo_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      WHERE p.id = $1
      GROUP BY p.id, u.email
    `, [req.params.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Photo not found" });
    }

    const row = result.rows[0];
    const getCmd = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: row.original_object_key
    });

    const url = await getSignedUrl(s3Client, getCmd, { expiresIn: 3600 });

    res.json({
      success: true,
      photo: {
        id: row.id,
        key: row.original_object_key,
        url,
        uploadedAt: row.uploaded_at,
        uploader: row.uploader_email,
        tags: row.tags || []
      }
    });
  } catch (err) {
    console.error("Photo fetch error", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/view", (req, res) => {
  const key = req.query.id;
  if (!key) return res.status(400).send("Missing key");

  // Redirect to the static HTML page, passing the key along
  res.redirect(`/view.html?id=${encodeURIComponent(key)}`);
});


app.get("/presign", async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: "Missing key" });

  try {
    const getCmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const url = await getSignedUrl(s3Client, getCmd, { expiresIn: 3600 });

    res.json({ url });
  } catch (err) {
    console.error("Presign error", err);
    res.status(500).json({ error: "Failed to generate presigned URL" });
  }
});


app.delete('/photos/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      'DELETE FROM photos WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const photo = result.rows[0];

    await s3Client.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: photo.original_object_key
    }));

    return res.status(200).json({ deleted: photo });
  } catch (err) {
    console.error('Delete error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});