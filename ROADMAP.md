# Island Roadmap

按每周 10–15 小时估算，总周期约 64–78 周。

## 0.2.1 — 可回退基线

- [x] 深海青＋雾灰主窗口、统一命令栏和三栏资料库
- [x] 知识 Agent、数据与阅读器架构更新

## 0.3 — 知识基础

- [x] Document、Chunk、Space、Relation、Snapshot、Annotation、Agent、Artifact 数据迁移
- [x] 空间、Agent、产出和处理中导航入口
- [x] 空间创建、多空间归属、手动标签与收藏项智能视图
- [ ] 持久后台任务、重试与处理状态面板
- [ ] 前端组件目录与 React Aria 行为层

## 0.4 — 统一阅读器

- [x] 独立 Island 阅读窗口
- [x] PDF.js 基础分页与缩放
- [x] 文本、图片和安全网页快照预览
- [x] 无 IPC capability 的在线访客 WebView，禁下载和弹窗
- [x] URL、DNS、私有网络、重定向和响应大小保护
- [ ] PDF 目录、全文查找、文本层和精确页码引用
- [ ] 网页正文抽取、图片本地化和快照版本管理
- [ ] 标注与阅读侧栏

## 0.5 — 解析与混合检索

- PDF、网页、Office、Markdown、代码解析
- Chunk 定位、FTS5、向量索引、OCR 和混合检索

## 0.6 — Agent Alpha

- Ollama、OpenAI Responses 和 OpenAI-compatible Provider
- 只读知识工具、流式任务线程、引用校验和 Artifact

## 0.7–0.8 — Agent 写操作与生态

- 审批式标签、备注、空间和关系写入
- 图片理解、音视频处理、本地转录、浏览器扩展和 MCP

## 0.9 — 开源预览

- 中英文界面、CI、安全与隐私审计、签名安装包
- 10–20 名预览用户验证

## 1.0 — 稳定

- 四周无 P0/P1，迁移、恢复和派生索引重建稳定
- 10,000 条搜索与 5,000 条知识库启动性能验收
