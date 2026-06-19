CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT 'unknown',
  ip_location TEXT NOT NULL DEFAULT 'Unknown location',
  status TEXT NOT NULL DEFAULT 'pending',
  moderation_model TEXT,
  moderation_result TEXT,
  moderation_categories TEXT,
  moderation_reason TEXT,
  moderation_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_status_created ON comments (status, created_at DESC);

CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
