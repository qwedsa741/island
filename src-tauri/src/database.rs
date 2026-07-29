use std::{path::Path, str::FromStr, time::Duration};

use anyhow::{Context, Result};
use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    QueryBuilder, Sqlite, SqlitePool,
};

use crate::models::{Item, ItemPage, LibraryStats, SearchQuery};

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub const ITEM_COLUMNS: &str = r#"
    id, item_type, title, original_name, source_url, source_app, local_path,
    original_path, mime_type, file_size, content_hash, notes, plain_text,
    status, is_favorite, storage_mode, created_at, updated_at, last_opened_at,
    deleted_at
"#;

pub async fn connect(path: &Path) -> Result<SqlitePool> {
    let url = format!("sqlite://{}", path.to_string_lossy().replace('\\', "/"));
    let options = SqliteConnectOptions::from_str(&url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .busy_timeout(Duration::from_secs(10));
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .with_context(|| format!("无法打开数据库 {}", path.display()))?;
    MIGRATOR.run(&pool).await?;
    Ok(pool)
}

pub async fn integrity_check(pool: &SqlitePool) -> Result<()> {
    let result: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(pool)
        .await?;
    anyhow::ensure!(result == "ok", "数据库完整性检查失败：{result}");
    Ok(())
}

pub async fn get_item(pool: &SqlitePool, id: &str) -> Result<Item> {
    let sql = format!("SELECT {ITEM_COLUMNS} FROM items WHERE id = ?");
    Ok(sqlx::query_as::<_, Item>(&sql)
        .bind(id)
        .fetch_one(pool)
        .await?)
}

pub async fn list_items(pool: &SqlitePool, search: &SearchQuery) -> Result<ItemPage> {
    let fts_query = search
        .query
        .as_deref()
        .and_then(build_fts_query)
        .filter(|value| !value.is_empty());

    let mut data =
        QueryBuilder::<Sqlite>::new(format!("SELECT {ITEM_COLUMNS} FROM items WHERE 1 = 1"));
    push_filters(&mut data, search, fts_query.as_deref());
    data.push(" ORDER BY ");
    if fts_query.is_some() {
        data.push(
            "(SELECT bm25(items_fts) FROM items_fts \
             WHERE items_fts.rowid = items.rowid AND items_fts MATCH ",
        );
        data.push_bind(fts_query.clone().unwrap_or_default());
        data.push(") ASC, ");
    }
    data.push("created_at DESC LIMIT ");
    data.push_bind(search.page_size.clamp(1, 250) as i64);
    data.push(" OFFSET ");
    let page = search.page.max(1);
    data.push_bind(((page - 1) * search.page_size.clamp(1, 250)) as i64);

    let items = data.build_query_as::<Item>().fetch_all(pool).await?;

    let mut count = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM items WHERE 1 = 1");
    push_filters(&mut count, search, fts_query.as_deref());
    let total: i64 = count.build_query_scalar().fetch_one(pool).await?;

    Ok(ItemPage { items, total })
}

fn push_filters(
    builder: &mut QueryBuilder<'_, Sqlite>,
    search: &SearchQuery,
    fts_query: Option<&str>,
) {
    if search.trashed {
        builder.push(" AND deleted_at IS NOT NULL");
    } else {
        builder.push(" AND deleted_at IS NULL");
    }

    if !search.types.is_empty() {
        builder.push(" AND item_type IN (");
        let mut separated = builder.separated(", ");
        for item_type in &search.types {
            separated.push_bind(item_type.clone());
        }
        separated.push_unseparated(")");
    }
    if let Some(favorite) = search.favorite {
        builder.push(" AND is_favorite = ");
        builder.push_bind(favorite);
    }
    if let Some(status) = &search.processing_status {
        builder.push(" AND status = ");
        builder.push_bind(status.clone());
    }
    if let Some(space_id) = &search.space_id {
        builder.push(" AND EXISTS (SELECT 1 FROM space_items WHERE space_items.item_id = items.id AND space_items.space_id = ");
        builder.push_bind(space_id.clone());
        builder.push(")");
    }
    if !search.tag_ids.is_empty() {
        builder.push(" AND items.id IN (SELECT item_id FROM item_tags WHERE tag_id IN (");
        let mut separated = builder.separated(", ");
        for tag_id in &search.tag_ids {
            separated.push_bind(tag_id.clone());
        }
        separated.push_unseparated(") GROUP BY item_id HAVING COUNT(DISTINCT tag_id) = ");
        builder.push_bind(search.tag_ids.len() as i64);
        builder.push(")");
    }
    if let Some(query) = fts_query {
        builder.push(" AND rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ");
        builder.push_bind(query.to_owned());
        builder.push(")");
    }
}

pub fn build_fts_query(raw: &str) -> Option<String> {
    let tokens: Vec<String> = raw
        .split_whitespace()
        .filter_map(|token| {
            let cleaned = token
                .trim_matches(|character: char| {
                    !character.is_alphanumeric() && character != '_' && character != '-'
                })
                .replace('"', "\"\"");
            (!cleaned.is_empty()).then(|| format!("\"{cleaned}\"*"))
        })
        .take(12)
        .collect();
    (!tokens.is_empty()).then(|| tokens.join(" AND "))
}

pub async fn stats(pool: &SqlitePool) -> Result<LibraryStats> {
    let active = sqlx::query_scalar("SELECT COUNT(*) FROM items WHERE deleted_at IS NULL")
        .fetch_one(pool)
        .await?;
    let trashed = sqlx::query_scalar("SELECT COUNT(*) FROM items WHERE deleted_at IS NOT NULL")
        .fetch_one(pool)
        .await?;
    let favorites = sqlx::query_scalar(
        "SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND is_favorite = 1",
    )
    .fetch_one(pool)
    .await?;
    let bytes_stored = sqlx::query_scalar(
        "SELECT COALESCE(SUM(file_size), 0) FROM items WHERE deleted_at IS NULL",
    )
    .fetch_one(pool)
    .await?;
    Ok(LibraryStats {
        active,
        trashed,
        favorites,
        bytes_stored,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_safe_prefix_search() {
        assert_eq!(
            build_fts_query("  rust PDF  ").as_deref(),
            Some("\"rust\"* AND \"PDF\"*")
        );
        assert_eq!(build_fts_query("***"), None);
    }
}
