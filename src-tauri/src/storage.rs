use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const DATA_FOLDERS: &[&str] = &[
    "database",
    "assets/pdf",
    "assets/images",
    "assets/files",
    "assets/webpage",
    "thumbnails",
    "cache/staging",
    "backups",
    "exports",
    "logs",
    "config",
];

pub fn ensure_data_layout(root: &Path) -> Result<()> {
    for folder in DATA_FOLDERS {
        fs::create_dir_all(root.join(folder))
            .with_context(|| format!("无法创建数据目录 {}", root.join(folder).display()))?;
    }
    Ok(())
}

pub fn copy_and_hash(source: &Path, staging_dir: &Path) -> Result<(PathBuf, String, u64)> {
    let metadata =
        fs::metadata(source).with_context(|| format!("无法读取文件信息 {}", source.display()))?;
    if !metadata.is_file() {
        bail!("只能收藏普通文件");
    }

    fs::create_dir_all(staging_dir)?;
    let staging_path = staging_dir.join(format!("{}.part", Uuid::new_v4()));
    let input = File::open(source).with_context(|| format!("无法打开文件 {}", source.display()))?;
    let output = File::create(&staging_path)
        .with_context(|| format!("无法创建临时文件 {}", staging_path.display()))?;
    let mut reader = BufReader::with_capacity(1024 * 1024, input);
    let mut writer = BufWriter::with_capacity(1024 * 1024, output);
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = vec![0_u8; 1024 * 1024];

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        writer.write_all(&buffer[..read])?;
        total += read as u64;
    }
    writer.flush()?;
    writer.get_ref().sync_all()?;

    if total != metadata.len() {
        let _ = fs::remove_file(&staging_path);
        bail!("复制校验失败：源文件大小发生变化");
    }

    Ok((staging_path, format!("{:x}", hasher.finalize()), total))
}

pub fn final_asset_path(root: &Path, item_type: &str, hash: &str, source: &Path) -> PathBuf {
    let bucket = match item_type {
        "pdf" => "pdf",
        "image" => "images",
        _ => "files",
    };
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let filename = extension
        .map(|extension| format!("{hash}.{extension}"))
        .unwrap_or_else(|| hash.to_string());
    root.join("assets").join(bucket).join(filename)
}

pub fn safe_remove_managed_file(root: &Path, path: &Path) -> Result<()> {
    let assets = root.join("assets").canonicalize()?;
    let target = path
        .canonicalize()
        .with_context(|| format!("无法解析托管文件 {}", path.display()))?;
    if !target.starts_with(&assets) {
        bail!("拒绝删除 Island 托管目录之外的文件");
    }
    fs::remove_file(target)?;
    Ok(())
}

pub fn classify_file(path: &Path) -> (&'static str, String) {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();

    let item_type = match extension.as_str() {
        "pdf" => "pdf",
        "md" | "markdown" => "markdown",
        "txt" => "text",
        _ if mime.starts_with("image/") => "image",
        _ => "file",
    };
    (item_type, mime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_supported_files() {
        assert_eq!(classify_file(Path::new("paper.PDF")).0, "pdf");
        assert_eq!(classify_file(Path::new("note.md")).0, "markdown");
        assert_eq!(classify_file(Path::new("photo.png")).0, "image");
        assert_eq!(classify_file(Path::new("archive.zip")).0, "file");
    }

    #[test]
    fn copies_and_hashes_without_changing_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("中文 file.txt");
        fs::write(&source, b"island").unwrap();
        let (copy, hash, size) = copy_and_hash(&source, &temp.path().join("staging")).unwrap();
        assert_eq!(size, 6);
        assert_eq!(fs::read(copy).unwrap(), b"island");
        assert_eq!(
            hash,
            "28cd2c5c15d13978a6bc06d38092dbbafb31f5590aa3ac120f9f8d8c0e0708c4"
        );
    }
}
