use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    #[sqlx(rename = "item_type")]
    pub item_type: String,
    pub title: String,
    pub original_name: Option<String>,
    pub source_url: Option<String>,
    pub source_app: Option<String>,
    pub local_path: Option<String>,
    pub original_path: Option<String>,
    pub mime_type: Option<String>,
    pub file_size: Option<i64>,
    pub content_hash: Option<String>,
    pub notes: String,
    pub plain_text: Option<String>,
    pub status: String,
    pub is_favorite: bool,
    pub storage_mode: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub query: Option<String>,
    #[serde(default)]
    pub types: Vec<String>,
    pub favorite: Option<bool>,
    pub processing_status: Option<String>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    pub space_id: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_page_size")]
    pub page_size: u32,
    #[serde(default)]
    pub trashed: bool,
}

fn default_page() -> u32 {
    1
}

fn default_page_size() -> u32 {
    100
}

impl Default for SearchQuery {
    fn default() -> Self {
        Self {
            query: None,
            types: vec![],
            favorite: None,
            processing_status: None,
            tag_ids: vec![],
            space_id: None,
            page: 1,
            page_size: 100,
            trashed: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SmartView {
    pub id: String,
    pub name: String,
    pub rules_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpaceInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSmartViewInput {
    pub name: String,
    pub rules_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPage {
    pub items: Vec<Item>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub item: Item,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureProgress {
    pub path: String,
    pub index: usize,
    pub total: usize,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateItemInput {
    pub id: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub is_favorite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub data_dir: String,
    pub network_fetch_enabled: bool,
    pub ai_enabled: bool,
    pub start_on_login: bool,
    pub reduce_motion: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsInput {
    pub network_fetch_enabled: Option<bool>,
    pub ai_enabled: Option<bool>,
    pub start_on_login: Option<bool>,
    pub reduce_motion: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub active: i64,
    pub trashed: i64,
    pub favorites: i64,
    pub bytes_stored: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: String,
    pub item_id: String,
    pub item_title: String,
    pub job_type: String,
    pub status: String,
    pub progress: f64,
    pub retry_count: i64,
    pub error_message: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebSnapshot {
    pub id: String,
    pub item_id: String,
    pub version: i64,
    pub source_url: String,
    pub final_url: Option<String>,
    pub raw_path: Option<String>,
    pub sanitized_path: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub published_at: Option<String>,
    pub captured_at: String,
    pub status: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderResource {
    pub item: Item,
    pub snapshot: Option<WebSnapshot>,
    pub mode: String,
}
