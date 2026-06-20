CREATE TABLE IF NOT EXISTS site_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  page TEXT,
  lang TEXT,
  title TEXT,
  referrer TEXT,
  ip TEXT NOT NULL DEFAULT 'unknown',
  ip_location TEXT NOT NULL DEFAULT 'Unknown location',
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_events_type_created ON site_events (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_events_path_created ON site_events (path, created_at DESC);
