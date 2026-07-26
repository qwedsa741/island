use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use chrono::Utc;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

use crate::{
    database,
    models::{
        CaptureProgress, CaptureResult, Item, ItemPage, LibraryStats, SearchQuery, Settings,
        UpdateItemInput, UpdateSettingsInput,
    },
    storage,
};

pub struct AppState {
    pub pool: SqlitePool,
    pub data_dir: PathBuf,
    pub import_lock: Mutex<()>,
}

fn command_error(error: anyhow::Error) -> String {
    error
        .chain()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("：")
}

#[tauri::command]
pub async fn capture_files(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<CaptureResult>, String> {
    let total = paths.len();
    if total == 0 {
        return Ok(vec![]);
    }
    let _guard = state.import_lock.lock().await;
    let mut results = Vec::with_capacity(total);
    for (index, path) in paths.into_iter().enumerate() {
        let progress = CaptureProgress {
            path: path.clone(),
            index,
            total,
            stage: "copying".into(),
        };
        let _ = app.emit("capture-progress", &progress);
        match capture_one_file(&state, Path::new(&path)).await {
            Ok(result) => {
                let _ = app.emit("capture-completed", &result);
                results.push(result);
            }
            Err(error) => {
                let message = command_error(error);
                let _ = app.emit(
                    "capture-failed",
                    serde_json::json!({ "path": path, "message": message }),
                );
                return Err(message);
            }
        }
    }
    let _ = app.emit("library-changed", ());
    Ok(results)
}

async fn capture_one_file(state: &AppState, source: &Path) -> Result<CaptureResult> {
    let source = source
        .canonicalize()
        .with_context(|| format!("文件不存在：{}", source.display()))?;
    let source_for_copy = source.clone();
    let staging_dir = state.data_dir.join("cache/staging");
    let (staging_path, hash, file_size) =
        tokio::task::spawn_blocking(move || storage::copy_and_hash(&source_for_copy, &staging_dir))
            .await??;

    if let Some(existing) =
        sqlx::query_scalar::<_, String>("SELECT id FROM items WHERE content_hash = ? LIMIT 1")
            .bind(&hash)
            .fetch_optional(&state.pool)
            .await?
    {
        let _ = fs::remove_file(staging_path);
        let item = database::get_item(&state.pool, &existing).await?;
        return Ok(CaptureResult {
            item,
            duplicate: true,
        });
    }

    let (item_type, mime_type) = storage::classify_file(&source);
    let final_path = storage::final_asset_path(&state.data_dir, item_type, &hash, &source);
    if let Some(parent) = final_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if final_path.exists() {
        fs::remove_file(&staging_path)?;
    } else {
        fs::rename(&staging_path, &final_path)
            .with_context(|| format!("无法将临时文件移动到托管目录 {}", final_path.display()))?;
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let original_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名文件")
        .to_string();
    let title = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&original_name)
        .to_string();

    let insert = sqlx::query(
        r#"
        INSERT INTO items (
            id, item_type, title, original_name, local_path, original_path,
            mime_type, file_size, content_hash, status, storage_mode,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 'managed', ?, ?)
        "#,
    )
    .bind(&id)
    .bind(item_type)
    .bind(&title)
    .bind(&original_name)
    .bind(final_path.to_string_lossy().to_string())
    .bind(source.to_string_lossy().to_string())
    .bind(mime_type)
    .bind(file_size as i64)
    .bind(&hash)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await;

    if let Err(error) = insert {
        let _ = storage::safe_remove_managed_file(&state.data_dir, &final_path);
        return Err(error.into());
    }

    Ok(CaptureResult {
        item: database::get_item(&state.pool, &id).await?,
        duplicate: false,
    })
}

#[tauri::command]
pub async fn capture_url(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<CaptureResult, String> {
    let result = capture_url_inner(&state, &url)
        .await
        .map_err(command_error)?;
    let _ = app.emit("capture-completed", &result);
    let _ = app.emit("library-changed", ());
    Ok(result)
}

async fn capture_url_inner(state: &AppState, raw_url: &str) -> Result<CaptureResult> {
    let mut url = Url::parse(raw_url.trim()).context("请输入完整的 http 或 https 地址")?;
    if !matches!(url.scheme(), "http" | "https") {
        bail!("仅支持 http 和 https 链接");
    }
    url.set_fragment(None);
    let normalized = url.to_string();

    if let Some(existing) =
        sqlx::query_scalar::<_, String>("SELECT id FROM items WHERE source_url = ? LIMIT 1")
            .bind(&normalized)
            .fetch_optional(&state.pool)
            .await?
    {
        return Ok(CaptureResult {
            item: database::get_item(&state.pool, &existing).await?,
            duplicate: true,
        });
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let title = url
        .host_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| normalized.clone());
    sqlx::query(
        r#"
        INSERT INTO items (
            id, item_type, title, source_url, mime_type, status, storage_mode,
            created_at, updated_at
        ) VALUES (?, 'url', ?, ?, 'text/html', 'ready', 'managed', ?, ?)
        "#,
    )
    .bind(&id)
    .bind(title)
    .bind(normalized)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    Ok(CaptureResult {
        item: database::get_item(&state.pool, &id).await?,
        duplicate: false,
    })
}

#[tauri::command]
pub async fn capture_text(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
    source_app: Option<String>,
) -> Result<CaptureResult, String> {
    let result = capture_text_inner(&state, &text, source_app)
        .await
        .map_err(command_error)?;
    let _ = app.emit("capture-completed", &result);
    let _ = app.emit("library-changed", ());
    Ok(result)
}

async fn capture_text_inner(
    state: &AppState,
    raw_text: &str,
    source_app: Option<String>,
) -> Result<CaptureResult> {
    let text = raw_text.trim();
    if text.is_empty() {
        bail!("文字内容不能为空");
    }
    if text.len() > 1_000_000 {
        bail!("单条文字内容不能超过 1 MB");
    }
    let title = text
        .lines()
        .next()
        .unwrap_or("文字收藏")
        .chars()
        .take(60)
        .collect::<String>();
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO items (
            id, item_type, title, source_app, mime_type, plain_text, status,
            storage_mode, created_at, updated_at
        ) VALUES (?, 'text', ?, ?, 'text/plain', ?, 'ready', 'managed', ?, ?)
        "#,
    )
    .bind(&id)
    .bind(title)
    .bind(source_app)
    .bind(text)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    Ok(CaptureResult {
        item: database::get_item(&state.pool, &id).await?,
        duplicate: false,
    })
}

#[tauri::command]
pub async fn list_items(
    state: State<'_, AppState>,
    search: SearchQuery,
) -> Result<ItemPage, String> {
    database::list_items(&state.pool, &search)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn search_items(
    state: State<'_, AppState>,
    search: SearchQuery,
) -> Result<ItemPage, String> {
    list_items(state, search).await
}

#[tauri::command]
pub async fn get_item(state: State<'_, AppState>, id: String) -> Result<Item, String> {
    database::get_item(&state.pool, &id)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn update_item(
    app: AppHandle,
    state: State<'_, AppState>,
    input: UpdateItemInput,
) -> Result<Item, String> {
    let item = update_item_inner(&state, input)
        .await
        .map_err(command_error)?;
    let _ = app.emit("library-changed", ());
    Ok(item)
}

async fn update_item_inner(state: &AppState, input: UpdateItemInput) -> Result<Item> {
    let existing = database::get_item(&state.pool, &input.id).await?;
    let title = input.title.unwrap_or(existing.title).trim().to_string();
    if title.is_empty() {
        bail!("标题不能为空");
    }
    let notes = input.notes.unwrap_or(existing.notes);
    let favorite = input.is_favorite.unwrap_or(existing.is_favorite);
    sqlx::query(
        "UPDATE items SET title = ?, notes = ?, is_favorite = ?, updated_at = ? WHERE id = ?",
    )
    .bind(title)
    .bind(notes)
    .bind(favorite)
    .bind(Utc::now().to_rfc3339())
    .bind(&input.id)
    .execute(&state.pool)
    .await?;
    database::get_item(&state.pool, &input.id).await
}

#[tauri::command]
pub async fn trash_items(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    set_trashed(&state.pool, &ids, true)
        .await
        .map_err(command_error)?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn restore_items(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    set_trashed(&state.pool, &ids, false)
        .await
        .map_err(command_error)?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

async fn set_trashed(pool: &SqlitePool, ids: &[String], trashed: bool) -> Result<()> {
    let mut transaction = pool.begin().await?;
    let now = Utc::now().to_rfc3339();
    for id in ids {
        if trashed {
            sqlx::query(
                "UPDATE items SET status = 'trashed', deleted_at = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&now)
            .bind(&now)
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        } else {
            sqlx::query(
                "UPDATE items SET status = 'ready', deleted_at = NULL, updated_at = ? WHERE id = ?",
            )
            .bind(&now)
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        }
    }
    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_items_permanently(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    delete_permanently_inner(&state, &ids)
        .await
        .map_err(command_error)?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

async fn delete_permanently_inner(state: &AppState, ids: &[String]) -> Result<()> {
    let mut paths = Vec::new();
    let mut transaction = state.pool.begin().await?;
    for id in ids {
        let path: Option<String> = sqlx::query_scalar(
            "SELECT local_path FROM items WHERE id = ? AND deleted_at IS NOT NULL",
        )
        .bind(id)
        .fetch_optional(&mut *transaction)
        .await?
        .flatten();
        if let Some(path) = path {
            paths.push(PathBuf::from(path));
        }
        sqlx::query("DELETE FROM items WHERE id = ? AND deleted_at IS NOT NULL")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    for path in paths {
        if path.exists() {
            storage::safe_remove_managed_file(&state.data_dir, &path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_item(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let item = database::get_item(&state.pool, &id)
        .await
        .map_err(command_error)?;
    let target = item
        .source_url
        .or(item.local_path)
        .ok_or_else(|| "此项目没有可打开的内容".to_string())?;
    open::that_detached(&target).map_err(|error| format!("无法打开内容：{error}"))?;
    sqlx::query("UPDATE items SET last_opened_at = ?, updated_at = ? WHERE id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(Utc::now().to_rfc3339())
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn reveal_item(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let item = database::get_item(&state.pool, &id)
        .await
        .map_err(command_error)?;
    let path = item
        .local_path
        .map(PathBuf::from)
        .ok_or_else(|| "此项目没有本地文件".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "无法定位文件目录".to_string())?;
    open::that_detached(parent).map_err(|error| format!("无法打开目录：{error}"))
}

#[tauri::command]
pub async fn backup_database(state: State<'_, AppState>) -> Result<String, String> {
    let backup_dir = state.data_dir.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    let path = backup_dir.join(format!("island-{}.db", Utc::now().format("%Y%m%d-%H%M%S")));
    sqlx::query("VACUUM INTO ?")
        .bind(path.to_string_lossy().to_string())
        .execute(&state.pool)
        .await
        .map_err(|error| format!("数据库备份失败：{error}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportManifest {
    schema_version: u32,
    exported_at: String,
    item_count: usize,
    items: Vec<Item>,
}

#[tauri::command]
pub async fn export_library(state: State<'_, AppState>) -> Result<String, String> {
    export_library_inner(&state).await.map_err(command_error)
}

async fn export_library_inner(state: &AppState) -> Result<String> {
    let mut exported_items = Vec::new();
    let mut page_number = 1;
    loop {
        let page = database::list_items(
            &state.pool,
            &SearchQuery {
                page: page_number,
                page_size: 250,
                ..Default::default()
            },
        )
        .await?;
        let total = page.total as usize;
        exported_items.extend(page.items);
        if exported_items.len() >= total {
            break;
        }
        page_number += 1;
    }
    let export_root = state.data_dir.join("exports").join(format!(
        "island-export-{}",
        Utc::now().format("%Y%m%d-%H%M%S")
    ));
    let files_dir = export_root.join("files");
    fs::create_dir_all(&files_dir)?;

    let mut checksums = Vec::new();
    for item in &mut exported_items {
        if let Some(local_path) = &item.local_path {
            let source = PathBuf::from(local_path);
            if source.exists() {
                let extension = source
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| format!(".{value}"))
                    .unwrap_or_default();
                let filename = format!("{}{}", item.id, extension);
                fs::copy(&source, files_dir.join(&filename))?;
                checksums.push(format!(
                    "{}  files/{}",
                    item.content_hash.as_deref().unwrap_or(""),
                    filename
                ));
                item.local_path = Some(format!("files/{filename}"));
            }
        }
    }

    let manifest = ExportManifest {
        schema_version: 1,
        exported_at: Utc::now().to_rfc3339(),
        item_count: exported_items.len(),
        items: exported_items.clone(),
    };
    fs::write(
        export_root.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    fs::write(export_root.join("SHA256SUMS.txt"), checksums.join("\n"))?;

    let mut writer = csv::Writer::from_path(export_root.join("metadata.csv"))?;
    for item in &exported_items {
        writer.serialize(item)?;
    }
    writer.flush()?;
    Ok(export_root.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(&state.pool)
        .await
        .map_err(|error| error.to_string())?;
    let settings: HashMap<String, String> = rows.into_iter().collect();
    Ok(Settings {
        data_dir: state.data_dir.to_string_lossy().to_string(),
        network_fetch_enabled: setting_bool(&settings, "network_fetch_enabled"),
        ai_enabled: setting_bool(&settings, "ai_enabled"),
        start_on_login: setting_bool(&settings, "start_on_login"),
        reduce_motion: setting_bool(&settings, "reduce_motion"),
    })
}

fn setting_bool(settings: &HashMap<String, String>, key: &str) -> bool {
    settings
        .get(key)
        .map(|value| value == "true")
        .unwrap_or(false)
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    input: UpdateSettingsInput,
) -> Result<Settings, String> {
    let values = [
        ("network_fetch_enabled", input.network_fetch_enabled),
        ("ai_enabled", input.ai_enabled),
        ("start_on_login", input.start_on_login),
        ("reduce_motion", input.reduce_motion),
    ];
    let now = Utc::now().to_rfc3339();
    for (key, value) in values {
        if let Some(value) = value {
            sqlx::query(
                "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            )
            .bind(key)
            .bind(value.to_string())
            .bind(&now)
            .execute(&state.pool)
            .await
            .map_err(|error| error.to_string())?;
        }
    }
    get_settings(state).await
}

#[tauri::command]
pub async fn library_stats(state: State<'_, AppState>) -> Result<LibraryStats, String> {
    database::stats(&state.pool).await.map_err(command_error)
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn imports_deduplicates_searches_and_exports_in_a_temporary_library() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("IslandData");
        storage::ensure_data_layout(&root).unwrap();
        let pool = database::connect(&root.join("database/island.db"))
            .await
            .unwrap();
        let state = AppState {
            pool,
            data_dir: root.clone(),
            import_lock: Mutex::new(()),
        };
        let source = temp.path().join("research-note.txt");
        fs::write(&source, "island search needle").unwrap();

        let first = capture_one_file(&state, &source).await.unwrap();
        assert!(!first.duplicate);
        assert!(Path::new(first.item.local_path.as_deref().unwrap()).exists());

        let second = capture_one_file(&state, &source).await.unwrap();
        assert!(second.duplicate);
        assert_eq!(first.item.id, second.item.id);

        let results = database::list_items(
            &state.pool,
            &SearchQuery {
                query: Some("research".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(results.total, 1);

        let export_path = PathBuf::from(export_library_inner(&state).await.unwrap());
        assert!(export_path.join("manifest.json").exists());
        assert!(export_path.join("metadata.csv").exists());
        assert!(export_path.join("SHA256SUMS.txt").exists());

        set_trashed(&state.pool, std::slice::from_ref(&first.item.id), true)
            .await
            .unwrap();
        let trash = database::list_items(
            &state.pool,
            &SearchQuery {
                trashed: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(trash.total, 1);

        set_trashed(&state.pool, &[first.item.id], false)
            .await
            .unwrap();
        assert_eq!(database::stats(&state.pool).await.unwrap().active, 1);
    }
}
