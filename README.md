# Abyss Gazer

跨平台任务管理客户端（首版：macOS / Tauri）。

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

```bash
npm run tauri build
```

数据文件位于 macOS：

`~/Library/Application Support/com.abyssgazer.desktop/abyss.db`
