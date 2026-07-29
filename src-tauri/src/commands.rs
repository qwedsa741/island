use std::{
    collections::HashMap,
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
    time::Duration,
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
        CaptureProgress, CaptureResult, CreateSmartViewInput, CreateSpaceInput, Item, ItemPage,
        JobRecord, LibraryStats, ReaderResource, SearchQuery, Settings, SmartView, Space, Tag,
        UpdateItemInput, UpdateSettingsInput, WebSnapshot,
    },
    storage,
};

pub struct AppState {
    pub pool: SqlitePool,
    pub data_dir: PathBuf,
    pub import_lock: Mutex<()>,
}

fn command_error(error: impl Into<anyhow::Error>) -> String {
    let error = error.into();
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
                if !result.duplicate && supports_text_extraction(&result.item) {
                    let job_id = enqueue_job(&state.pool, &result.item.id, "extract_text")
                        .await
                        .map_err(command_error)?;
                    let pool = state.pool.clone();
                    let item = result.item.clone();
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        run_text_extraction_job(&app_handle, &pool, &job_id, &item).await;
                    });
                }
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
    if !result.duplicate && network_fetch_enabled(&state.pool).await {
        let pool = state.pool.clone();
        let data_dir = state.data_dir.clone();
        let item_id = result.item.id.clone();
        let source_url = result.item.source_url.clone().unwrap_or_default();
        let app_handle = app.clone();
        let job_id = enqueue_job(&pool, &item_id, "fetch_webpage")
            .await
            .map_err(command_error)?;
        tauri::async_runtime::spawn(async move {
            run_web_snapshot_job(
                &app_handle,
                &pool,
                &data_dir,
                &job_id,
                &item_id,
                &source_url,
            )
            .await;
        });
    }
    let _ = app.emit("capture-completed", &result);
    let _ = app.emit("library-changed", ());
    Ok(result)
}

async fn enqueue_job(pool: &SqlitePool, item_id: &str, job_type: &str) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let mut transaction = pool.begin().await?;
    sqlx::query(
        "INSERT INTO jobs(id, item_id, job_type, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
    )
    .bind(&id)
    .bind(item_id)
    .bind(job_type)
    .bind(&now)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("UPDATE items SET status = 'processing', updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(item_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(id)
}

async fn run_web_snapshot_job(
    app: &AppHandle,
    pool: &SqlitePool,
    data_dir: &Path,
    job_id: &str,
    item_id: &str,
    source_url: &str,
) {
    let started = Utc::now().to_rfc3339();
    let _ = sqlx::query("UPDATE jobs SET status = 'running', progress = 0.05, started_at = ?, error_message = NULL WHERE id = ?")
        .bind(&started).bind(job_id).execute(pool).await;
    let _ = app.emit(
        "job-updated",
        serde_json::json!({"jobId": job_id, "status": "running", "progress": 0.05}),
    );
    let outcome = create_web_snapshot(pool, data_dir, item_id, source_url).await;
    let finished = Utc::now().to_rfc3339();
    match outcome {
        Ok(()) => {
            let _ = sqlx::query(
                "UPDATE jobs SET status = 'succeeded', progress = 1, finished_at = ? WHERE id = ?",
            )
            .bind(&finished)
            .bind(job_id)
            .execute(pool)
            .await;
            let _ = app.emit(
                "job-updated",
                serde_json::json!({"jobId": job_id, "status": "succeeded", "progress": 1}),
            );
            let _ = app.emit("library-changed", ());
        }
        Err(error) => {
            let message = error.to_string();
            let _ = mark_snapshot_failed(pool, item_id, &message).await;
            let _ = sqlx::query("UPDATE jobs SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?")
                .bind(message.chars().take(600).collect::<String>()).bind(&finished).bind(job_id).execute(pool).await;
            let _ = app.emit(
                "job-updated",
                serde_json::json!({"jobId": job_id, "status": "failed"}),
            );
            let _ = app.emit("library-changed", ());
        }
    }
}

fn supports_text_extraction(item: &Item) -> bool {
    if matches!(item.item_type.as_str(), "pdf" | "text" | "markdown") {
        return true;
    }
    let extension = item
        .local_path
        .as_deref()
        .and_then(|path| Path::new(path).extension())
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "rs" | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "py"
            | "go"
            | "java"
            | "c"
            | "cpp"
            | "h"
            | "json"
            | "yaml"
            | "yml"
            | "toml"
            | "html"
            | "css"
            | "xml"
            | "csv"
            | "log"
    )
}

async fn run_text_extraction_job(app: &AppHandle, pool: &SqlitePool, job_id: &str, item: &Item) {
    let started = Utc::now().to_rfc3339();
    let _ = sqlx::query("UPDATE jobs SET status = 'running', progress = 0.1, started_at = ?, error_message = NULL WHERE id = ?")
        .bind(&started).bind(job_id).execute(pool).await;
    let _ = app.emit(
        "job-updated",
        serde_json::json!({"jobId": job_id, "status": "running", "progress": 0.1}),
    );
    let item_id = item.id.clone();
    let result = extract_local_text(item.clone()).await;
    let finished = Utc::now().to_rfc3339();
    match result {
        Ok(text) => {
            let outcome = index_extracted_document(
                pool,
                &item_id,
                &item.item_type,
                &item.title,
                &text,
                item.local_path.as_deref(),
            )
            .await;
            if let Err(error) = outcome {
                fail_job(app, pool, job_id, &item_id, &error.to_string()).await;
                return;
            }
            let _ = sqlx::query(
                "UPDATE jobs SET status = 'succeeded', progress = 1, finished_at = ? WHERE id = ?",
            )
            .bind(&finished)
            .bind(job_id)
            .execute(pool)
            .await;
            let _ = app.emit(
                "job-updated",
                serde_json::json!({"jobId": job_id, "status": "succeeded", "progress": 1}),
            );
            let _ = app.emit("library-changed", ());
        }
        Err(error) => fail_job(app, pool, job_id, &item_id, &error.to_string()).await,
    }
}

async fn fail_job(app: &AppHandle, pool: &SqlitePool, job_id: &str, item_id: &str, error: &str) {
    let finished = Utc::now().to_rfc3339();
    let message = error.chars().take(600).collect::<String>();
    let _ = sqlx::query("UPDATE items SET status = 'failed', updated_at = ? WHERE id = ?")
        .bind(&finished)
        .bind(item_id)
        .execute(pool)
        .await;
    let _ = sqlx::query(
        "UPDATE jobs SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?",
    )
    .bind(message)
    .bind(&finished)
    .bind(job_id)
    .execute(pool)
    .await;
    let _ = app.emit(
        "job-updated",
        serde_json::json!({"jobId": job_id, "status": "failed"}),
    );
    let _ = app.emit("library-changed", ());
}

async fn extract_local_text(item: Item) -> Result<String> {
    let path = item.local_path.clone().context("托管文件路径不存在")?;
    let item_type = item.item_type.clone();
    tokio::task::spawn_blocking(move || -> Result<String> {
        let path = PathBuf::from(path);
        if item_type == "pdf" {
            return pdf_extract::extract_text(&path).map_err(Into::into);
        }
        let bytes = fs::read(&path)?;
        if bytes.len() > 10 * 1024 * 1024 {
            bail!("文本文件超过 10 MB 解析限制");
        }
        Ok(String::from_utf8_lossy(&bytes).to_string())
    })
    .await?
}

async fn index_extracted_document(
    pool: &SqlitePool,
    item_id: &str,
    kind: &str,
    title: &str,
    text: &str,
    source_path: Option<&str>,
) -> Result<()> {
    let text = text.trim();
    if text.is_empty() {
        bail!("未从内容中提取到可索引文字");
    }
    let now = Utc::now().to_rfc3339();
    let document_id = Uuid::new_v4().to_string();
    let mut transaction = pool.begin().await?;
    sqlx::query("DELETE FROM documents WHERE item_id = ?")
        .bind(item_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("INSERT INTO documents(id, item_id, version, kind, title, extracted_text, source_path, status, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, 'ready', ?, ?)")
        .bind(&document_id).bind(item_id).bind(kind).bind(title).bind(text).bind(source_path).bind(&now).bind(&now).execute(&mut *transaction).await?;
    for (ordinal, chunk) in text_chunks(text, 1800).into_iter().enumerate() {
        sqlx::query("INSERT INTO chunks(id, document_id, ordinal, content, locator_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(Uuid::new_v4().to_string()).bind(&document_id).bind(ordinal as i64).bind(chunk.content).bind(format!(r#"{{"chunk":{ordinal},"startByte":{},"endByte":{}}}"#, chunk.start_byte, chunk.end_byte)).bind(&now).execute(&mut *transaction).await?;
    }
    sqlx::query("UPDATE items SET plain_text = ?, status = 'ready', updated_at = ? WHERE id = ?")
        .bind(text)
        .bind(&now)
        .bind(item_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(())
}

struct TextChunk<'a> {
    content: &'a str,
    start_byte: usize,
    end_byte: usize,
}

fn text_chunks(text: &str, max_bytes: usize) -> Vec<TextChunk<'_>> {
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + max_bytes).min(text.len());
        while end > start && !text.is_char_boundary(end) {
            end -= 1;
        }
        // UTF-8 characters are at most four bytes, so this only guards a malformed limit.
        if end == start {
            end = text[start..]
                .char_indices()
                .nth(1)
                .map_or(text.len(), |(index, _)| start + index);
        }
        chunks.push(TextChunk {
            content: &text[start..end],
            start_byte: start,
            end_byte: end,
        });
        start = end;
    }
    chunks
}

#[tauri::command]
pub async fn capture_webpage(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<CaptureResult, String> {
    capture_url(app, state, url).await
}

async fn network_fetch_enabled(pool: &SqlitePool) -> bool {
    sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'network_fetch_enabled'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .is_some_and(|value| value == "true")
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
        }
    }
}

async fn validate_public_url(url: &Url) -> Result<()> {
    if !matches!(url.scheme(), "http" | "https") {
        bail!("网页快照仅支持 http 和 https");
    }
    let host = url.host_str().context("网页地址缺少主机名")?;
    if host.eq_ignore_ascii_case("localhost") {
        bail!("为保护本地网络，不能抓取 localhost");
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .context("无法解析网页地址")?;
    for address in addresses {
        if is_private_ip(address.ip()) {
            bail!("为保护本地网络，不能抓取私有或本机地址");
        }
    }
    Ok(())
}

fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let open_end = lower[start..].find('>')? + start + 1;
    let end = lower[open_end..].find("</title>")? + open_end;
    let title = html[open_end..end].trim();
    (!title.is_empty()).then(|| title.chars().take(200).collect())
}

fn text_from_html(html: &str) -> String {
    let mut text = String::with_capacity(html.len().min(250_000));
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn create_web_snapshot(
    pool: &SqlitePool,
    data_dir: &Path,
    item_id: &str,
    source_url: &str,
) -> Result<()> {
    let mut current = Url::parse(source_url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Island/0.3 (+local knowledge snapshot)")
        .build()?;
    let mut response = None;
    for _ in 0..=5 {
        validate_public_url(&current).await?;
        let candidate = client.get(current.clone()).send().await?;
        if candidate.status().is_redirection() {
            let location = candidate
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .context("网页返回了无效重定向")?;
            current = current.join(location)?;
            continue;
        }
        response = Some(candidate.error_for_status()?);
        break;
    }
    let mut response = response.context("网页重定向次数超过限制")?;
    if response
        .content_length()
        .is_some_and(|length| length > 10 * 1024 * 1024)
    {
        bail!("网页响应超过 10 MB 限制");
    }
    let final_url = response.url().to_string();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 10 * 1024 * 1024 {
            bail!("网页响应超过 10 MB 限制");
        }
        bytes.extend_from_slice(&chunk);
    }
    let raw_html = String::from_utf8_lossy(&bytes).to_string();
    let title = extract_title(&raw_html);
    let sanitized = ammonia::Builder::default()
        .url_relative(ammonia::UrlRelative::RewriteWithBase(current.clone()))
        .clean(&raw_html)
        .to_string();
    let plain_text = text_from_html(&sanitized);
    let snapshot_dir = data_dir.join("assets/webpage").join(item_id).join("1");
    tokio::fs::create_dir_all(&snapshot_dir).await?;
    let raw_path = snapshot_dir.join("source.html");
    let sanitized_path = snapshot_dir.join("reader.html");
    tokio::fs::write(&raw_path, &bytes).await?;
    tokio::fs::write(&sanitized_path, sanitized.as_bytes()).await?;

    let now = Utc::now().to_rfc3339();
    let snapshot_id = Uuid::new_v4().to_string();
    let document_id = Uuid::new_v4().to_string();
    let mut transaction = pool.begin().await?;
    sqlx::query(
        "INSERT INTO web_snapshots(id, item_id, version, source_url, final_url, raw_path, \
         sanitized_path, title, captured_at, status) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'ready')",
    )
    .bind(snapshot_id)
    .bind(item_id)
    .bind(source_url)
    .bind(&final_url)
    .bind(raw_path.to_string_lossy().to_string())
    .bind(sanitized_path.to_string_lossy().to_string())
    .bind(&title)
    .bind(&now)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "INSERT INTO documents(id, item_id, version, kind, title, extracted_text, source_path, \
         status, created_at, updated_at) VALUES (?, ?, 1, 'webpage', ?, ?, ?, 'ready', ?, ?)",
    )
    .bind(&document_id)
    .bind(item_id)
    .bind(&title)
    .bind(&plain_text)
    .bind(sanitized_path.to_string_lossy().to_string())
    .bind(&now)
    .bind(&now)
    .execute(&mut *transaction)
    .await?;
    for (ordinal, chunk) in text_chunks(&plain_text, 1800).into_iter().enumerate() {
        sqlx::query(
            "INSERT INTO chunks(id, document_id, ordinal, content, locator_json, created_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&document_id)
        .bind(ordinal as i64)
        .bind(chunk.content)
        .bind(format!(
            r#"{{"snapshotVersion":1,"chunk":{ordinal},"startByte":{},"endByte":{}}}"#,
            chunk.start_byte, chunk.end_byte
        ))
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
    }
    sqlx::query(
        "UPDATE items SET title = COALESCE(?, title), local_path = ?, plain_text = ?, \
         status = 'ready', updated_at = ? WHERE id = ?",
    )
    .bind(title)
    .bind(sanitized_path.to_string_lossy().to_string())
    .bind(plain_text)
    .bind(&now)
    .bind(item_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

async fn mark_snapshot_failed(pool: &SqlitePool, item_id: &str, error: &str) -> Result<()> {
    sqlx::query("UPDATE items SET status = 'failed', notes = ?, updated_at = ? WHERE id = ?")
        .bind(format!(
            "网页快照失败：{}",
            error.chars().take(300).collect::<String>()
        ))
        .bind(Utc::now().to_rfc3339())
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
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
pub async fn list_spaces(state: State<'_, AppState>) -> Result<Vec<Space>, String> {
    sqlx::query_as::<_, Space>(
        "SELECT spaces.id, spaces.name, spaces.description, spaces.color, spaces.icon, \
         spaces.created_at, spaces.updated_at, COUNT(space_items.item_id) AS item_count \
         FROM spaces LEFT JOIN space_items ON space_items.space_id = spaces.id \
         GROUP BY spaces.id ORDER BY spaces.updated_at DESC, spaces.name COLLATE NOCASE",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(command_error)
}

#[tauri::command]
pub async fn create_space(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CreateSpaceInput,
) -> Result<Space, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("空间名称需为 1–80 个字符".into());
    }
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO spaces(id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(input.description.trim())
    .bind(input.color)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(command_error)?;
    let _ = app.emit("library-changed", ());
    sqlx::query_as::<_, Space>(
        "SELECT id, name, description, color, icon, created_at, updated_at, 0 AS item_count FROM spaces WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(command_error)
}

#[tauri::command]
pub async fn update_space_membership(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    space_ids: Vec<String>,
) -> Result<(), String> {
    let mut transaction = state.pool.begin().await.map_err(command_error)?;
    sqlx::query("DELETE FROM space_items WHERE item_id = ?")
        .bind(&item_id)
        .execute(&mut *transaction)
        .await
        .map_err(command_error)?;
    let now = Utc::now().to_rfc3339();
    for space_id in space_ids {
        sqlx::query(
            "INSERT OR IGNORE INTO space_items(space_id, item_id, created_at) VALUES (?, ?, ?)",
        )
        .bind(space_id)
        .bind(&item_id)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(command_error)?;
    }
    transaction.commit().await.map_err(command_error)?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn list_item_spaces(
    state: State<'_, AppState>,
    item_id: String,
) -> Result<Vec<String>, String> {
    sqlx::query_scalar("SELECT space_id FROM space_items WHERE item_id = ? ORDER BY created_at")
        .bind(item_id)
        .fetch_all(&state.pool)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn list_item_tags(
    state: State<'_, AppState>,
    item_id: String,
) -> Result<Vec<Tag>, String> {
    sqlx::query_as::<_, Tag>(
        "SELECT tags.id, tags.name, tags.created_at FROM tags \
         INNER JOIN item_tags ON item_tags.tag_id = tags.id WHERE item_tags.item_id = ? \
         ORDER BY tags.name COLLATE NOCASE",
    )
    .bind(item_id)
    .fetch_all(&state.pool)
    .await
    .map_err(command_error)
}

#[tauri::command]
pub async fn set_item_tags(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    names: Vec<String>,
) -> Result<Vec<Tag>, String> {
    let mut transaction = state.pool.begin().await.map_err(command_error)?;
    sqlx::query("DELETE FROM item_tags WHERE item_id = ?")
        .bind(&item_id)
        .execute(&mut *transaction)
        .await
        .map_err(command_error)?;
    let now = Utc::now().to_rfc3339();
    for name in names {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 40 {
            continue;
        }
        let tag_id: String =
            sqlx::query_scalar("SELECT id FROM tags WHERE name = ? COLLATE NOCASE")
                .bind(name)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(command_error)?
                .unwrap_or_else(|| Uuid::new_v4().to_string());
        sqlx::query("INSERT OR IGNORE INTO tags(id, name, created_at) VALUES (?, ?, ?)")
            .bind(&tag_id)
            .bind(name)
            .bind(&now)
            .execute(&mut *transaction)
            .await
            .map_err(command_error)?;
        sqlx::query("INSERT INTO item_tags(item_id, tag_id, source) VALUES (?, ?, 'manual')")
            .bind(&item_id)
            .bind(&tag_id)
            .execute(&mut *transaction)
            .await
            .map_err(command_error)?;
    }
    transaction.commit().await.map_err(command_error)?;
    let tags = list_item_tags(state, item_id).await?;
    let _ = app.emit("library-changed", ());
    Ok(tags)
}

#[tauri::command]
pub async fn list_smart_views(state: State<'_, AppState>) -> Result<Vec<SmartView>, String> {
    sqlx::query_as::<_, SmartView>("SELECT id, name, rules_json, created_at, updated_at FROM smart_views ORDER BY updated_at DESC")
        .fetch_all(&state.pool).await.map_err(command_error)
}

#[tauri::command]
pub async fn create_smart_view(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CreateSmartViewInput,
) -> Result<SmartView, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("视图名称需为 1–80 个字符".into());
    }
    serde_json::from_str::<serde_json::Value>(&input.rules_json)
        .map_err(|_| "智能视图规则格式无效".to_string())?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO smart_views(id, name, rules_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&id).bind(name).bind(input.rules_json).bind(&now).bind(&now).execute(&state.pool).await.map_err(command_error)?;
    let _ = app.emit("library-changed", ());
    sqlx::query_as::<_, SmartView>(
        "SELECT id, name, rules_json, created_at, updated_at FROM smart_views WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
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
pub async fn get_reader_resource(
    state: State<'_, AppState>,
    id: String,
) -> Result<ReaderResource, String> {
    let item = database::get_item(&state.pool, &id)
        .await
        .map_err(command_error)?;
    let snapshot = sqlx::query_as::<_, WebSnapshot>(
        "SELECT id, item_id, version, source_url, final_url, raw_path, sanitized_path, \
         title, author, published_at, captured_at, status, error_code \
         FROM web_snapshots WHERE item_id = ? ORDER BY version DESC LIMIT 1",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|error| error.to_string())?;
    let mode = match item.item_type.as_str() {
        "pdf" => "pdf",
        "image" => "image",
        "text" | "markdown" => "text",
        "url" => "web-snapshot",
        _ => "file",
    }
    .to_string();
    Ok(ReaderResource {
        item,
        snapshot,
        mode,
    })
}

#[tauri::command]
pub async fn list_snapshot_versions(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<WebSnapshot>, String> {
    sqlx::query_as::<_, WebSnapshot>(
        "SELECT id, item_id, version, source_url, final_url, raw_path, sanitized_path, \
         title, author, published_at, captured_at, status, error_code \
         FROM web_snapshots WHERE item_id = ? ORDER BY version DESC",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_reader(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    database::get_item(&state.pool, &id)
        .await
        .map_err(command_error)?;
    if let Some(window) = app.get_webview_window("reader") {
        window
            .navigate(
                format!("tauri://localhost/?window=reader&id={id}")
                    .parse()
                    .map_err(|error| format!("无法构建阅读器地址：{error}"))?,
            )
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "reader",
        tauri::WebviewUrl::App(format!("index.html?window=reader&id={id}").into()),
    )
    .title("Island 阅读器")
    .inner_size(1120.0, 760.0)
    .min_inner_size(760.0, 560.0)
    .center()
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn safe_live_navigation(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return false;
    }
    host.parse::<IpAddr>().map_or(true, |ip| !is_private_ip(ip))
}

#[tauri::command]
pub async fn open_live_reader(app: AppHandle, url: String) -> Result<(), String> {
    let url = Url::parse(url.trim()).map_err(|error| format!("无效网页地址：{error}"))?;
    validate_public_url(&url).await.map_err(command_error)?;
    if let Some(window) = app.get_webview_window("reader-live") {
        window.navigate(url).map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(&app, "reader-live", tauri::WebviewUrl::External(url))
        .title("Island 在线阅读 · 访客模式")
        .inner_size(1120.0, 760.0)
        .min_inner_size(760.0, 560.0)
        .center()
        .incognito(true)
        .on_navigation(safe_live_navigation)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&format!("{} · Island 访客阅读", title));
        })
        .build()
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
pub async fn list_jobs(
    state: State<'_, AppState>,
    status: Option<String>,
) -> Result<Vec<JobRecord>, String> {
    let mut query = String::from(
        "SELECT jobs.id, jobs.item_id, items.title AS item_title, jobs.job_type, jobs.status, jobs.progress, \
         jobs.retry_count, jobs.error_message, jobs.created_at, jobs.started_at, jobs.finished_at \
         FROM jobs INNER JOIN items ON items.id = jobs.item_id",
    );
    if status.is_some() {
        query.push_str(" WHERE jobs.status = ?");
    }
    query.push_str(" ORDER BY CASE jobs.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END, jobs.created_at DESC LIMIT 200");
    let mut prepared = sqlx::query_as::<_, JobRecord>(&query);
    if let Some(status) = status {
        prepared = prepared.bind(status);
    }
    prepared.fetch_all(&state.pool).await.map_err(command_error)
}

#[tauri::command]
pub async fn retry_job(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    let job: (String, String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT jobs.item_id, jobs.job_type, items.source_url, items.local_path FROM jobs INNER JOIN items ON items.id = jobs.item_id WHERE jobs.id = ?",
    )
    .bind(&job_id).fetch_one(&state.pool).await.map_err(command_error)?;
    if !matches!(job.1.as_str(), "fetch_webpage" | "extract_text") {
        return Err("此任务类型暂不支持重试".into());
    }
    sqlx::query("UPDATE jobs SET status = 'queued', progress = 0, retry_count = retry_count + 1, error_message = NULL, started_at = NULL, finished_at = NULL WHERE id = ?")
        .bind(&job_id).execute(&state.pool).await.map_err(command_error)?;
    sqlx::query("UPDATE items SET status = 'processing', updated_at = ? WHERE id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(&job.0)
        .execute(&state.pool)
        .await
        .map_err(command_error)?;
    let _ = app.emit(
        "job-updated",
        serde_json::json!({"jobId": job_id, "status": "queued", "progress": 0}),
    );
    let pool = state.pool.clone();
    let data_dir = state.data_dir.clone();
    let app_handle = app.clone();
    if job.1 == "fetch_webpage" {
        let source_url = job.2.ok_or_else(|| "原始网页地址不存在".to_string())?;
        tauri::async_runtime::spawn(async move {
            run_web_snapshot_job(&app_handle, &pool, &data_dir, &job_id, &job.0, &source_url).await;
        });
    } else {
        let item = database::get_item(&pool, &job.0)
            .await
            .map_err(command_error)?;
        tauri::async_runtime::spawn(async move {
            run_text_extraction_job(&app_handle, &pool, &job_id, &item).await;
        });
    }
    Ok(())
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

    #[test]
    fn blocks_private_network_targets_for_snapshots() {
        assert!(is_private_ip("127.0.0.1".parse().unwrap()));
        assert!(is_private_ip("192.168.1.20".parse().unwrap()));
        assert!(is_private_ip("::1".parse().unwrap()));
        assert!(!is_private_ip("1.1.1.1".parse().unwrap()));
    }

    #[test]
    fn chunks_keep_utf8_boundaries_and_reference_offsets() {
        let source = "海岛知识库";
        let chunks = text_chunks(source, 6);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].content, "海岛");
        assert_eq!(chunks[0].start_byte, 0);
        assert_eq!(chunks[0].end_byte, 6);
        assert_eq!(chunks[2].content, "库");
        assert_eq!(&source[chunks[2].start_byte..chunks[2].end_byte], "库");
    }

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

        let queued_job = enqueue_job(&state.pool, &first.item.id, "extract_text")
            .await
            .unwrap();
        let queued: (String, f64) =
            sqlx::query_as("SELECT status, progress FROM jobs WHERE id = ?")
                .bind(&queued_job)
                .fetch_one(&state.pool)
                .await
                .unwrap();
        assert_eq!(queued.0, "queued");
        assert_eq!(queued.1, 0.0);
        assert_eq!(
            database::get_item(&state.pool, &first.item.id)
                .await
                .unwrap()
                .status,
            "processing"
        );

        let extracted = extract_local_text(first.item.clone()).await.unwrap();
        assert_eq!(extracted, "island search needle");
        index_extracted_document(
            &state.pool,
            &first.item.id,
            &first.item.item_type,
            &first.item.title,
            &extracted,
            first.item.local_path.as_deref(),
        )
        .await
        .unwrap();
        let indexed_chunks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM chunks WHERE document_id IN (SELECT id FROM documents WHERE item_id = ?)",
        )
        .bind(&first.item.id)
        .fetch_one(&state.pool)
        .await
        .unwrap();
        assert_eq!(indexed_chunks, 1);
        assert_eq!(
            database::get_item(&state.pool, &first.item.id)
                .await
                .unwrap()
                .status,
            "ready"
        );
        let fts_matches: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH 'needle'")
                .fetch_one(&state.pool)
                .await
                .unwrap();
        assert_eq!(fts_matches, 1);

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

        set_trashed(&state.pool, std::slice::from_ref(&first.item.id), false)
            .await
            .unwrap();
        assert_eq!(database::stats(&state.pool).await.unwrap().active, 1);

        let tag_id = Uuid::new_v4().to_string();
        let space_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO tags(id, name, created_at) VALUES (?, '研究', ?)")
            .bind(&tag_id)
            .bind(&now)
            .execute(&state.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO item_tags(item_id, tag_id, source) VALUES (?, ?, 'manual')")
            .bind(&first.item.id)
            .bind(&tag_id)
            .execute(&state.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO spaces(id, name, description, created_at, updated_at) VALUES (?, '测试空间', '', ?, ?)")
            .bind(&space_id).bind(&now).bind(&now).execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO space_items(space_id, item_id, created_at) VALUES (?, ?, ?)")
            .bind(&space_id)
            .bind(&first.item.id)
            .bind(&now)
            .execute(&state.pool)
            .await
            .unwrap();
        assert_eq!(
            database::list_items(
                &state.pool,
                &SearchQuery {
                    tag_ids: vec![tag_id],
                    ..Default::default()
                }
            )
            .await
            .unwrap()
            .total,
            1
        );
        assert_eq!(
            database::list_items(
                &state.pool,
                &SearchQuery {
                    space_id: Some(space_id),
                    ..Default::default()
                }
            )
            .await
            .unwrap()
            .total,
            1
        );
    }
}
