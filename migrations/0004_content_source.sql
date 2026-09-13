ALTER TABLE content_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE content_items ADD COLUMN source_id TEXT NOT NULL DEFAULT '';
-- Only GitHub-sourced rows carry a source_id; manual rows keep '' and must
-- not collide with each other, hence the partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_source ON content_items (source_type, source_id) WHERE source_id != '';
CREATE INDEX IF NOT EXISTS idx_content_items_source_lookup ON content_items (source_type, source_id);
