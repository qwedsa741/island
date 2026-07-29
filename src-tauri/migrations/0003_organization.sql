CREATE TABLE IF NOT EXISTS smart_views (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    rules_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id, item_id);
