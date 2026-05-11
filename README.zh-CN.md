<div align="center">
  <img src="public/logo.svg" alt="CloudCLI UI" width="64" height="64">
  <h1>Cloud CLI（又名 Claude Code UI）</h1>
  <p><a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>、<a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>、<a href="https://developers.openai.com/codex">Codex</a> 和 <a href="https://geminicli.com/">Gemini-CLI</a> 的桌面和移动端 UI。可在本地或远程使用，从任何地方查看激活的项目与会话。</p>
</div>

<p align="center">
  <a href="https://cloudcli.ai">CloudCLI Cloud</a> · <a href="https://cloudcli.ai/docs">文档</a> · <a href="https://discord.gg/buxwujPNRE">Discord</a> · <a href="https://github.com/siteboon/claudecodeui/issues">Bug 报告</a> · <a href="CONTRIBUTING.md">贡献指南</a>
</p>

<p align="center">
  <a href="https://cloudcli.ai"><img src="https://img.shields.io/badge/☁️_CloudCLI_Cloud-Try_Now-0066FF?style=for-the-badge" alt="CloudCLI Cloud"></a>
  <a href="https://discord.gg/buxwujPNRE"><img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="加入 Discord 社区"></a>
  <br><br>
  <a href="https://trendshift.io/repositories/15586" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15586" alt="siteboon%2Fclaudecodeui | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<div align="right"><i><a href="./README.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <b>中文</b> · <a href="./README.ja.md">日本語</a> · <a href="./README.tr.md">Türkçe</a></i></div>

---

## 截图

<div align="center">

<table>
<tr>
<td align="center">
<h3>桌面视图</h3>
<img src="public/screenshots/desktop-main.png" alt="桌面界面" width="400">
<br>
<em>显示项目概览和聊天的主界面</em>
</td>
<td align="center">
<h3>移动体验</h3>
<img src="public/screenshots/mobile-chat.png" alt="移动界面" width="250">
<br>
<em>具有触控导航的响应式移动设计</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI 选择</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI 选择" width="400">
<br>
<em>在 Claude Code、Gemini、Cursor CLI 与 Codex 之间进行选择</em>
</td>
</tr>
</table>

</div>

## 功能

- **响应式设计** - 在桌面、平板和移动设备上无缝运行，让您随时随地使用 Agents
- **交互聊天界面** - 内置聊天 UI，轻松与 Agents 交流
- **集成 Shell 终端** - 通过内置 shell 功能直接访问 Agents CLI
- **文件浏览器** - 交互式文件树，支持语法高亮与实时编辑
- **Git 浏览器** - 查看、暂存并提交更改，还可切换分支
- **会话管理** - 恢复对话、管理多个会话并跟踪历史记录
- **插件系统** - 通过自定义选项卡、后端服务与集成扩展 CloudCLI。 [开始构建 →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI 集成** *(可选)* - 结合 AI 任务规划、PRD 分析与工作流自动化，实现高级项目管理
- **模型兼容性** - 支持 Claude、GPT、Gemini 模型家族（完整支持列表见 [`shared/modelConstants.js`](shared/modelConstants.js)）

## 快速开始

### CloudCLI Cloud（推荐）

无需本地设置即可快速启动。提供可通过网络浏览器、移动应用、API 或喜欢的 IDE 访问的完全集装式托管开发环境。

**[立即开始 CloudCLI Cloud](https://cloudcli.ai)**

### 自托管（开源）

#### npm

启动 CloudCLI UI，只需一行 `npx`（需要 Node.js v22+）：

```bash
npx @cloudcli-ai/cloudcli
```

或进行全局安装，便于日常使用：

```bash
npm install -g @cloudcli-ai/cloudcli
cloudcli
```

打开 `http://localhost:3001`，系统会自动发现所有现有会话。

更多配置选项、PM2、远程服务器设置等，请参阅 **[文档 →](https://cloudcli.ai/docs)**。

#### Docker Sandboxes（实验性）

在隔离的沙箱中运行代理，具有虚拟机管理程序级别的隔离。默认启动 Claude Code。需要 [`sbx` CLI](https://docs.docker.com/ai/sandboxes/get-started/)。

```
npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project
```

支持 Claude Code、Codex 和 Gemini CLI。详情请参阅 [沙箱文档](docker/)。

---

## 哪个选项更适合你？

CloudCLI UI 是 CloudCLI Cloud 的开源 UI 层。你可以在本地机器上自托管它，也可以使用提供团队功能与深入集成的 CloudCLI Cloud。

| | CloudCLI UI（自托管） | CloudCLI Cloud |
|---|---|---|
| **适合对象** | 需要为本地代理会话提供完整 UI 的开发者 | 需要部署在云端，随时从任何地方访问代理的团队与开发者 |
| **访问方式** | 通过 `[yourip]:port` 在浏览器中访问 | 浏览器、任意 IDE、REST API、n8n |
| **设置** | `npx @cloudcli-ai/cloudcli` | 无需设置 |
| **机器需保持开机吗** | 是 | 否 |
| **移动端访问** | 网络内任意浏览器 | 任意设备（原生应用即将推出） |
| **可用会话** | 自动发现 `~/.claude` 中的所有会话 | 云端环境内的会话 |
| **支持的 Agents** | Claude Code、Cursor CLI、Codex、Gemini CLI | Claude Code、Cursor CLI、Codex、Gemini CLI |
| **文件浏览与 Git** | 内置于 UI | 内置于 UI |
| **MCP 配置** | UI 管理，与本地 `~/.claude` 配置同步 | UI 管理 |
| **IDE 访问** | 本地 IDE | 任何连接到云环境的 IDE |
| **REST API** | 是 | 是 |
| **n8n 节点** | 否 | 是 |
| **团队共享** | 否 | 是 |
| **平台费用** | 免费开源 | 起价 $7/月 |

> 两种方式都使用你自己的 AI 订阅（Claude、Cursor 等）— CloudCLI 提供环境，而非 AI。

---

## 安全与工具配置

**🔒 重要提示**: 所有 Claude Code 工具默认**禁用**，可防止潜在的有害操作自动运行。

### 启用工具

1. **打开工具设置** - 点击侧边栏齿轮图标
2. **选择性启用** - 仅启用所需工具
3. **应用设置** - 偏好设置保存在本地

<div align="center">

![工具设置弹窗](public/screenshots/tools-modal.png)
*工具设置界面 - 只启用你需要的内容*

</div>

**推荐做法**: 先启用基础工具，再根据需要添加其他工具。随时可以调整。

---

## 插件

CloudCLI 配备插件系统，允许你添加带自定义前端 UI 和可选 Node.js 后端的选项卡。在 Settings > Plugins 中直接从 Git 仓库安装插件，或自行开发。

### 可用插件

| 插件 | 描述 |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | 展示当前项目的文件数、代码行数、文件类型分布、最大文件以及最近修改的文件 |

### 自行构建

**[Plugin Starter Template →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — Fork 该仓库以构建自己的插件。示例包括前端渲染、实时上下文更新和 RPC 通信。

**[插件文档 →](https://cloudcli.ai/docs/plugin-overview)** — 提供插件 API、清单格式、安全模型等完整指南。

---

## 常见问题

<details>
<summary>与 Claude Code Remote Control 有何不同？</summary>

Claude Code Remote Control 让你发送消息到本地终端中已经运行的会话。该方式要求你的机器保持开机，终端保持开启，断开网络后约 10 分钟会话会超时。

CloudCLI UI 与 CloudCLI Cloud 是对 Claude Code 的扩展，而非旁观 — MCP 服务器、权限、设置、会话与 Claude Code 完全一致。

- **覆盖全部会话** — CloudCLI UI 会自动扫描 `~/.claude` 文件夹中的每个会话。Remote Control 只暴露当前活动的会话。
- **设置统一** — 在 CloudCLI UI 中修改的 MCP、工具权限等设置会立即写入 Claude Code。
- **支持更多 Agents** — Claude Code、Cursor CLI、Codex、Gemini CLI。
- **完整 UI** — 除了聊天界面，还包括文件浏览器、Git 集成、MCP 管理和 Shell 终端。
- **CloudCLI Cloud 保持运行于云端** — 关闭本地设备也不会中断代理运行，无需监控终端。

</details>

<details>
<summary>需要额外购买 AI 订阅吗？</summary>

需要。CloudCLI 只提供环境。你仍需自行获取 Claude、Cursor、Codex 或 Gemini 订阅。CloudCLI Cloud 从 $7/月起提供托管环境。

</details>

<details>
<summary>能在手机上使用 CloudCLI UI 吗？</summary>

可以。自托管时，在你的设备上运行服务器，然后在网络中的任意浏览器打开 `[yourip]:port`。CloudCLI Cloud 可从任意设备访问，内置原生应用也在开发中。

</details>

<details>
<summary>UI 中的更改会影响本地 Claude Code 配置吗？</summary>

会的。自托管模式下，CloudCLI UI 读取并写入 Claude Code 使用的 `~/.claude` 配置。通过 UI 添加的 MCP 服务器会立即在 Claude Code 中可见。

</details>

---

## 社区与支持

- **[文档](https://cloudcli.ai/docs)** — 安装、配置、功能与故障排除指南
- **[Discord](https://discord.gg/buxwujPNRE)** — 获取帮助并与社区交流
- **[GitHub Issues](https://github.com/siteboon/claudecodeui/issues)** — 报告 Bug 与建议功能
- **[贡献指南](CONTRIBUTING.md)** — 如何参与项目贡献

## 许可证

GNU 通用公共许可证 v3.0 - 详见 [LICENSE](LICENSE) 文件。

该项目为开源软件，在 GPL v3 许可证下可自由使用、修改与分发。

## 致谢

### 使用技术
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic 官方 CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor 官方 CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[Gemini-CLI](https://geminicli.com/)** - Google Gemini CLI
- **[React](https://react.dev/)** - 用户界面库
- **[Vite](https://vitejs.dev/)** - 快速构建工具与开发服务器
- **[Tailwind CSS](https://tailwindcss.com/)** - 实用先行 CSS 框架
- **[CodeMirror](https://codemirror.net/)** - 高级代码编辑器
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(可选)* - AI 驱动的项目管理与任务规划

### 赞助商
- [Siteboon - AI powered website builder](https://siteboon.ai)
---

<div align="center">
  <strong>为 Claude Code、Cursor 和 Codex 社区精心打造。</strong>
</div>
