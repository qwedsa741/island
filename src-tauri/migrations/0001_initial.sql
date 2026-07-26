PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY NOT NULL,
    item_type TEXT NOT NULL CHECK (
        item_type IN ('file', 'pdf', 'image', 'text', 'markdown', 'url')
    ),
    title TEXT NOT NULL,
    original_name TEXT,
    source_url TEXT,
    source_app TEXT,
    local_path TEXT,
    original_path TEXT,
    mime_type TEXT,
    file_size INTEGER,
    content_hash TEXT,
    notes TEXT NOT NULL DEFAULT '',
    plain_text TEXT,
    status TEXT NOT NULL CHECK (
        status IN ('importing', 'ready', 'processing', 'failed', 'trashed')
    ),
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    storage_mode TEXT NOT NULL DEFAULT 'managed' CHECK (
        storage_mode IN ('managed', 'referenced')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT,
    deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_content_hash
    ON items(content_hash)
    WHERE content_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source_url
    ON items(source_url)
    WHERE item_type = 'url' AND source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_deleted_at ON items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_tags (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('manual', 'rule', 'ai')),
    confidence REAL,
    PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS metadata (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(item_id, key)
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
    ),
    progress REAL NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    item_id UNINDEXED,
    title,
    original_name,
    source_url,
    notes,
    plain_text,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS items_fts_after_insert
AFTER INSERT ON items
BEGIN
    INSERT INTO items_fts(
        rowid, item_id, title, original_name, source_url, notes, plain_text
    ) VALUES (
        new.rowid, new.id, new.title, new.original_name, new.source_url,
        new.notes, new.plain_text
    );
END;

CREATE TRIGGER IF NOT EXISTS items_fts_after_delete
AFTER DELETE ON items
BEGIN
    DELETE FROM items_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS items_fts_after_update
AFTER UPDATE OF title, original_name, source_url, notes, plain_text ON items
BEGIN
    DELETE FROM items_fts WHERE rowid = old.rowid;
    INSERT INTO items_fts(
        rowid, item_id, title, original_name, source_url, notes, plain_text
    ) VALUES (
        new.rowid, new.id, new.title, new.original_name, new.source_url,
        new.notes, new.plain_text
    );
END;
