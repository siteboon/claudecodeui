<div align="center">
  <img src="public/logo.svg" alt="Claude Code UI" width="64" height="64">
  <h1>Claude Code UI</h1>
</div>

一个用于 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 和 [Cursor CLI](https://docs.cursor.com/en/cli/overview) 的桌面与移动端 Web 界面。你可以在本地或远程使用它，方便地查看 Claude Code / Cursor 中的活动项目与会话，并在任意设备（手机或电脑）上进行修改。支持 **Claude Sonnet 4**、**Opus 4.1**、**GPT-5** 等多种模型。

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [安全与工具配置](#安全与工具配置)
- [TaskMaster AI 集成（可选）](#taskmaster-ai-集成可选)
- [使用指南](#使用指南)
- [移动端体验](#移动端体验)
- [架构概览](#架构概览)
- [贡献指南](#贡献指南)
- [故障排查](#故障排查)
- [许可证](#许可证)
- [致谢](#致谢)
- [社区与支持](#社区与支持)

---

## 功能特性

- **自适应布局**：在桌面、平板和手机上都能正常工作，便于你在移动端使用 Claude Code
- **交互式聊天界面**：内置聊天界面，可与 Claude Code 或 Cursor 无缝交互
- **集成 Shell 终端**：通过内置终端直接访问 Claude Code / Cursor CLI
- **文件浏览器**：交互式文件树，支持语法高亮和在线编辑
- **Git 浏览器**：查看、暂存并提交修改，可切换分支
- **会话管理**：恢复对话、管理多会话并查看历史记录
- **TaskMaster AI 集成（可选）**：提供 AI 驱动的项目管理、PRD 解析与任务规划
- **模型兼容性**：支持 Claude Sonnet 4、Opus 4.1 和 GPT-5 等模型

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) v20 或更高版本
- 已安装并配置好的 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 和/或
- 已安装并配置好的 [Cursor CLI](https://docs.cursor.com/en/cli/overview)

### 一键运行（推荐）

无需安装，直接运行：

```bash
npx @siteboon/claude-code-ui
```

服务启动后默认可通过 `http://localhost:3001`（或你配置的 PORT）访问。

**重启方式**：停止服务后再次运行相同的 `npx` 命令即可。

### 全局安装（适合经常使用）

```bash
npm install -g @siteboon/claude-code-ui
```

安装完成后：

```bash
claude-code-ui
```

**重启方式**：使用 `Ctrl+C` 停止服务，然后再次运行 `claude-code-ui`。

### CLI 命令

全局安装后，你可以使用 `claude-code-ui` 和 `cloudcli` 两组命令：

```bash
# 启动服务（默认命令）
claude-code-ui
cloudcli start

# 查看配置与数据路径
cloudcli status

# 查看帮助
cloudcli help

# 查看版本
cloudcli version
```

`cloudcli status` 会显示：

- 安装目录位置
- 数据库存储位置（凭据保存位置）
- 当前配置（PORT、DATABASE_PATH 等）
- Claude 项目目录位置
- 配置文件路径

### 作为后台服务运行（生产环境推荐）

使用 PM2 将 Claude Code UI 以后台服务方式运行：

```bash
npm install -g pm2
```

启动服务：

```bash
pm2 start claude-code-ui --name "claude-code-ui"
# 或使用别名
pm2 start cloudcli --name "claude-code-ui"
```

开机自启：

```bash
pm2 startup
pm2 save
```

### 本地开发

1. 克隆仓库：

```bash
git clone https://github.com/siteboon/claudecodeui.git
cd claudecodeui
```

2. 安装依赖：

```bash
npm install
```

3. 配置环境变量：

```bash
cp .env.example .env
# 根据需要编辑 .env
```

4. 启动开发服务器：

```bash
npm run dev
```

应用将运行在 `.env` 中设置的端口上（默认 `3001`）。

5. 浏览器访问：

- 开发环境：`http://localhost:3001`

---

## 安全与工具配置

> **重要提示**：所有 Claude Code 工具默认处于禁用状态，以避免潜在危险操作被自动执行。

启用工具步骤：

1. 打开工具设置（侧边栏齿轮图标）
2. 根据需要选择性启用工具
3. 应用设置（偏好会保存在本地）

建议：先只启用基础工具，后续按需逐步开启更多能力。

---

## TaskMaster AI 集成（可选）

Claude Code UI 支持与 **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** 集成，用于更高级的项目管理与任务规划：

- 从 PRD 自动生成任务
- 智能拆解任务与依赖管理
- 看板视图与进度追踪

安装与配置方法请参考其 GitHub 仓库文档，安装完成后可在本项目设置中启用。

---

## 使用指南

### 项目管理

UI 会自动从 `~/.claude/projects/` 读取 Claude Code 项目，并提供：

- 可视化项目浏览
- 项目重命名、删除与整理
- 最近项目与会话快捷访问
- MCP 服务器管理（在 UI 中添加你自己的 MCP）

### 聊天界面

- 可在自适应聊天界面与 Claude Code / Cursor CLI 间切换
- WebSocket 实时流式响应
- 支持会话恢复与多会话管理
- 完整消息历史与元数据
- 支持文本、代码块与文件引用

### 文件浏览与编辑

- 交互式文件树
- 在线编辑并保存
- 多语言语法高亮
- 基本文件操作（新建、重命名、删除）

### Git 浏览

- 查看变更
- 暂存与提交
- 分支切换等（具体能力取决于配置）

### 会话管理

- 自动保存所有会话
- 按项目与时间组织
- 重命名、删除、导出会话
- 跨设备访问（通过统一服务端）

---

## 移动端体验

- 自适应移动端布局
- 触控优化（滑动、点击区域）
- 底部导航栏，便于单手操作
- 可添加到主屏幕，以 PWA 方式运行

---

## 架构概览

整体架构示意：

```text
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   前端          │    │   后端          │    │  Claude CLI     │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  集成           │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 后端（Node.js + Express）

- Express 服务与 REST API
- WebSocket 服务（聊天与项目刷新）
- 与 Claude Code / Cursor 的 CLI 进程管理
- 会话持久化（JSONL 等）
- 文件系统 API（提供项目文件浏览与编辑）

### 前端（React + Vite）

- 使用 React 18 组件化架构
- 基于 CodeMirror 的代码编辑器
- Tailwind CSS 构建界面样式

---

## 贡献指南

非常欢迎社区贡献！简单流程：

1. Fork 仓库
2. 克隆到本地：`git clone <your-fork-url>`
3. 安装依赖：`npm install`
4. 新建分支：`git checkout -b feature/my-feature`
5. 按现有代码风格进行开发
6. 运行校验：`npm run lint && npm run format`
7. 提交并推送：`git push origin feature/my-feature`
8. 提交 Pull Request，附上变更说明、必要截图与测试结果

---

## 故障排查

### “No Claude projects found”

可能原因：没有检测到 Claude 项目。

排查建议：

- 确认已正确安装 [Claude CLI](https://docs.anthropic.com/en/docs/claude-code)
- 在至少一个项目目录中运行一次 `claude` 命令
- 检查 `~/.claude/projects/` 目录是否存在且有权限

### 文件浏览器问题

如果出现文件无法加载、权限错误或目录为空：

- 检查项目目录权限（终端运行 `ls -la`）
- 确认项目路径存在且可访问
- 查看服务器日志以获取详细错误信息
- 确保没有尝试访问项目目录外的系统路径

---

## 许可证

本项目使用 **GNU General Public License v3.0**。

详情请参见仓库中的 [LICENSE](LICENSE) 文件。

你可以在 GPL v3 协议下自由使用、修改和分发本项目。

---

## 致谢

本项目基于以下关键技术构建：

- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**
- **[React](https://react.dev/)**
- **[Vite](https://vitejs.dev/)**
- **[Tailwind CSS](https://tailwindcss.com/)**
- **[CodeMirror](https://codemirror.net/)**
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)**（可选）

---

## 社区与支持

- 欢迎 Star 本仓库支持项目
- 关注更新与新版本发布
- 如有问题或建议，可通过 Issue 反馈

---

<div align="center">
  <strong>为 Claude Code 社区用心打造。</strong>
</div>
