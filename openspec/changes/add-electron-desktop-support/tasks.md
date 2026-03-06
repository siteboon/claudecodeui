## 1. 安装依赖与基础配置

- [x] 1.1 安装 `electron` 和 `electron-builder` 为 devDependencies：`npm install --save-dev electron electron-builder`
- [x] 1.2 安装 `@electron/rebuild` 用于 native 模块重新编译：`npm install --save-dev @electron/rebuild`
- [x] 1.3 安装 `detect-port`（或 `portfinder`）用于动态端口选取：使用 Node.js 内置 `net` 模块实现，无需额外依赖
- [x] 1.4 安装 `concurrently` 和 `wait-on` 用于开发模式并行启动：`npm install --save-dev wait-on`（concurrently 已存在则跳过）

## 2. Electron 主进程与预加载脚本

- [x] 2.1 创建 `electron/main.js`：主进程入口，负责启动内嵌后端服务、动态选取端口、创建 BrowserWindow
- [x] 2.2 在 `electron/main.js` 中实现 `app.on('window-all-closed')` 和 `app.on('activate')` 处理跨平台窗口生命周期
- [x] 2.3 创建 `electron/preload.js`：通过 `contextBridge` 暴露 `window.electronAPI.getServerPort()` 和 `window.electronAPI.isElectron()`
- [x] 2.4 修改 `server/index.js`，使其在被 `require` 时不立即绑定固定端口，而是导出一个 `startServer(port)` 函数供主进程调用（保持原有 `node server/index.js` 直接运行兼容性）

## 3. 构建配置

- [x] 3.1 在 `package.json` 中添加 `"main": "electron/main.js"` 字段（Electron 入口）- 通过 `extraMetadata.main` 在打包时覆盖，保留 npm 兼容性
- [x] 3.2 在 `package.json` 中添加 `build` 配置节（electron-builder 配置）：
  - `appId`、`productName`、`copyright`
  - `directories.output: "release"`
  - `files` 排除规则（排除 `src/`、`openspec/` 等不需要打包的目录）
  - `win`: NSIS 安装包 + Portable 目标
  - `mac`: DMG + ZIP 目标，`target` 包含 `x64` 和 `arm64`
  - `asar: true` 启用压缩
- [x] 3.3 在 `package.json` `scripts` 中添加构建脚本：
  - `"electron:dev"`: 并行启动 Vite dev server 和 Electron（使用 `concurrently` + `wait-on`）
  - `"electron:build"`: 先执行 `vite build` 再执行 `electron-builder`
  - `"dist:win"`: `electron-builder --win`
  - `"dist:mac"`: `electron-builder --mac`
  - `"dist:all"`: `electron-builder --win --mac`
- [x] 3.4 创建 `electron-builder` 的 `afterPack` 钩子脚本 `scripts/electron-rebuild.js`，在打包后自动 rebuild `node-pty`

## 4. 应用图标资源

- [x] 4.1 创建 `build/icons/` 目录，放置以下图标文件：
  - `icon.ico`（Windows，256x256 多尺寸）- 由 `scripts/generate-electron-icons.js` 在 CI 中生成
  - `icon.icns`（macOS）- 由 CI 中 `iconutil` 从 iconset 生成
  - `icon.png`（512x512，Linux 及通用备用）- 已从 `public/icons/icon-512x512.png` 复制
- [x] 4.2 在 electron-builder 配置中引用图标路径（`"icon": "build/icons/icon"`）

## 5. 前端适配

- [x] 5.1 在前端入口（`src/main.jsx` 或 `src/App.tsx`）中检测 `window.electronAPI?.isElectron()` 并在 Electron 模式下使用 `window.electronAPI.getServerPort()` 动态构建 API baseURL - **无需修改**：frontend 使用 `window.location.host` 自然适配 Electron
- [x] 5.2 确认前端 WebSocket 连接地址在 Electron 模式下正确指向 `localhost:<port>`（检查 `/ws` 和 `/shell` 连接逻辑）- **已确认**：`ws://127.0.0.1:PORT/ws` 和 `/shell` 均正确

## 6. Vite 构建配置适配

- [x] 6.1 修改 `vite.config.js`，在非 dev 模式（build 模式）下不配置 proxy（Electron 生产包直接访问内嵌服务，无需代理）- **无需修改**：proxy 仅在 `server` 段，`vite build` 不使用
- [x] 6.2 确认 `vite build` 输出的 `dist/index.html` 资源路径使用相对路径（`base: "./"` 或 `base: "/"` 适合 Electron file:// 或 http://localhost 加载）- **已确认**：默认 `base: "/"` 适合 `http://127.0.0.1:PORT` 加载

## 7. GitHub Actions CI/CD

- [x] 7.1 创建 `.github/workflows/electron-build.yml` 工作流文件
- [x] 7.2 配置触发条件：推送 `v*.*.*` Tag 时触发
- [x] 7.3 配置 `windows-latest` job：checkout → Node.js setup → npm ci → npm run dist:win → 上传产物
- [x] 7.4 配置 `macos-latest` job：checkout → Node.js setup → npm ci → npm run dist:mac → 上传产物
- [x] 7.5 配置 Release 上传步骤：使用 `softprops/action-gh-release` 或 `gh release upload` 将 `release/` 目录下的安装包上传至对应 GitHub Release

## 8. 验证与测试

- [ ] 8.1 本地 Windows 或 macOS 环境执行 `npm run electron:dev`，确认应用窗口正常启动、功能可用
- [ ] 8.2 执行 `npm run dist:win`（Windows 环境）或 `npm run dist:mac`（macOS 环境），确认 `release/` 目录下生成安装包
- [ ] 8.3 安装生成的安装包，验证应用可正常启动并连接后端服务
- [ ] 8.4 验证 WebSocket 终端功能在 Electron 桌面包中正常工作
- [ ] 8.5 推送测试 Tag，验证 GitHub Actions 工作流成功运行并生成 Release 附件
