CREATE TABLE IF NOT EXISTS ip_profile_rules (
  id TEXT PRIMARY KEY,
  selector TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL,
  prefix_len INTEGER NOT NULL,
  target_hostname TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ip_profile_rules_enabled_priority
ON ip_profile_rules (enabled, priority, prefix_len DESC);
