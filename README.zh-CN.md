<div align="center">
  <img src="public/logo.svg" alt="CloudCLI UI" width="64" height="64">
  <h1>Cloud CLI（又名 Claude Code UI）</h1>
  <p><a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>、<a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>、<a href="https://developers.openai.com/codex">Codex</a>、<a href="https://geminicli.com/">Gemini-CLI</a> 和 <a href="https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line">GitHub Copilot CLI</a> 的桌面端和移动端界面。<br>您可以在本地或远程使用它来随时随地查看活跃项目和会话。</p>
</div>

<p align="center">
  <a href="https://cloudcli.ai">CloudCLI Cloud</a> · <a href="https://cloudcli.ai/docs">文档</a> · <a href="https://discord.gg/buxwujPNRE">Discord</a> · <a href="https://github.com/siteboon/claudecodeui/issues">问题反馈</a> · <a href="CONTRIBUTING.md">贡献指南</a>
</p>

<p align="center">
  <a href="https://cloudcli.ai"><img src="https://img.shields.io/badge/☁️_CloudCLI_Cloud-立即体验-0066FF?style=for-the-badge" alt="CloudCLI Cloud"></a>
  <a href="https://discord.gg/buxwujPNRE"><img src="https://img.shields.io/badge/Discord-加入社区-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="加入我们的 Discord"></a>
  <br><br>
  <a href="https://github.com/siteboon/claudecodeui/releases/tag/v1.25.2"><img src="https://img.shields.io/badge/最新版本-v1.25.2-brightgreen?style=for-the-badge" alt="最新版本 v1.25.2"></a>
  <a href="https://github.com/siteboon/claudecodeui/releases"><img src="https://img.shields.io/github/v/release/siteboon/claudecodeui?style=for-the-badge&label=Release&color=blue" alt="GitHub Release"></a>
</p>

<div align="right"><i><a href="./README.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.ko.md">한국어</a> · <b>中文</b> · <a href="./README.ja.md">日本語</a> · <a href="./README.de.md">Deutsch</a></i></div>

---

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
<em>在 Claude Code、Gemini、Cursor CLI、Codex 和 GitHub Copilot 之间选择</em>
</td>
</tr>
</table>

</div>

## 功能特性

- **响应式设计** - 在桌面、平板和移动设备上无缝运行，您也可以在移动端使用 Agent
- **交互式聊天界面** - 内置聊天界面，与各 Agent 无缝通信
- **集成 Shell 终端** - 通过内置 shell 功能直接访问 Agent CLI
- **文件浏览器** - 交互式文件树，支持语法高亮和实时编辑
- **Git 浏览器** - 查看、暂存和提交您的更改，还可以切换分支
- **会话管理** - 恢复对话、管理多个会话并跟踪历史记录
- **插件系统** - 通过自定义插件扩展 CloudCLI——添加新标签页、后端服务和集成。[自建插件 →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI 集成** *(可选)* - 通过 AI 驱动的任务规划、PRD 解析和工作流自动化实现高级项目管理
- **模型兼容性** - 支持 Claude、GPT 和 Gemini 系列模型（完整列表见 [`shared/modelConstants.js`](shared/modelConstants.js)）


## 快速开始

### CloudCLI Cloud（推荐）

最快速的上手方式——无需本地配置。获得一个完全托管的容器化开发环境，可通过网页、移动应用、API 或您喜欢的 IDE 访问。

**[立即开始使用 CloudCLI Cloud](https://cloudcli.ai)**


### 自托管（开源）

使用 **npx** 立即体验 CloudCLI UI（需要 **Node.js** v22+）：

```
npx @siteboon/claude-code-ui
```

或**全局安装**以供常规使用：

```
npm install -g @siteboon/claude-code-ui
cloudcli
```

访问 `http://localhost:3001` —— 所有现有会话将自动发现。

访问 **[文档 →](https://cloudcli.ai/docs)** 了解完整配置选项、PM2、远程服务器设置等更多内容。


---

## 如何选择适合您的方案

CloudCLI UI 是驱动 CloudCLI Cloud 的开源 UI 层。您可以在自己的机器上自托管，也可以使用 CloudCLI Cloud，它在此基础上提供完整的托管云环境、团队功能和更深度的集成。

| | CloudCLI UI（自托管） | CloudCLI Cloud |
|---|---|---|
| **最适合** | 希望在本地机器上为 Agent 会话提供完整 UI 的开发者 | 希望 Agent 在云端运行、随处可访问的团队和开发者 |
| **访问方式** | 通过 `[您的IP]:端口` 在浏览器中访问 | 浏览器、任意 IDE、REST API、n8n |
| **配置** | `npx @siteboon/claude-code-ui` | 无需配置 |
| **机器需保持运行** | 是 | 否 |
| **移动端访问** | 网络内任意浏览器 | 任意设备，原生 App 即将推出 |
| **可用会话** | 从 `~/.claude` 自动发现所有会话 | 云环境内的所有会话 |
| **支持的 Agent** | Claude Code、Cursor CLI、Codex、Gemini CLI、GitHub Copilot CLI | Claude Code、Cursor CLI、Codex、Gemini CLI、GitHub Copilot CLI |
| **文件浏览器和 Git** | 是，内置于 UI | 是，内置于 UI |
| **MCP 配置** | 通过 UI 管理，与本地 `~/.claude` 配置同步 | 通过 UI 管理 |
| **IDE 访问** | 您的本地 IDE | 任意连接到云环境的 IDE |
| **REST API** | 是 | 是 |
| **n8n 节点** | 否 | 是 |
| **团队共享** | 否 | 是 |
| **平台费用** | 免费，开源 | 从 $7/月起 |

> 两种方案均使用您自己的 AI 订阅（Claude、Cursor 等）——CloudCLI 提供环境，不提供 AI。

---

## CLI 使用方法

全局安装后，您可以使用 `claude-code-ui` 和 `cloudcli` 命令：

| 命令 / 选项 | 简写 | 描述 |
|------------------|-------|-------------|
| `cloudcli` 或 `claude-code-ui` | | 启动服务器（默认） |
| `cloudcli start` | | 显式启动服务器 |
| `cloudcli status` | | 显示配置和数据位置 |
| `cloudcli update` | | 更新到最新版本 |
| `cloudcli help` | | 显示帮助信息 |
| `cloudcli version` | | 显示版本信息 |
| `--port <port>` | `-p` | 设置服务器端口（默认: 3001） |
| `--database-path <path>` | | 设置自定义数据库位置 |

**示例：**
```bash
cloudcli                    # 使用默认设置启动
cloudcli -p 8080            # 在自定义端口启动
cloudcli status             # 显示当前配置
```

---

## 安全与工具配置

**🔒 重要提示**：所有 Claude Code 工具**默认禁用**。这可以防止潜在的有害操作自动运行。

### 启用工具

要使用 Claude Code 的完整功能，您需要手动启用工具：

1. **打开工具设置** - 点击侧边栏中的齿轮图标
2. **选择性启用** - 仅打开您需要的工具
3. **应用设置** - 您的偏好设置将保存在本地

<div align="center">

![工具设置模态框](public/screenshots/tools-modal.png)
*工具设置界面 - 仅启用您需要的内容*

</div>

**推荐方法**：首先启用基本工具，然后根据需要添加更多。您可以随时调整这些设置。

---

## 插件

CloudCLI 拥有插件系统，让您可以添加带有自定义前端 UI 和可选 Node.js 后端的自定义标签页。直接在**设置 > 插件**中从 git 仓库安装插件，或自行构建。

### 可用插件

| 插件 | 描述 |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | 显示当前项目的文件数量、代码行数、文件类型分布、最大文件和最近修改的文件 |

### 自建插件

**[插件入门模板 →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — fork 此仓库以创建您自己的插件，包含前端渲染、实时上下文更新和后端服务器 RPC 通信的工作示例。

**[插件文档 →](https://cloudcli.ai/docs/plugin-overview)** — 插件 API、清单格式、安全模型等完整指南。

---

## TaskMaster AI 集成 *(可选)*

CloudCLI UI 支持 **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)**（又名 claude-task-master）集成，用于高级项目管理和 AI 驱动的任务规划。

它提供：
- 从 PRD（产品需求文档）生成 AI 驱动的任务
- 智能任务分解和依赖管理
- 可视化任务板和进度跟踪

**设置与文档**：访问 [TaskMaster AI GitHub 仓库](https://github.com/eyaltoledano/claude-task-master)获取安装说明、配置指南和使用示例。安装后，您可以从设置中启用它。

---

## 本地开发安装

1. **克隆仓库：**
```bash
git clone https://github.com/siteboon/claudecodeui.git
cd claudecodeui
```

2. **安装依赖：**
```bash
npm install
```

3. **配置环境：**
```bash
cp .env.example .env
# 使用您喜欢的设置编辑 .env
```

4. **启动应用程序：**
```bash
# 开发模式（支持热重载）
npm run dev
```
应用程序将在您在 .env 中指定的端口启动

5. **打开浏览器：**
   - 开发环境：`http://localhost:3001`

### 作为后台服务运行（推荐用于生产环境）

在生产环境中，使用 PM2（Process Manager 2）将 CloudCLI UI 作为后台服务运行：

```bash
# 安装 PM2
npm install -g pm2

# 在后台启动服务器
pm2 start claude-code-ui --name "claude-code-ui"

# 或使用更短的别名
pm2 start cloudcli --name "claude-code-ui"

# 在自定义端口启动
pm2 start cloudcli --name "claude-code-ui" -- --port 8080
```

#### 系统启动时自动启动

```bash
# 为您的平台生成启动脚本
pm2 startup

# 保存当前进程列表
pm2 save
```

---

## 常见问题

<details>
<summary>这与 Claude Code Remote Control 有何不同？</summary>

Claude Code Remote Control 让您向本地终端中已运行的会话发送消息。您的机器必须保持开启，终端必须保持打开，且会话在没有网络连接的情况下大约 10 分钟后会超时。

CloudCLI UI 和 CloudCLI Cloud 是对 Claude Code 的扩展而非并行工具——您的 MCP 服务器、权限、设置和会话与 Claude Code 原生使用的完全相同，没有任何重复或单独管理。

实际效果：

- **所有会话，而非仅一个** — CloudCLI UI 自动发现 `~/.claude` 文件夹中的每个会话。Remote Control 只暴露单个活跃会话。
- **您的设置就是您的设置** — 在 CloudCLI UI 中更改的 MCP 服务器、工具权限和项目配置直接写入您的 Claude Code 配置并立即生效，反之亦然。
- **支持更多 Agent** — Claude Code、Cursor CLI、Codex、Gemini CLI 和 GitHub Copilot CLI，不仅限于 Claude Code。
- **完整 UI，不只是聊天窗口** — 文件浏览器、Git 集成、MCP 管理和 shell 终端均内置。
- **CloudCLI Cloud 在云端运行** — 合上笔记本，Agent 继续运行。无需守候终端，无需保持机器唤醒。

</details>

<details>
<summary>需要单独付费购买 AI 订阅吗？</summary>

是的。CloudCLI 提供环境，不提供 AI。您需要自带 Claude、Cursor、Codex、Gemini 或 GitHub Copilot 订阅。CloudCLI Cloud 在此基础上从 $7/月起提供托管环境。

</details>

<details>
<summary>可以在手机上使用 CloudCLI UI 吗？</summary>

可以。对于自托管，在您的机器上运行服务器，然后在网络内任意浏览器中打开 `[您的IP]:端口`。对于 CloudCLI Cloud，可从任意设备访问——无需 VPN、无需端口转发、无需配置。原生 App 也正在开发中。

</details>

<details>
<summary>在 UI 中所做的更改会影响本地 Claude Code 设置吗？</summary>

会，对于自托管。CloudCLI UI 从 Claude Code 原生使用的同一 `~/.claude` 配置读取和写入。通过 UI 添加的 MCP 服务器会立即在 Claude Code 中生效，反之亦然。

</details>

---

## 版本发布

当前版本：**v1.25.2**（2026-03-11）

### 最新更新亮点（v1.25.2）

- 🌐 **插件国际化** - 为所有语言本地化插件设置
- 🔒 **安全修复** - 禁用命令中可执行的 gray-matter frontmatter
- 🐛 **多项错误修复** - 会话重连追赶、始终显示输入框、冻结会话恢复
- 🎨 **新设置页面设计** - 全新设置页面设计和新的 pill 组件

### 历史版本

查看完整的 [更新日志 →](CHANGELOG.md) 了解所有版本的变更记录。

| 版本 | 发布日期 | 主要特性 |
|------|---------|---------|
| [v1.25.2](https://github.com/siteboon/claudecodeui/releases/tag/v1.25.2) | 2026-03-11 | 插件国际化、安全修复、错误修复 |
| [v1.25.0](https://github.com/siteboon/claudecodeui/releases/tag/v1.25.0) | 2026-03-10 | 新插件系统、消息复制功能、俄语支持 |
| [v1.24.0](https://github.com/siteboon/claudecodeui/releases/tag/v1.24.0) | 2026-03-09 | 全文搜索会话、Git 安全修复 |
| [v1.23.2](https://github.com/siteboon/claudecodeui/releases/tag/v1.23.2) | 2026-03-06 | 查看完整日志 |

---

## 故障排除

### 常见问题与解决方案

#### "未找到 Claude 项目"
**问题**：UI 显示没有项目或项目列表为空
**解决方案**：
- 确保已正确安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- 至少在一个项目目录中运行 `claude` 命令以进行初始化
- 验证 `~/.claude/projects/` 目录存在并具有适当的权限

#### 文件浏览器问题
**问题**：文件无法加载、权限错误、空目录
**解决方案**：
- 检查项目目录权限（在终端中使用 `ls -la`）
- 验证项目路径存在且可访问
- 查看服务器控制台日志以获取详细错误消息
- 确保您未尝试访问项目范围之外的系统目录

---

## 社区与支持

- **[文档](https://cloudcli.ai/docs)** — 安装、配置、功能和故障排除
- **[Discord](https://discord.gg/buxwujPNRE)** — 获取帮助并与其他用户交流
- **[GitHub Issues](https://github.com/siteboon/claudecodeui/issues)** — 问题反馈和功能请求
- **[贡献指南](CONTRIBUTING.md)** — 如何为项目做贡献

## 许可证

GNU General Public License v3.0 - 详见 [LICENSE](LICENSE) 文件。

本项目是开源的，在 GPL v3 许可下可自由使用、修改和分发。

## 致谢

### 构建工具
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic 的官方 CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor 的官方 CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[Gemini-CLI](https://geminicli.com/)** - Google Gemini CLI
- **[GitHub Copilot CLI](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line)** - GitHub Copilot CLI
- **[React](https://react.dev/)** - 用户界面库
- **[Vite](https://vitejs.dev/)** - 快速构建工具和开发服务器
- **[Tailwind CSS](https://tailwindcss.com/)** - 实用优先的 CSS 框架
- **[CodeMirror](https://codemirror.net/)** - 高级代码编辑器
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(可选)* - AI 驱动的项目管理和任务规划

### 赞助商
- [Siteboon - AI powered website builder](https://siteboon.ai)

---

<div align="center">
  <strong>为 Claude Code、Cursor、Codex、Gemini 和 Copilot 社区精心打造。</strong>
</div>
