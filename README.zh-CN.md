<div align="center">
  <img src="public/logo.svg" alt="Claude Code UI" width="64" height="64">
  <h1>Cloud CLI (又名 Claude Code UI)</h1>
</div>


[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Cursor CLI](https://docs.cursor.com/en/cli/overview) 和 [Codex](https://developers.openai.com/codex) 的桌面端和移动端界面。您可以在本地或远程使用它来查看 Claude Code、Cursor 或 Codex 中的活跃项目和会话,并从任何地方(移动端或桌面端)对它们进行修改。这为您提供了一个在任何地方都能正常使用的合适界面。

 [English](./README.md) | [中文](./README.zh-CN.md)

## 截图

<div align="center">

<table>
<tr>
<td align="center">
<h3>桌面视图</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>显示项目概览和聊天界面的主界面</em>
</td>
<td align="center">
<h3>移动端体验</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>具有触摸导航的响应式移动设计</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI 选择</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>在 Claude Code、Cursor CLI 和 Codex 之间选择</em>
</td>
</tr>
</table>



</div>

## 功能特性

- **响应式设计** - 在桌面、平板和移动设备上无缝运行,您也可以在移动端使用 Claude Code、Cursor 或 Codex
- **交互式聊天界面** - 内置聊天界面,与 Claude Code、Cursor 或 Codex 无缝通信
- **集成 Shell 终端** - 通过内置 shell 功能直接访问 Claude Code、Cursor CLI 或 Codex
- **文件浏览器** - 交互式文件树,支持语法高亮和实时编辑
- **Git 浏览器** - 查看、暂存和提交您的更改。您还可以切换分支
- **会话管理** - 恢复对话、管理多个会话并跟踪历史记录
- **TaskMaster AI 集成** *(可选)* - 通过 AI 驱动的任务规划、PRD 解析和工作流自动化实现高级项目管理
- **模型兼容性** - 适用于 Claude Sonnet 4.5、Opus 4.5 和 GPT-5.2


## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) v20 或更高版本
- 已安装并配置 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code),和/或
- 已安装并配置 [Cursor CLI](https://docs.cursor.com/en/cli/overview),和/或
- 已安装并配置 [Codex](https://developers.openai.com/codex)

### 一键操作(推荐)

无需安装,直接运行:

```bash
npx @siteboon/claude-code-ui
```

服务器将启动并可通过 `http://localhost:3001`(或您配置的 PORT)访问。

**重启**: 停止服务器后只需再次运行相同的 `npx` 命令

### 全局安装(供常规使用)

为了频繁使用,一次性全局安装:

```bash
npm install -g @siteboon/claude-code-ui
```

然后使用简单命令启动:

```bash
claude-code-ui
```


**重启**: 使用 Ctrl+C 停止,然后再次运行 `claude-code-ui`。

**更新**:
```bash
cloudcli update
```

### CLI 使用方法

全局安装后,您可以访问 `claude-code-ui` 和 `cloudcli` 命令:

| 命令 / 选项 | 简写 | 描述 |
|------------------|-------|-------------|
| `cloudcli` 或 `claude-code-ui` | | 启动服务器(默认) |
| `cloudcli start` | | 显式启动服务器 |
| `cloudcli status` | | 显示配置和数据位置 |
| `cloudcli update` | | 更新到最新版本 |
| `cloudcli help` | | 显示帮助信息 |
| `cloudcli version` | | 显示版本信息 |
| `--port <port>` | `-p` | 设置服务器端口(默认: 3001) |
| `--database-path <path>` | | 设置自定义数据库位置 |

**示例:**
```bash
cloudcli                          # 使用默认设置启动
cloudcli -p 8080              # 在自定义端口启动
cloudcli status                   # 显示当前配置
```

### 作为后台服务运行(推荐用于生产环境)

在生产环境中,使用 PM2(Process Manager 2)将 Claude Code UI 作为后台服务运行:

#### 安装 PM2

```bash
npm install -g pm2
```

#### 作为后台服务启动

```bash
# 在后台启动服务器
pm2 start claude-code-ui --name "claude-code-ui"

# 或使用更短的别名
pm2 start cloudcli --name "claude-code-ui"

# 在自定义端口启动
pm2 start cloudcli --name "claude-code-ui" -- --port 8080
```


#### 系统启动时自动启动

要使 Claude Code UI 在系统启动时自动启动:

```bash
# 为您的平台生成启动脚本
pm2 startup

# 保存当前进程列表
pm2 save
```


### 本地开发安装

1. **克隆仓库:**
```bash
git clone https://github.com/siteboon/claudecodeui.git
cd claudecodeui
```

2. **安装依赖:**
```bash
npm install
```

3. **配置环境:**
```bash
cp .env.example .env
# 使用您喜欢的设置编辑 .env
```

4. **启动应用程序:**
```bash
# 开发模式(支持热重载)
npm run dev

```
应用程序将在您在 .env 中指定的端口启动

5. **打开浏览器:**
   - 开发环境: `http://localhost:3001`

## 安全与工具配置

**🔒 重要提示**: 所有 Claude Code 工具**默认禁用**。这可以防止潜在的有害操作自动运行。

### 启用工具

要使用 Claude Code 的完整功能,您需要手动启用工具:

1. **打开工具设置** - 点击侧边栏中的齿轮图标
3. **选择性启用** - 仅打开您需要的工具
4. **应用设置** - 您的偏好设置将保存在本地

<div align="center">

![工具设置模态框](public/screenshots/tools-modal.png)
*工具设置界面 - 仅启用您需要的内容*

</div>

**推荐方法**: 首先启用基本工具,然后根据需要添加更多。您可以随时调整这些设置。

## TaskMaster AI 集成 *(可选)*

Claude Code UI 支持 **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)**(aka claude-task-master)集成,用于高级项目管理和 AI 驱动的任务规划。

它提供
- 从 PRD(产品需求文档)生成 AI 驱动的任务
- 智能任务分解和依赖管理
- 可视化任务板和进度跟踪

**设置与文档**: 访问 [TaskMaster AI GitHub 仓库](https://github.com/eyaltoledano/claude-task-master)获取安装说明、配置指南和使用示例。
安装后,您应该能够从设置中启用它


## 使用指南

### 核心功能

#### 项目管理
当可用时,它会自动发现 Claude Code、Cursor 或 Codex 会话并将它们分组到项目中
- **项目操作** - 重命名、删除和组织项目
- **智能导航** - 快速访问最近的项目和会话
- **MCP 支持** - 通过 UI 添加您自己的 MCP 服务器

#### 聊天界面
- **使用响应式聊天或 Claude Code/Cursor CLI/Codex CLI** - 您可以使用自适应聊天界面或使用 shell 按钮连接到您选择的 CLI
- **实时通信** - 通过 WebSocket 连接从您选择的 CLI(Claude Code/Cursor/Codex)流式传输响应
- **会话管理** - 恢复之前的对话或启动新会话
- **消息历史** - 带有时间戳和元数据的完整对话历史
- **多格式支持** - 文本、代码块和文件引用

#### 文件浏览器与编辑器
- **交互式文件树** - 使用展开/折叠导航浏览项目结构
- **实时文件编辑** - 直接在界面中读取、修改和保存文件
- **语法高亮** - 支持多种编程语言
- **文件操作** - 创建、重命名、删除文件和目录

#### Git 浏览器


#### TaskMaster AI 集成 *(可选)*
- **可视化任务板** - 用于管理开发任务的看板风格界面
- **PRD 解析器** - 创建产品需求文档并将其解析为结构化任务
- **进度跟踪** - 实时状态更新和完成跟踪

#### 会话管理
- **会话持久化** - 所有对话自动保存
- **会话组织** - 按项目和 timestamp 分组会话
- **会话操作** - 重命名、删除和导出对话历史
- **跨设备同步** - 从任何设备访问会话

### 移动应用
- **响应式设计** - 针对所有屏幕尺寸进行优化
- **触摸友好界面** - 滑动手势和触摸导航
- **移动导航** - 底部选项卡栏,方便拇指导航
- **自适应布局** - 可折叠侧边栏和智能内容优先级
- **添加到主屏幕快捷方式** - 添加快捷方式到主屏幕,应用程序将像 PWA 一样运行

## 架构

### 系统概览

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Agent     │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  Integration    │
│                 │    │                 │    │                │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 后端 (Node.js + Express)
- **Express 服务器** - 具有静态文件服务的 RESTful API
- **WebSocket 服务器** - 用于聊天和项目刷新的通信
- **Agent 集成 (Claude Code / Cursor CLI / Codex)** - 进程生成和管理
- **文件系统 API** - 为项目公开文件浏览器

### 前端 (React + Vite)
- **React 18** - 带有 hooks 的现代组件架构
- **CodeMirror** - 具有语法高亮的高级代码编辑器




### 贡献

我们欢迎贡献!请遵循以下指南:

#### 入门
1. **Fork** 仓库
2. **克隆** 您的 fork: `git clone <your-fork-url>`
3. **安装** 依赖: `npm install`
4. **创建** 特性分支: `git checkout -b feature/amazing-feature`

#### 开发流程
1. **进行更改**,遵循现有代码风格
2. **彻底测试** - 确保所有功能正常工作
3. **运行质量检查**: `npm run lint && npm run format`
4. **提交**,遵循 [Conventional Commits](https://conventionalcommits.org/)的描述性消息
5. **推送** 到您的分支: `git push origin feature/amazing-feature`
6. **提交** 拉取请求,包括:
   - 更改的清晰描述
   - UI 更改的截图
   - 适用时的测试结果

#### 贡献内容
- **错误修复** - 帮助我们提高稳定性
- **新功能** - 增强功能(先在 issue 中讨论)
- **文档** - 改进指南和 API 文档
- **UI/UX 改进** - 更好的用户体验
- **性能优化** - 让它更快

## 故障排除

### 常见问题与解决方案


#### "未找到 Claude 项目"
**问题**: UI 显示没有项目或项目列表为空
**解决方案**:
- 确保已正确安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- 至少在一个项目目录中运行 `claude` 命令以进行初始化
- 验证 `~/.claude/projects/` 目录存在并具有适当的权限

#### 文件浏览器问题
**问题**: 文件无法加载、权限错误、空目录
**解决方案**:
- 检查项目目录权限(在终端中使用 `ls -la`)
- 验证项目路径存在且可访问
- 查看服务器控制台日志以获取详细错误消息
- 确保您未尝试访问项目范围之外的系统目录


## 许可证

GNU General Public License v3.0 - 详见 [LICENSE](LICENSE) 文件。

本项目是开源的,在 GPL v3 许可下可自由使用、修改和分发。

## 致谢

### 构建工具
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic 的官方 CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor 的官方 CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - 用户界面库
- **[Vite](https://vitejs.dev/)** - 快速构建工具和开发服务器
- **[Tailwind CSS](https://tailwindcss.com/)** - 实用优先的 CSS 框架
- **[CodeMirror](https://codemirror.net/)** - 高级代码编辑器
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(可选)* - AI 驱动的项目管理和任务规划

## 支持与社区

### 保持更新
- **Star** 此仓库以表示支持
- **Watch** 以获取更新和新版本
- **Follow** 项目以获取公告

### 赞助商
- [Siteboon - AI powered website builder](https://siteboon.ai)
---

<div align="center">
  <strong>为 Claude Code、Cursor 和 Codex 社区精心打造。</strong>
</div>