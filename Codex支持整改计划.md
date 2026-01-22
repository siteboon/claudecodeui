# Codex 支持整改计划（全量）

> 目标：修复并增强本项目对 OpenAI Codex 的「会话发现/历史回放」与「手动触发对话」能力，使其与 Claude Code / Cursor 的体验对齐，并在 Windows/macOS/Linux 上稳定工作。

## 0. 结论摘要（给决策者）

当前 Codex 支持的核心问题集中在两条链路：

1) **历史会话无法正确归属到工作目录（Project）**：后端 `server/projects.js` 中 `getCodexSessions(projectPath)` 仅把 `session_meta.payload.cwd` 与 `projectPath` 做“近似等值匹配”。当用户在项目子目录、符号链接路径、不同盘符映射、大小写差异等场景运行 Codex 时，`cwd` 与项目根目录不相等，导致会话无法被归类到项目，从而“无法获取过往对话”。

2) **手动触发 Codex 对话失败**：前端 `src/components/ChatInterface.jsx` 的会话 ID 选择逻辑存在跨 Provider 复用（`cursorSessionId` 兜底），以及后端 `server/openai-codex.js` 默认 `approvalPolicy=untrusted` 但 UI 没有 Codex 的审批交互，叠加 SDK 认证与 CLI 认证可能不一致，导致新会话/续聊触发失败或卡住。

本整改计划采取 **“先止血、再结构化改造、最后体验对齐”** 的路线：

- **短期（1~2 天）**：修复会话归属算法（支持子目录/规范化路径），修复前端会话 ID 选择逻辑，调整默认 Codex 权限策略避免无 UI 审批导致失败，补齐错误可观测性（health check + 更清晰报错）。
- **中期（3~5 天）**：引入 Codex 会话索引与“显式归属映射”持久化，解决“外部创建/子目录运行/路径变化”下的稳定归属问题，并提升性能（避免每次全盘扫描）。
- **长期（1~2 周）**：补齐 Codex 的审批/权限 UI，或切换为 Codex CLI 流式适配层，做到与 Claude/ Cursor 一致的可控权限与可解释的工具执行。

---

## 1. 背景与问题定义

### 1.1 用户报告的问题

1. **无法获取 Codex 的过往对话**：Codex 的聊天记录未与工作目录绑定，导致项目列表/会话列表中看不到历史会话，或进入项目后无法回放历史消息。
2. **手动触发 Codex 对话失败**：在 UI 中选择 Codex 后发送消息/创建新会话失败（可能表现为立即报错、无响应、或卡住无法继续）。

### 1.2 成功标准（验收）

- 在任意项目根目录或子目录运行 Codex 产生的会话，都能在 UI 中归属到对应项目并可回放历史。
- 在 UI 中手动触发 Codex：新会话、续聊、切换会话、Abort 均稳定可用；错误能提示可操作的解决办法（缺 API Key/模型不可用/权限模式不支持等）。
- Windows 路径（大小写、`\\?\` 前缀、反斜杠/斜杠、符号链接）都能正确匹配。

---

## 2. 现状走读（关键代码路径）

### 2.1 会话发现与历史回放

- 会话扫描与归属：`server/projects.js` → `getCodexSessions(projectPath)`  
  - 扫描目录：`~/.codex/sessions/**.jsonl`  
  - 解析 `session_meta`：`parseCodexSessionFile(filePath)` 读取 `payload.cwd`、`payload.id` 等。
  - 归属逻辑：当前仅在 `cwd` 与 `projectPath` “近似相等”时才归入项目。

- 消息回放：`server/projects.js` → `getCodexSessionMessages(sessionId)`  
  - 通过文件名包含 `sessionId` 找到 JSONL，再解析 `response_item` 等事件为 UI 消息。

- 前端拉取：`src/utils/api.js` → `api.sessionMessages(..., provider='codex')`  
  - 使用 `/api/codex/sessions/:sessionId/messages` 获取消息。

### 2.2 手动触发（UI → WebSocket → Codex SDK）

- 前端发送：`src/components/ChatInterface.jsx`  
  - provider=codex 时通过 WebSocket 发送 `type: 'codex-command'`，携带 `options.cwd / options.projectPath / options.sessionId / model / permissionMode`。
  - **风险点**：`effectiveSessionId` 计算存在跨 Provider 的 `cursorSessionId` 兜底，可能导致 Codex 误用 Cursor 的 sessionId 去 resume。

- 后端接收：`server/index.js` → `handleChatConnection()`  
  - 收到 `codex-command` 后调用 `queryCodex(data.command, data.options, writer)`。

- Codex 执行：`server/openai-codex.js`  
  - 使用 `@openai/codex-sdk` 创建 thread（start/resume）并 `runStreamed`，把事件转发到 UI。
  - **风险点**：默认权限映射里 `permissionMode=default` → `approvalPolicy='untrusted'`，但前端没有 Codex 的审批交互，可能导致执行在需要审批时失败/卡住。
  - **风险点**：SDK 的认证/配置来源可能与 Codex CLI 不一致（用户“CLI 能用但 SDK 不能用”时会失败）。

---

## 3. 根因分析（对应两大问题）

### 3.1 问题 1：历史会话无法归属到项目

当前 `getCodexSessions(projectPath)` 的匹配策略过于严格，典型失败场景：

- **在项目子目录运行 Codex**：`session_meta.payload.cwd = <project>/subdir`，而 UI 项目路径为 `<project>`，等值匹配失败。
- **符号链接/真实路径不一致**：UI 使用 `realpath(A)`，而 Codex 记录的是 `A` 或反之。
- **Windows 路径多形态**：`\\?\` 前缀、盘符大小写、分隔符差异等，若未统一规范化，会造成不匹配。
- **项目重命名/移动**：Codex 会话仍记录旧路径，无法关联到新项目路径（需要迁移/手动归属能力）。

> 结论：需要把“会话归属”从“路径等值”升级为“路径包含关系 + 真实路径规范化 +（可选）git 根目录推断 + 显式映射持久化”。

### 3.2 问题 2：手动触发 Codex 对话失败

可能的主因（需按优先级排查并逐一修复）：

1) **前端错误复用 sessionId**：`effectiveSessionId = currentSessionId || selectedSession?.id || sessionStorage.getItem('cursorSessionId')`  
   - 在 Codex 模式下可能误带 Cursor 的 sessionId，导致 `resumeThread(sessionId)` 失败（thread 不存在 / 类型不匹配）。

2) **默认审批策略与 UI 不匹配**：后端 `approvalPolicy='untrusted'` 需要交互式审批，但当前 UI 只对 Claude 做了权限弹窗（`claude-permission-response`），Codex 没有对应机制。

3) **SDK 与 CLI 认证来源不一致**：用户可能已在 Codex CLI 登录/配置，但 SDK 需要额外环境变量或凭证注入，导致“CLI 可用、UI 触发失败”。

4) **模型/权限模式组合不可用**：某些模型或 sandbox/approval 组合在特定环境不支持，需要更清晰的校验与错误提示。

> 结论：短期应先修复 sessionId 选择 + 调整默认审批策略（避免无 UI 审批）+ 增加健康检查与可操作报错；中长期补齐 Codex 权限 UI 或切换执行引擎。

---

## 4. 整改目标与范围

### 4.1 目标

- **G1**：Codex 历史会话可发现、可归属、可回放。
- **G2**：Codex 手动触发对话稳定可用（新会话/续聊/中断）。
- **G3**：权限与安全策略可控（至少不“无 UI 审批却要求审批”）。
- **G4**：可观测性提升（出现失败时能快速定位：路径归属、认证、模型、权限）。

### 4.2 非目标（本轮不做或延后）

- 不追求一次性把 Codex 的 UI/交互做成与 Claude 完全一致（审批/工具列表/差分展示等可分期）。
- 不对 `~/.codex/sessions` 的格式变化做 100% 兼容（但要加防御性解析与回退）。

---

## 5. 方案设计（推荐架构）

### 5.1 统一的 WorkspaceKey（项目唯一标识）

为每个项目生成稳定标识 `workspaceKey`，建议规则：

1) 优先使用 `realpath(projectRoot)`（跨平台规范化：分隔符、大小写、去尾部分隔符、去 `\\?\`）。
2) 若是 git 仓库：可附加 `gitRoot`（`git rev-parse --show-toplevel`）作为“更强”的根目录归属依据。
3) 提供“手动绑定”覆盖（当路径变动或推断失败时，允许用户把会话归属到指定项目）。

### 5.2 Codex 会话归属策略（多层回退）

对每个 Codex session（从 JSONL 解析得到 `cwd`）按以下优先级归属：

1) **显式映射**：`codex_session_project_map[sessionId] -> workspaceKey`（由 UI 创建/打开会话时写入）。
2) **git 根目录推断**：以 `sessionCwd` 向上找 `.git`，得到 `gitRoot`，用它匹配项目 `workspaceKey`。
3) **路径包含关系**：若 `sessionCwd` 位于 `projectRoot` 之下（子目录），也认为属于该项目。
4) **无法归属**：归入“未归属 Codex 会话”列表，并允许 UI 手动归属。

### 5.3 Codex 会话索引（性能与稳定性）

现状每次获取项目都递归扫描 `~/.codex/sessions`，随着会话增长会变慢。

建议新增索引层：

- 后端启动时/定时任务：扫描 `~/.codex/sessions`，解析 `session_meta` 与最近活动时间，写入本地 DB（例如现有 `server/database/auth.db` 或新增 DB）。
- 增量更新：记录最后扫描时间或基于文件 mtime；可选加文件 watcher。
- 查询时：按 `workspaceKey` 直接查询会话列表，避免全盘扫描。

### 5.4 手动触发链路（SDK/审批/认证）

短期推荐策略（尽快恢复可用）：

- **修复前端 sessionId 选择**：按 provider 分离 sessionStorage key（`cursorSessionId`、`codexSessionId`、`claudeSessionId` 或直接不兜底）。
- **调整默认审批策略**：在未实现 Codex 审批 UI 前，避免使用需要交互审批的 `approvalPolicy`；改为：
  - `sandboxMode='workspace-write'` + `approvalPolicy='never'`（或更保守：`sandboxMode='read-only'` + `never`）
  - 通过 UI 明确告知用户当前权限模式含义（默认只允许工作区写入/执行限制等）。
- **增加 `/api/codex/health`**：检测
  - Codex CLI 是否存在（`codex --version`）
  - `~/.codex/config.toml` 是否可读（当前已在 `/api/codex/config` 部分覆盖）
  - Codex SDK 运行所需的环境变量/凭证是否就绪（给出“如何配置”的提示）

中长期两条路线（二选一或并行）：

- **路线 A（继续 SDK）**：实现 Codex 的审批 UI（参考 Claude 的 `claude-permission-response`），将 `approvalPolicy` 恢复为 `untrusted/on-request` 并能弹出批准/拒绝。
- **路线 B（切换 CLI 执行引擎）**：像 Cursor 一样 `spawn('codex', ...)`，解析流式输出或事件，避免 SDK 认证差异；同时与 CLI 的权限/配置保持一致。

---

## 6. 分阶段实施计划（里程碑 + 任务清单）

### Phase 0（0.5 天）：诊断与可观测性补齐

- P0-1：在后端为 Codex 增加更结构化日志（包含：provider、projectPath、cwd、sessionId、model、permissionMode、mapped approvalPolicy/sandboxMode）。
- P0-2：新增 `/api/codex/health`（或在现有 `/api/codex/config` 基础上扩展）返回：
  - CLI 可用性、版本
  - sessions 目录存在性与样本统计（总数、最近 5 条）
  - SDK 关键依赖检查（例如缺 key 时返回明确提示）
- P0-3：前端在收到 `codex-error` 时展示“可操作错误提示”（缺凭证、模型不可用、会话不存在、权限模式不支持）。

验收：
- 能在 UI/日志中明确区分：归属问题 vs 触发问题（认证/权限/sessionId）。

### Phase 1（1 天）：修复会话归属（解决问题 1 的主路径）

- P1-1：改造 `server/projects.js#getCodexSessions` 的匹配：
  - 统一规范化：去 `\\?\`、`realpath`、分隔符与大小写、去尾分隔符。
  - 支持 `sessionCwd` 在 `projectRoot` 之下（子目录）也匹配成功。
  - 支持 `projectRoot` 与 `sessionCwd` 的双向包含（按策略决定，至少要覆盖子目录场景）。
- P1-2：为 Codex 会话增加“未归属”聚合入口（后端返回 + 前端展示可选）：
  - 先不做 UI 操作也可，至少后端能返回“该项目找不到会话，但系统存在未归属会话”的提示信息，帮助用户判断是否归属算法问题。
- P1-3：补齐单元测试/最小可运行验证（建议在 `server` 增加轻量测试脚本）：
  - Windows 路径大小写
  - `\\?\` 前缀
  - 子目录归属

验收：
- 在项目子目录运行 Codex 产生的会话，能在项目会话列表中出现并能回放消息。

### Phase 2（1 天）：修复手动触发（解决问题 2 的主路径）

- P2-1：前端 `ChatInterface` 按 provider 分离 sessionId 兜底逻辑：
  - Codex 不再读取 `cursorSessionId` 作为兜底。
  - 需要续聊时只用 `currentSessionId / selectedSession.id / codexSessionId`（可选）之一。
- P2-2：后端 `openai-codex.js` 调整默认 `approvalPolicy`（在未实现审批 UI 前）：
  - 默认走无需交互审批的模式，避免“等待审批导致失败/卡死”。
  - 在 UI 的权限模式选择中明确说明差异（默认/接受编辑/绕过）。
- P2-3：对 `resumeThread(sessionId)` 增加“会话不存在”的特判与指导：
  - 建议返回 `codex-error` 时附带 `code`（例如 `CODEX_THREAD_NOT_FOUND`），前端可提示“请新建会话或清除错误的会话 ID”。

验收：
- Codex 新会话可正常触发、流式返回、完成后可在侧边栏看到该会话并可再次续聊。

### Phase 3（3~5 天）：引入索引与显式映射（稳定性 + 性能）

- P3-1：新增 DB 表（示例）：
  - `codex_sessions_index(sessionId, sessionCwd, inferredProjectKey, lastActivity, summary, messageCount, filePath, updatedAt)`
  - `codex_session_project_map(sessionId, projectKey, source, createdAt)`（source: ui_open/ui_create/manual_attach/inferred）
- P3-2：实现索引构建与增量更新（启动时 + 定时/手动刷新）：
  - 扫描 `~/.codex/sessions` 并解析 `session_meta` 与最后时间戳。
  - 解析失败要容错：跳过坏行，不阻塞全局。
- P3-3：项目列表/会话列表查询改为走索引：
  - `getCodexSessions(projectPath)` 优先查索引 + 显式映射；必要时回退到即时扫描（保底）。
- P3-4：提供手动归属能力（API + UI）：
  - UI：在“未归属 Codex 会话”中选择某会话 → 绑定到项目。

验收：
- Codex 会话数量增大时，项目列表加载仍流畅；路径变化后仍可通过手动归属恢复可见性。

### Phase 4（1~2 周）：权限/审批体验对齐（可选增强）

二选一：

- 路线 A：实现 Codex 审批 UI（推荐长期体验更一致）
  - 后端将 Codex 的“需审批事件”转成统一格式发给前端
  - 前端复用 Claude 的权限弹窗组件，新增 `codex-permission-response`
  - 恢复 `approvalPolicy='untrusted/on-request'`，让默认模式更安全

- 路线 B：Codex CLI 流式适配（推荐兼容 CLI 生态）
  - 用 `spawn('codex', ...)`，解析 stdout/stderr 事件流
  - 直接复用 CLI 的审批与配置（更贴近用户现有习惯）

验收：
- 默认安全模式可用且可解释；高级模式可控制编辑/命令执行策略；不会出现“需要审批但 UI 不支持”的死锁。

---

## 7. 测试计划（覆盖面）

### 7.1 单元/组件测试（建议最低集合）

- JSONL 解析：
  - `session_meta` 缺字段、字段名变化、空行/坏行
  - `response_item` content array 的多类型解析（input_text/output_text/text）
- 路径匹配：
  - Windows：盘符大小写、反斜杠/斜杠、`\\?\`、尾部分隔符
  - 子目录归属：`projectRoot` 与 `sessionCwd` 的包含关系
- 会话 ID 管理：
  - Codex 新会话不应误带 Cursor 的 sessionId

### 7.2 端到端验证清单

- 在项目根目录运行 Codex → UI 可见并回放
- 在项目子目录运行 Codex → UI 仍归属到项目
- UI 里新建 Codex 会话 → 完成后会话出现在项目下
- UI 里续聊 Codex 会话 → 继续写入同一 session 文件并能回放
- Abort Codex 会话 → UI 状态正确恢复

---

## 8. 兼容性、迁移与回滚

### 8.1 兼容性

- 继续支持现有 `/api/codex/sessions/:sessionId/messages` 回放接口。
- 新索引/映射上线后，旧行为可作为回退（索引不可用时仍可即时扫描）。

### 8.2 数据迁移

- 索引表初次构建：全量扫描 `~/.codex/sessions`，生成 `codex_sessions_index`。
- 显式映射表：初期为空；当用户在 UI 打开/创建/手动归属时逐步写入。

### 8.3 回滚策略

- 所有新逻辑应可通过环境变量开关关闭（例如 `CODEX_INDEX_ENABLED=false`、`CODEX_APPROVAL_MODE=never`）。
- 一旦回滚，仍可依赖旧的即时扫描逻辑保证基本可用。

---

## 9. 风险与对策

- **R1：Codex JSONL 格式变化** → 解析层做防御性兼容 + 失败回退。
- **R2：SDK 与 CLI 行为差异** → 增加 health check + 提供 CLI fallback（长期可考虑走 CLI 适配）。
- **R3：权限策略安全性** → 短期用 sandbox 限制 + 明确 UI 提示；长期补齐审批 UI。
- **R4：性能与 I/O 压力** → 引入索引 + 增量更新，避免频繁全盘扫描。

---

## 10. 工作量预估（粗略）

- Phase 0：0.5 天
- Phase 1：1 天
- Phase 2：1 天
- Phase 3：3~5 天
- Phase 4：1~2 周（视选择路线 A/B 与 UI 复杂度）

---

## 11. 建议的落地顺序（最小可交付）

1) Phase 1 + Phase 2（先恢复“看得见历史 + 能手动对话”）
2) Phase 0（同时补齐 health check，便于定位现场问题）
3) Phase 3（把稳定性与性能做好）
4) Phase 4（体验对齐与安全强化）

---

## 12. Changelog（当前工作区 vs GitHub `main`）

> 说明：以下为“当前工作区（本地未提交变更）”相对 GitHub `main` 分支的差异摘要，用于对照本整改计划的落地情况与上游演进。

### 12.1 分支对齐情况

- 当前工作区基线：`b68a903`（本地 `main`）
- GitHub `main`：`5800d84`（上游）
- 对齐状态：本地落后上游约 `18` 个提交（尚未 merge/rebase 上游近期改动，如 i18n 等）

### 12.2 已落地（围绕本整改计划的 Codex 整改，当前为未提交变更）

**会话发现 / 归属（Phase 1）**

- `server/projects.js`：重写 Codex 会话归属判定，支持 Windows `\\?\\`、分隔符/大小写/尾分隔符规范化，并将“项目根目录子目录运行”的会话正确归属到项目。
- `server/projects.js`：Codex 会话扫描改为“全量返回”，并加入全盘扫描缓存（避免项目列表刷新时频繁扫描 `~/.codex/sessions` 造成卡顿）。
- `server/projects.js`：补齐 Codex 历史回放对 `event_msg.user_message` 的解析，并对可能的重复事件做去重，改善“回放不全/只见 assistant”问题。

**手动触发 / sessionId 管理（Phase 2）**

- `src/components/ChatInterface.jsx`：按 provider 隔离 `effectiveSessionId` 兜底逻辑，Codex 不再复用 `cursorSessionId`，避免跨 Provider resume 导致失败。
- `server/openai-codex.js`：默认 `approvalPolicy` 调整为 `never`（在未实现 Codex 审批 UI 前，避免“等待审批/卡住”），并增强错误结构（code/details）与后端日志。
- `src/components/ChatInterface.jsx`：Codex 错误展示增加可操作提示（如会话不存在/认证问题等）。

**诊断与可观测性（Phase 0）**

- `server/routes/codex.js`：新增 `/api/codex/health`，用于检查 CLI 可用性、sessions 目录统计与关键环境变量状态（仍受鉴权保护）。

**Codex-only 项目可见性（计划外但用于“看得见历史”的必要补齐）**

- `server/projects.js`：新增基于 `~/.codex/sessions` 的项目自动发现（按 `cwd` 推断 `git root`），并写入 `~/.claude/project-config.json`（标记 `source=codex-auto`），以便左侧项目列表能覆盖“仅 Codex 有会话、Claude 项目不存在”的目录。

**运行时依赖与兼容性（工程性变更）**

- `package.json`：将 `node-pty` 调整为 `optionalDependencies`，避免在缺少 Windows C++ 构建链时阻塞安装；`server/index.js` 采用动态 import 并在缺失时降级提示（终端功能不可用不影响 Codex 联调）。
- `src/components/settings/PermissionsContent.jsx`：同步更新 Codex Default 模式的技术说明（与后端默认策略一致）。
- `package-lock.json`：为 Windows 构建链问题做了依赖调整（包含 Rollup Windows 二进制依赖的安装记录）；后续如需回归上游锁文件，应在合并上游后重新整理 lock。

### 12.3 待落地（本计划后续阶段）

- Phase 3：索引与显式映射（稳定性/性能，减少全盘扫描）。
- Phase 4：审批 UI 或 CLI 适配层（体验与安全对齐）。

### 12.4 平台相关性评估（Windows vs Linux/WSL）

> 针对“该问题是否只在 Windows 出现、Linux/WSL 是否不会遇到”的假设，结论如下：**并非只有 Windows 会遇到，但 Windows 更容易触发且症状更明显**。

- **会话归属/发现（历史会话看不见）**
  - 通用触发（Windows/Linux/WSL 都可能）：在项目**子目录**运行 Codex（`cwd != projectRoot`）会导致“严格等值匹配”失败；符号链接/真实路径不一致也会导致归属失败。
  - Windows 更易触发：盘符大小写、反斜杠/斜杠、`\\?\\` 前缀、UNC 路径等导致 `cwd` 与 `projectPath` 表面不一致的场景更多。
  - WSL 特别说明：若 Codex 在 WSL 内运行，`cwd` 形如 `/home/...`；若 UI 后端服务跑在 Windows（读取 Windows 的 `~/.codex/sessions`），**将看不到 WSL 的 `~/.codex/sessions`**（反之亦然）。建议“Codex 运行环境”和“UI 后端运行环境”保持一致（同在 Windows 或同在 WSL/Linux）。

- **手动触发 Codex（新会话/续聊失败）**
  - **跨平台**：前端 `sessionId` 兜底跨 Provider 复用（Codex 误用 Cursor sessionId）属于逻辑问题，与 OS 无关。
  - **跨平台**：默认 `approvalPolicy=untrusted` 但缺少 Codex 审批 UI，导致需要交互审批时卡住/失败，这同样与 OS 无关。

- **工程依赖（安装/启动）**
  - Windows 更常见：`node-pty` 等原生依赖在缺少 C++ 工具链时安装失败；Linux/WSL 通常更容易通过系统包管理/构建链解决，但仍取决于环境是否具备编译条件。
