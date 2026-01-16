# 项目上下文

## 目的

Claude Code UI（又名 Cloud CLI）是一个全栈 Web 应用程序，为 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)、[Cursor CLI](https://docs.cursor.com/en/cli/overview) 和 [OpenAI Codex](https://developers.openai.com/codex) 提供响应式桌面和移动界面。它使用户能够通过浏览器从任何设备与 AI 编程助手交互，为 AI 驱动的开发工作流程提供无缝的跨设备体验。

**主要目标：**
- 提供从任何设备（桌面、平板、移动）对 AI CLI 工具的通用访问
- 启用与 AI 助手的实时聊天和终端交互
- 提供集成的文件浏览、代码编辑和 Git 操作
- 支持会话管理和对话恢复
- 通过身份验证和工具权限系统维护安全性

## 技术栈

### 前端
- **React 18** - 使用 hooks 的函数式组件
- **Vite 7** - 快速构建工具，支持热模块替换
- **React Router v6** - 客户端路由
- **Tailwind CSS 3** - 实用工具优先的样式，带有自定义组件
- **CodeMirror 6** - 代码编辑，支持语法高亮（JavaScript、Python、JSON、Markdown、CSS、HTML）
- **Xterm.js 5** - 终端模拟，使用 WebGL 渲染
- **React Markdown** - Markdown 渲染，支持 KaTeX 数学
- **Lucide React** - 图标库

### 后端
- **Node.js**（v20+）- ES 模块（type: "module"）
- **Express.js 4** - REST API 服务器
- **WebSocket (ws 8)** - 实时双向通信
- **SQLite (better-sqlite3 12)** - 嵌入式数据库，用于用户、会话、设置
- **JWT (jsonwebtoken 9)** - 身份验证令牌
- **bcrypt 6** - 密码哈希
- **node-pty 1** - 用于 shell 会话的伪终端

### AI SDK
- **@anthropic-ai/claude-agent-sdk 0.1.x** - 直接 Claude 集成
- **@openai/codex-sdk 0.75.x** - OpenAI Codex 集成
- **子进程生成** - Cursor CLI 集成

### DevOps
- **concurrently** - 并行运行前端和后端
- **Vite** - 构建系统，手动代码分割
- **auto-changelog** - 自动生成 CHANGELOG
- **release-it** - 发布自动化

### 数据库
- **SQLite** 三个主要表：
  - `users` - 身份验证和用户设置
  - `api_keys` - 外部 API 密钥管理
  - `user_credentials` - 存储的服务凭据（GitHub、GitLab 等）

## 项目约定

### 代码风格

#### JavaScript/React（前端）
- **ES 模块** - 所有导入都显式使用 `.js` 或 `.jsx` 扩展名
- **函数式组件** - React 组件是使用 hooks 的函数（无类组件）
- **文件命名**：
  - 组件：PascalCase（例如 `ChatInterface.jsx`、`Settings.jsx`）
  - 工具：camelCase（例如 `api.js`、`websocket.js`）
  - Hooks：带 `use` 前缀的 camelCase（例如 `useAudioRecorder.js`、`useLocalStorage.jsx`）
- **导入**：按组组织（React、第三方、相对导入）
- **JSX**：属性使用单引号，字符串使用双引号
- **组件组织**：
  - Hooks 在顶层
  - 事件处理程序在 hooks 之后
  - 渲染助手在底部
  - 主渲染返回在最后

#### JavaScript（后端）
- **ES 模块** - 所有文件都使用 `.js` 扩展名和 import/export
- **Async/Await** - 异步操作优于回调
- **错误处理** - 文件 I/O、进程生成、数据库操作的 try-catch 块
- **注释**：模块和关键函数使用 JSDoc 风格
- **常量**：UPPER_SNAKE_CASE（例如 `TOOL_APPROVAL_TIMEOUT_MS`、`CONTEXT_WINDOW`）

#### 代码注释
- **块注释**（`/* */`）用于文件头和复杂逻辑说明
- **行注释**（`//`）用于内联说明
- **TODO/FIXME** 标记用于待处理工作
- **会话保护注释**在关键集成点使用多行标题格式

### 架构模式

#### 前端架构
- **组件层次结构**：`App.jsx` → 上下文提供者 → 页面组件 → UI 组件
- **基于上下文的状态管理**：
  - `AuthContext` - 用户身份验证状态
  - `WebSocketContext` - WebSocket 连接管理
  - `ThemeContext` - 深色/浅色模式
  - `TaskMasterContext` - 任务管理状态
  - `TasksSettingsContext` - 任务设置持久化
- **自定义 Hooks** 用于可重用逻辑（例如 `useAudioRecorder`、`useLocalStorage`）
- **受保护路由** - `ProtectedRoute` 组件包装已验证的页面
- **错误边界** - `ErrorBoundary` 包装主应用程序以实现优雅故障

#### 后端架构
- **Express 中间件链**：
  1. CORS（跨域请求）
  2. JSON 正文解析器
  3. JWT 身份验证（`middleware/auth.js`）
  4. 路由处理程序
- **模块化路由** - 每个功能在 `routes/` 目录中都有自己的路由器
- **会话管理**：
  - 每个提供者的内存 `activeSessions` 映射（Claude、Cursor、Codex）
  - PTY 会话缓存在 `ptySessionsMap` 中，具有 30 分钟超时
  - 通过 `sessionId` 参数恢复会话
- **WebSocket 处理程序**：
  - `/ws` - 聊天和 AI 助手通信
  - `/shell` - 终端/shell 访问，带有 PTY 生成
- **错误处理**：
  - 路径验证防止目录遍历
  - 进程生成的 try-catch 包装
  - WebSocket 错误被记录但不会导致服务器崩溃

#### 通信模式
- **REST API** - 用于 CRUD 操作的标准 HTTP 方法
- **WebSocket 消息流**：
  1. 客户端发送带有选项（projectPath、sessionId 等）的命令
  2. 服务器调用 SDK/CLI 集成
  3. 通过 `writer.send()` 流式传输响应，带有消息类型标记
  4. UI 根据消息类型（content、tool_use、error 等）进行渲染
- **消息类型**：`claude-command`、`cursor-command`、`codex-command`、`abort-session`、`claude-permission-response`

### 测试策略

**当前状态**：不存在正式测试套件。手动测试侧重于：
- 多提供商会话管理（Claude、Cursor、Codex）
- WebSocket 连接可靠性
- 文件操作安全性
- 终端会话持久性
- 跨设备响应能力

**测试指南**（用于未来测试）：
- 测试 WebSocket 重新连接场景
- 验证文件系统路径验证（目录遍历预防）
- 测试工具权限批准流程
- 验证跨提供商的会话恢复
- 测试并发会话和 PTY 清理
- 验证数据库迁移和架构更改

### Git 工作流

#### 分支策略
- **main** - 生产就绪代码，始终可部署
- **feature/*** - 新功能（例如 `feat/show-grant-permission-button`）
- **fix/*** - 错误修复（例如 `fix/server-crash-when-opening-settings`）
- **合并提交** - 使用合并提交合并的拉取请求（不是 rebase）

#### 提交消息约定
基于最近的提交历史：
- **feat:** - 新功能（例如 "feat: add Bash command approval handling"）
- **fix:** - 错误修复（例如 "fix: normalize file path handling"）
- **Merge pull request #XXX** - PR 合并（自动）
- **Merge branch** - 分支合并（自动）

**提交消息格式**：
```
type: 简要描述

可选的详细说明，多行。

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

#### 发布流程
1. 更新 `package.json` 中的版本
2. 运行 `npm run release`（触发 `release-it`）
3. 通过 `auto-changelog` 自动生成 CHANGELOG
4. 标记并推送到 GitHub 存储库

## 领域上下文

### AI CLI 工具集成

#### Claude Code
- **会话位置**：`~/.claude/projects/[encoded-path]/`
- **模型**：Claude Sonnet 4.5、Opus 4.5（参见 `shared/modelConstants.js`）
- **工具权限**：出于安全考虑，所有工具**默认禁用**
- **批准超时**：55 秒（可通过 `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS` 配置）
- **SDK 集成**：直接 SDK 使用（无子进程）以获得更好的性能

#### Cursor CLI
- **会话位置**：`~/.cursor/projects/`
- **集成**：子进程生成（`cursor-agent` 命令）
- **恢复支持**：`--resume` 参数用于会话继续

#### OpenAI Codex
- **会话位置**：`~/.codex/sessions/`（JSONL 格式）
- **令牌使用**：在 UI 中跟踪和显示
- **集成**：`@openai/codex-sdk` 与会话文件解析

### 项目发现
从特定于提供程序的目录自动发现项目，使用：
- `extractProjectDirectory()` - 解析编码的项目路径
- `getFileTree()` - 生成文件树结构以供浏览
- `chokidar` - 用于实时更新的文件监视程序

### 文件系统安全性
所有文件操作验证路径都在项目根目录内：
```javascript
const normalizedRoot = path.resolve(projectRoot) + path.sep;
if (!resolved.startsWith(normalizedRoot)) {
    return res.status(403).json({ error: 'Path must be under project root' });
}
```

### 会话保护系统
防止侧边栏项目更新中断活动聊天会话：
- 用户发送消息 → 会话标记为**活动**
- Claude 完成 → 会话标记为**非活动**
- 会话中止 → 会话标记为**非活动**
- App.jsx 在会话**活动**时暂停侧边栏更新

## 重要约束

### 技术约束
- **Node.js 版本**：最低 v20（ES 模块、crypto.randomUUID()）
- **单用户系统**：数据库设计用于单用户实例（非多租户）
- **内存状态**：活动会话和工具批准不会在重启后持久化
- **无原生通知**：使用应用内 UI 进行所有警报
- **工具批准超时**：必须 < 60s（SDK 控制超时限制）

### 安全约束
- **路径遍历保护**：所有文件路径都根据项目根目录进行验证
- **工具权限**：选择加入模式（所有工具默认禁用）
- **身份验证**：基于 JWT，使用 bcrypt 密码哈希
- **API 密钥管理**：存储在数据库中，与用户关联
- **WebSocket 安全性**：同源策略，WebSocket 路由上无 CORS

### 性能约束
- **上下文窗口**：默认 160,000 个令牌（可通过 `CONTEXT_WINDOW` 配置）
- **块大小**：Vite 构建在 1000KB 块时警告
- **PTY 会话缓存**：30 分钟超时以防止内存泄漏
- **数据库**：SQLite（不适合高并发多用户场景）

### 业务约束
- **提供程序依赖**：需要单独安装外部 CLI 工具
- **单实例设计**：不适用于托管多租户部署
- **无原生移动应用**：仅 Web（可以包装在 PWA 中，但不是原生）
- **开源 MIT 许可证**：可免费使用、修改和分发

## 外部依赖

### 必需的 CLI 工具（用户安装）
- **Claude Code CLI** - `npm install -g @anthropic-ai/claude-code`
- **Cursor CLI** - 通过 Cursor IDE 安装
- **OpenAI Codex CLI** - `npm install -g @openai/codex`

### NPM 依赖
**运行时**（生产）：
- Web 框架：`express`、`react`、`react-dom`、`react-router-dom`
- 实时：`ws`、`@xterm/xterm`、`node-pty`
- 数据库：`better-sqlite3`、`sqlite3`
- 身份验证：`jsonwebtoken`、`bcrypt`
- AI SDK：`@anthropic-ai/claude-agent-sdk`、`@openai/codex-sdk`
- UI：`@uiw/react-codemirror`、`lucide-react`、`tailwindcss`
- 工具：`chokidar`、`fuse.js`、`gray-matter`、`katex`

**开发**：
- 构建：`vite`、`@vitejs/plugin-react`、`concurrently`
- 发布：`release-it`、`auto-changelog`
- 图像处理：`sharp`

### 外部服务
- **GitHub API** - 通过 `@octokit/rest` 进行 Git 操作
- **OpenAI API** - 可选的 Whisper 转录（需要 `OPENAI_API_KEY`）
- **MCP 服务器** - 用户可配置的模型上下文协议服务器

### 环境变量
```bash
PORT=3001                              # 后端服务器端口
VITE_PORT=5173                         # 前端开发服务器端口
CONTEXT_WINDOW=160000                  # Claude 上下文大小
CLAUDE_TOOL_APPROVAL_TIMEOUT_MS=55000  # 工具批准超时
OPENAI_API_KEY=                        # Whisper 转录密钥
VITE_IS_PLATFORM=false                 # 平台模式标志
```

### 存储库信息
- **主页**：https://claudecodeui.siteboon.ai
- **存储库**：https://github.com/siteboon/claudecodeui
- **问题**：https://github.com/siteboon/claudecodeui/issues
- **包**：npm 上的 `@siteboon/claude-code-ui`
