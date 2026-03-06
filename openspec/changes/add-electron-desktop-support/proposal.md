## Why

ClaudeCodeUI 目前是一个纯 Web 应用，用户必须在终端启动服务并通过浏览器访问，使用门槛较高。通过集成 Electron，可以将应用打包为原生桌面程序，用户双击即可运行，获得与本地应用一致的体验，同时支持 Windows 和 macOS 平台发行。

## What Changes

- 新增 Electron 主进程入口（`electron/main.js`），负责创建窗口、内嵌 Node.js 服务并加载前端
- 新增 Electron 预加载脚本（`electron/preload.js`），安全暴露 IPC 接口
- 新增桌面应用构建配置（`electron-builder` 或 `@electron-forge`），支持打包 Windows（.exe/.msi）和 macOS（.dmg/.app）安装包
- 新增 npm 构建脚本：`build:electron`、`dist:win`、`dist:mac`、`dist:all`
- 修改 Vite 配置，区分 Web 与 Electron 构建模式
- 新增应用图标资源（`build/icons/`）
- 新增 GitHub Actions 工作流，自动构建多平台安装包并发布到 Release

## Capabilities

### New Capabilities

- `electron-app`: Electron 主进程与窗口管理，内嵌后端服务，提供桌面应用完整生命周期
- `electron-build`: 多平台打包与分发，支持 Windows（NSIS 安装包 / Portable）和 macOS（DMG / ZIP）
- `electron-auto-update`: （可选）基于 electron-updater 的自动更新能力

### Modified Capabilities

（无现有规范变更）

## Impact

- **依赖**：新增 `electron`、`electron-builder`（devDependencies）
- **构建流程**：Vite 先构建前端，Electron Builder 再打包成安装包
- **package.json**：新增 `main` 字段指向 electron 入口（或在 electron 专用 package.json 中），新增构建脚本
- **服务器端**：`server/index.js` 需兼容被 Electron 主进程直接 `require` 的方式（不 `process.exit`，暴露 `close` 方法）
- **前端**：区分运行环境（Web vs Electron），Electron 模式下直连内嵌服务
- **CI/CD**：新增跨平台构建工作流（Windows / macOS runner）
