# Island

Island 是一个本地优先的 Windows 桌面收藏工具。把文件拖进悬浮岛，或在主窗口保存链接和文字；内容会复制到本地资料库，并可通过标题、文件名、链接和备注搜索。

当前仓库实现的是 `0.2.0` MVP 基线：

- Windows 悬浮岛、文件拖放、托盘与 `Ctrl + Shift + I` 快捷键
- PDF、图片、文本、Markdown、通用文件、URL 收藏
- SHA-256 重复检测与不可变托管文件
- SQLite WAL、事务、FTS5 搜索与启动完整性检查
- 收件箱、最近、收藏、回收站和三栏详情界面
- 图片/文字内置预览，其他内容使用系统默认应用打开
- 数据库快照、JSON/CSV/原始文件完整导出
- 默认无遥测、无 AI、无内容上传

## 开发环境

- Windows 10 22H2 或 Windows 11 x64
- Node.js 18+
- Rust stable
- Visual Studio C++ Build Tools（Desktop development with C++）
- Edge WebView2 Runtime

## 本地运行

```powershell
npm install
npm run tauri dev
```

只预览 React 界面：

```powershell
npm run dev
```

浏览器预览使用内存演示数据，不会读取或写入真实资料库。

## 验证

```powershell
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## 数据位置

默认数据根目录由 Tauri 的应用数据目录确定，其下结构为：

```text
IslandData/
├── database/island.db
├── assets/{pdf,images,files,webpage}
├── thumbnails/
├── cache/staging/
├── backups/
├── exports/
├── logs/
└── config/
```

导入文件会先写入 staging、同步到磁盘、校验大小与 SHA-256，再原子移动到托管目录并写入数据库。解析失败不得删除原始内容。

## 当前边界

以下能力按路线图延后：PDF/网页正文解析、OCR、自动标签、AI Provider、语义搜索、数据目录迁移、开机启动、代码签名、macOS/Linux。

路线与验收标准见 [ROADMAP.md](ROADMAP.md)，产品和视觉原则见 [PRODUCT.md](PRODUCT.md) 与 [DESIGN.md](DESIGN.md)。

## License

Apache-2.0
