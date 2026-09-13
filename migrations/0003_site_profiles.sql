CREATE TABLE IF NOT EXISTS site_profiles (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  profile_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_profiles_hostname ON site_profiles (hostname);

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '{}',
  subtitle TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '{}',
  cover TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_type_slug ON content_items (type, slug);
CREATE INDEX IF NOT EXISTS idx_content_items_type_enabled ON content_items (type, enabled, sort_order);

CREATE TABLE IF NOT EXISTS contact_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
