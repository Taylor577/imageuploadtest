/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
//export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
//export const up = (pgm) => {};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
//export const down = (pgm) => {};

export async function up(pgm) {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE allowed_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE photos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      original_object_key TEXT NOT NULL,
      thumbnail_object_key TEXT NOT NULL,
      uploaded_by UUID NOT NULL REFERENCES allowed_users(id) ON DELETE RESTRICT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE original_photo_metadata (
      photo_id UUID PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      original_mime_type TEXT NOT NULL,
      stored_mime_type TEXT NOT NULL,
      file_size_bytes BIGINT NOT NULL,
      width INTEGER,
      height INTEGER
    );

    CREATE TABLE tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT tags_normalized_name_not_blank
        CHECK (length(trim(normalized_name)) > 0)
    );

    CREATE TABLE photo_tags (
      photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (photo_id, tag_id)
    );

    CREATE INDEX photos_uploaded_at_idx ON photos(uploaded_at);
    CREATE INDEX photos_uploaded_by_idx ON photos(uploaded_by);
    CREATE INDEX photo_tags_photo_id_idx ON photo_tags(photo_id);
    CREATE INDEX photo_tags_tag_id_idx ON photo_tags(tag_id);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP TABLE IF EXISTS photo_tags;
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS original_photo_metadata;
    DROP TABLE IF EXISTS photos;
    DROP TABLE IF EXISTS allowed_users;
  `);
}