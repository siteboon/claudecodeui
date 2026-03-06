## Context

ClaudeCodeUI 是一个基于 React + Vite 的前端和 Node.js（Express）后端的 Web 应用，当前通过 `npm run dev` / `npm run start` 在本地启动服务，用户通过浏览器访问。后端使用 WebSocket 处理终端交互，并通过 `node-pty` 管理进程。

本设计将引入 Electron 作为桌面容器，Electron 主进程内嵌 Node.js 后端，渲染进程加载前端页面，最终打包为 Windows（.exe / .msi）和 macOS（.dmg / .app）原生安装包。

## Goals / Non-Goals

**Goals:**
- 使用 Electron 封装现有 Web 应用，实现无需浏览器的桌面端体验
- 支持 Windows x64 和 macOS（Intel + Apple Silicon）构建
- 保持 Web 端功能不变，不破坏现有的 `npm run dev` / `npm run start` 工作流
- GitHub Actions 实现跨平台自动构建并发布 Release

**Non-Goals:**
- 自动更新（auto-updater）：本次不包含，后续可扩展
- Linux 桌面包（.deb / .AppImage）：本次不包含
- 代码签名和公证（Windows EV / macOS Notarization）：预留配置项，正式发版时配置
- 完全重写前端为 Electron-native 组件

## Decisions

### 决策 1：集成方式 —— 内嵌 HTTP 服务 vs 纯 IPC

**选择**：Electron 主进程直接 `require` 现有 `server/index.js` 启动内嵌 HTTP+WebSocket 服务，渲染进程通过 `localhost` 连接。

**理由**：
- 与现有 Web 架构零改动：前端代码、API 路由、WebSocket 均无需修改
- 避免将所有后端逻辑重写为 Electron IPC，减少风险
- `node-pty` 等依赖天然在主进程中运行，无需 contextBridge 适配

**替代方案**：改写后端为纯 IPC 通信 → 工程量大，且破坏 Web 端复用性，弃用。

---

### 决策 2：打包工具 —— electron-builder vs electron-forge

**选择**：使用 `electron-builder`。

**理由**：
- 配置灵活，支持 NSIS（Windows 安装包）、Portable、DMG、ZIP 等多种目标
- 与 GitHub Actions `electron-builder-binaries` 缓存集成成熟
- 社区文档和案例更丰富，`node-pty` 的 native rebuild 支持更稳定

**替代方案**：electron-forge → 插件生态较新，`node-pty` rebuild 配置较复杂，弃用。

---

### 决策 3：前端构建输出复用

**选择**：Electron 打包时复用 `vite build` 生成的 `dist/` 目录，主进程通过 `file://` 协议加载，而非再起一个 dev server。

**理由**：
- 生产包体积更小，无需包含 Vite 开发服务器
- 与现有 `npm run build` 流程无缝衔接

---

### 决策 4：端口选择策略

内嵌服务监听随机可用端口（避免与系统服务冲突），主进程启动后将端口号通过环境变量或 `globalThis` 传递给渲染进程，渲染进程加载的 HTML 中通过 preload 脚本获取后端地址。

---

### 决策 5：native 模块 rebuild

`node-pty` 是 native addon，需在 Electron 的 Node.js ABI 下重新编译。使用 `electron-builder` 的 `afterInstall` hook 触发 `electron-rebuild`，在 GitHub Actions 中缓存 rebuild 结果。

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|---------|
| `node-pty` native rebuild 在 CI 中失败（尤其 Windows arm64） | 锁定 Electron 版本，固定 `node-pty` 版本，CI 缓存 rebuild 产物 |
| macOS 代码签名缺失导致 Gatekeeper 拦截 | 开发阶段提供"右键-打开"说明；正式发版配置 Apple Developer 证书和 Notarization |
| 内嵌端口冲突 | 使用 `portfinder` 或 `detect-port` 动态选取可用端口 |
| Electron 包体积过大（通常 > 100MB） | 使用 `electron-builder` 的 `asar` 压缩 + `files` 排除 node_modules 中不需要的包 |
| Windows 构建需要在 Windows runner 上执行（cross-compile 不稳定） | CI 使用 `windows-latest` runner 专门构建 Windows 包 |

## Migration Plan

1. 现有 Web 端不受影响，继续通过 `npm run dev` / `npm start` 使用
2. 新增 `npm run electron:dev`（开发调试）和 `npm run dist:all`（打包发行）
3. 首次发布通过 GitHub Actions 手动触发，验证产物后再配置自动触发

## Open Questions

- 是否需要系统托盘（Tray）图标和最小化到托盘？（当前暂不实现，可后续添加）
- 是否需要开机自启动选项？（暂不实现）
- Windows 代码签名证书采购计划？
