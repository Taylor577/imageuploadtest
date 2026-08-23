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
