## ADDED Requirements

### Requirement: 应用窗口创建与生命周期管理
Electron 主进程 SHALL 在启动时创建一个浏览器窗口（BrowserWindow），加载内嵌后端服务的 URL，并管理窗口的完整生命周期（创建、最小化、关闭）。

#### Scenario: 应用启动时创建主窗口
- **WHEN** 用户双击桌面应用图标启动程序
- **THEN** 系统 SHALL 创建一个不小于 1200x800 像素的主窗口，并在后端服务就绪后加载应用界面

#### Scenario: 关闭主窗口时退出应用
- **WHEN** 用户点击窗口关闭按钮
- **THEN** 系统 SHALL 关闭内嵌后端服务并退出 Electron 进程

#### Scenario: macOS 点击 Dock 图标重新打开窗口
- **WHEN** 在 macOS 上所有窗口已关闭后用户点击 Dock 图标
- **THEN** 系统 SHALL 重新创建主窗口

---

### Requirement: 内嵌后端服务集成
Electron 主进程 SHALL 在渲染进程加载前启动内嵌 Node.js HTTP+WebSocket 后端服务，并将服务地址传递给渲染进程。

#### Scenario: 后端服务在随机可用端口启动
- **WHEN** Electron 应用启动
- **THEN** 系统 SHALL 自动选取一个可用端口（范围 3001-9999）启动内嵌服务，避免端口冲突

#### Scenario: 后端服务就绪后加载前端
- **WHEN** 内嵌后端服务成功监听端口
- **THEN** 主进程 SHALL 通知渲染进程加载对应的 `http://localhost:<port>` 地址

#### Scenario: 后端服务启动失败时提示用户
- **WHEN** 内嵌后端服务无法启动（端口全部被占用或其他错误）
- **THEN** 系统 SHALL 显示错误对话框并安全退出应用

---

### Requirement: IPC 安全预加载脚本
Electron preload 脚本 SHALL 通过 contextBridge 安全地将必要的平台信息暴露给渲染进程，遵循最小权限原则。

#### Scenario: 渲染进程获取后端服务地址
- **WHEN** 渲染进程初始化时
- **THEN** 系统 SHALL 通过 `window.electronAPI.getServerPort()` 提供后端端口号

#### Scenario: 渲染进程查询运行环境
- **WHEN** 渲染进程调用 `window.electronAPI.isElectron()`
- **THEN** 系统 SHALL 返回 `true`，使前端可以区分 Web 模式和 Electron 模式

---

### Requirement: 应用图标与元数据
桌面应用 SHALL 具备完整的应用图标（Windows .ico、macOS .icns、Linux .png）和正确的应用元数据（名称、版本、描述）。

#### Scenario: Windows 安装包显示应用图标
- **WHEN** Windows 用户在文件资源管理器中查看安装包或快捷方式
- **THEN** 系统 SHALL 显示 256x256 以上分辨率的应用图标

#### Scenario: macOS 应用包显示图标
- **WHEN** macOS 用户在 Finder 或 Launchpad 中查看应用
- **THEN** 系统 SHALL 显示 .icns 格式的多分辨率图标
