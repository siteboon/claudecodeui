## ADDED Requirements

### Requirement: Windows 平台安装包构建
构建系统 SHALL 能够生成适用于 Windows x64 的 NSIS 安装包（.exe）和便携版（Portable .exe）。

#### Scenario: 构建 Windows NSIS 安装包
- **WHEN** 执行 `npm run dist:win` 或 CI 触发 Windows 构建
- **THEN** 系统 SHALL 在 `release/` 目录下生成可安装的 `.exe` 安装程序，支持安装路径选择和桌面快捷方式创建

#### Scenario: 构建 Windows 便携版
- **WHEN** 执行 Windows 构建命令
- **THEN** 系统 SHALL 同时生成不需要安装、可直接运行的便携版 `.exe` 文件

#### Scenario: Windows 安装包包含所有必要运行时
- **WHEN** 用户在没有安装 Node.js 的 Windows 机器上运行安装包
- **THEN** 应用 SHALL 能正常启动（Electron 自带 Node.js 运行时，无需外部依赖）

---

### Requirement: macOS 平台安装包构建
构建系统 SHALL 能够生成适用于 macOS 的 DMG 安装镜像和 ZIP 压缩包，支持 Intel（x64）和 Apple Silicon（arm64）。

#### Scenario: 构建 macOS DMG 安装镜像
- **WHEN** 执行 `npm run dist:mac` 或 CI 触发 macOS 构建
- **THEN** 系统 SHALL 在 `release/` 目录下生成 `.dmg` 文件，包含应用拖拽安装界面

#### Scenario: 构建 macOS Universal Binary
- **WHEN** 执行 macOS 构建命令
- **THEN** 系统 SHALL 生成同时支持 Intel 和 Apple Silicon 的 Universal 二进制包（或分别构建 x64 和 arm64 包）

#### Scenario: macOS 应用首次运行安全提示
- **WHEN** 用户在未签名的情况下首次打开应用
- **THEN** 系统 SHALL 允许用户通过"系统偏好设置-安全性"或右键打开的方式运行应用（开发阶段行为）

---

### Requirement: native 模块自动重新编译
构建系统 SHALL 在打包前自动将 `node-pty` 等 native 模块针对目标 Electron 版本重新编译。

#### Scenario: 构建时自动 rebuild native 模块
- **WHEN** 执行任何 `dist:*` 构建命令
- **THEN** `electron-builder` SHALL 自动触发 `electron-rebuild`，确保 `node-pty` 与 Electron 的 Node.js ABI 匹配

#### Scenario: rebuild 失败时构建中止并报错
- **WHEN** `node-pty` rebuild 过程中出现编译错误
- **THEN** 构建系统 SHALL 中止构建并输出明确的错误信息，不生成损坏的安装包

---

### Requirement: GitHub Actions 跨平台 CI 构建
项目 SHALL 提供 GitHub Actions 工作流，在对应平台的 runner 上自动构建并将安装包上传为 Release 附件。

#### Scenario: 推送 Release Tag 时触发自动构建
- **WHEN** 向仓库推送 `v*.*.*` 格式的 Git 标签
- **THEN** GitHub Actions SHALL 同时在 `windows-latest` 和 `macos-latest` runner 上并行执行构建

#### Scenario: 构建产物上传到 GitHub Release
- **WHEN** 跨平台构建全部成功完成
- **THEN** 工作流 SHALL 将 Windows `.exe` 和 macOS `.dmg` 安装包上传至对应的 GitHub Release 页面

#### Scenario: 构建失败时 Release 不发布
- **WHEN** 任意平台构建失败
- **THEN** GitHub Actions SHALL 标记工作流为失败状态，不发布不完整的 Release

---

### Requirement: 本地开发调试模式
开发者 SHALL 能够在本地以 Electron 模式启动应用进行调试，无需每次完整打包。

#### Scenario: 本地 Electron 开发模式启动
- **WHEN** 执行 `npm run electron:dev`
- **THEN** 系统 SHALL 同时启动 Vite dev server 和 Electron，Electron 窗口加载 Vite 本地开发地址，支持热重载
