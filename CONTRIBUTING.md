# Contributing to Island

Island 当前优先保证本地收藏、存储、搜索和打开流程的可靠性。欢迎 Bug 修复、测试、文档、翻译、Windows 兼容性和小范围 UI 改进；大规模架构重写、同步、团队协作和完整笔记能力暂不接受。

## Development

1. 安装 README 中列出的 Windows、Node、Rust 和 WebView2 依赖。
2. 运行 `npm install`。
3. 使用 `npm run tauri dev` 启动桌面应用。
4. 提交前运行 README 中的全部验证命令。

## Pull requests

- 一个 PR 只解决一个清晰问题。
- 描述用户价值、验收方式和不在范围内的内容。
- 数据层修改必须包含迁移与恢复测试。
- UI 修改必须覆盖键盘焦点、空状态、错误状态和减少动态效果。
- 不得提交真实资料、个人路径、API Key、签名证书或构建密钥。

所有贡献默认按 Apache-2.0 许可证提交。
