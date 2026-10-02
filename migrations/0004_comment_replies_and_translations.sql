-- 0004: comment replies (self-referencing parent_id) + AI translation cache.
-- Applied in production with:
--   npx wrangler d1 execute about-comments --file migrations/0004_comment_replies_and_translations.sql --remote

-- Comment replies: a NULL parent_id marks a top-level comment. Deleting a
-- parent cascades to all descendants (WITH RECURSIVE) in worker.js.
ALTER TABLE comments ADD COLUMN parent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);

-- AI translation cache. chunk_hash is content-addressed (sha256 of the Chinese
-- source text), so copy changes naturally produce new hashes while stale rows
-- are removed by the 31-day language cleanup. Cached entirely in D1 because
-- the free KV tier only allows 1,000 writes/day.
CREATE TABLE IF NOT EXISTS translations (
  lang TEXT NOT NULL,
  chunk_hash TEXT NOT NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (lang, chunk_hash)
);

-- Per-language usage tracking for the one-month stale-language cleanup.
-- last_used_at is touched at most once per 10 minutes per language per
-- isolate to keep D1 writes minimal.
CREATE TABLE IF NOT EXISTS translation_lang_usage (
  lang TEXT PRIMARY KEY,
  last_used_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);
