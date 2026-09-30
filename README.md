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

## Git 数据同步（逻辑同步 v1）

启用 Git 同步时，不再把整个 `abyss.db` 提交进仓库（避免二进制合并冲突）。流程为：`git pull` → 将 `sync/` 合并进本地库 → 从本地库 export 到 `sync/` → 仅提交 `sync/` 与 `.gitignore`。删除通过 tombstone + `deleted: true` 的 JSON 传播。若远程仍是旧格式（只有 `abyss.db`），第一次同步会把当前库内容导出为 `sync/` 并完成迁移，不丢历史。手机端请用 **ozawa-synchronizor** 安卓应用对 Gazer 数据目录 pull/push。
