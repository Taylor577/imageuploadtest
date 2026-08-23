# Run this in C:\projects\imageuploader
# Creates files and folders for the minimal Railway image uploader project.

$ErrorActionPreference = 'Stop'

# Ensure base folder exists
$base = Get-Location

# Create folders
New-Item -Path "$base\public" -ItemType Directory -Force | Out-Null
New-Item -Path "$base\uploads" -ItemType Directory -Force | Out-Null

# package.json
@'
{
  "name": "imageuploader",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "express": "^4.18.2",
    "multer": "^1.4.5"
  }
}
'@ | Out-File -FilePath "$base\package.json" -Encoding utf8 -Force

# server.js
@'
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
'@ | Out-File -FilePath "$base\server.js" -Encoding utf8 -Force

# public/index.html
@'
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Image Uploader</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; }
    .preview { margin-top: 1rem; max-width: 400px; }
  </style>
</head>
<body>
  <h1>Upload an Image</h1>
  <form id="uploadForm">
    <input type="file" name="image" id="imageInput" accept="image/*" required />
    <button type="submit">Upload</button>
  </form>

  <div id="result"></div>

  <script>
    const form = document.getElementById('uploadForm');
    const result = document.getElementById('result');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('imageInput');
      if (!input.files.length) return;

      const fd = new FormData();
      fd.append('image', input.files[0]);

      result.textContent = 'Uploading...';

      try {
        const resp = await fetch('/upload', { method: 'POST', body: fd });
        const data = await resp.json();
        if (data.success) {
          result.innerHTML = '<strong>Upload successful</strong><br/>Key: ' + data.key;
        } else {
          result.textContent = 'Upload failed: ' + (data.error || 'unknown');
        }
      } catch (err) {
        result.textContent = 'Upload error: ' + err.message;
      }
    });
  </script>
</body>
</html>
'@ | Out-File -FilePath "$base\public\index.html" -Encoding utf8 -Force

# .gitignore
@'
node_modules/
uploads/
.env
'@ | Out-File -FilePath "$base\.gitignore" -Encoding utf8 -Force

# Procfile
@'
web: node server.js
'@ | Out-File -FilePath "$base\Procfile" -Encoding utf8 -Force

# README.md
@'
# Image Uploader

Minimal Node.js app to upload images to a Railway storage bucket (S3-compatible).

## Required environment variables
- **RAILWAY_STORAGE_ENDPOINT** - S3-compatible endpoint URL provided by Railway.
- **RAILWAY_STORAGE_KEY** - Access key.
- **RAILWAY_STORAGE_SECRET** - Secret key.
- **RAILWAY_STORAGE_BUCKET** - Bucket name.
- **PORT** - optional, Railway sets this automatically.

## Run locally
1. `npm install`
2. Set env vars locally (e.g., via `.env` or your shell).
3. `npm start`

## Deploy to Railway
Create a new Railway project, connect your repo, and set the environment variables in Railway project settings. Railway storage exposes S3-compatible credentials and endpoint which you should copy into the variables above.
'@ | Out-File -FilePath "$base\README.md" -Encoding utf8 -Force

Write-Host "Files and folders created in $base"
