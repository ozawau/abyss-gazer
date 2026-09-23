# Abyss Gazer

跨平台任务管理客户端（Tauri，支持 macOS 与 Windows 打包）。

## 功能（MVP）

- 任务管理（新建、编辑、完成、删除、选中）
- 番茄钟（绑定选中任务；25 分钟专注 / 5 分钟休息）
- SQLite 本地存储
- 可扩展侧边栏（日程 / 日历 / 甘特图占位）

## 开发

```bash
npm install
npm run tauri dev
```

## 构建

在对应系统上执行：

```bash
npm run tauri build
```

Tauri 只会打当前系统可用的安装包：

- macOS：`src-tauri/target/release/bundle/macos/Abyss Gazer.app`（不打包 DMG）
- Windows：`src-tauri/target/release/bundle/nsis/` 下的 NSIS 安装程序（`.exe`）

Windows 安装包需要在 Windows 上构建，不能由 macOS 交叉编译产出。

## 数据存储

SQLite 与应用安装包分离，放在用户数据目录（重打包 / 覆盖安装不会丢数据）：

- macOS：`~/Library/Application Support/Abyss Gazer/abyss.db`
- Windows：`%AppData%/Abyss Gazer/abyss.db`
- Linux：`~/.local/share/abyss-gazer/abyss.db`

首次启动会自动尝试从旧的 bundle-id 路径迁移数据库。
