const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const fs = require("fs");

const app = express();
const upload = multer({ dest: "uploads/" });

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

const s3Client = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_KEY,
    secretAccessKey: S3_SECRET
  },
  forcePathStyle: true
});

app.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");

  const fileStream = fs.createReadStream(req.file.path);
  const key = `${Date.now()}-${req.file.originalname}`;

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileStream,
      ContentType: req.file.mimetype
    }));

    // Remove temp file
    fs.unlink(req.file.path, () => {});

    res.json({ success: true, key });
  } catch (err) {
    console.error("Upload error", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});
