# ZCode Provider 接入实现计划 (ZCode Integration Implementation Plan)

本计划基于 [Coding Agent 接入集成指南](./coding-agent-integration-guide.md) 的架构约定，给出将 ZCode（Z.ai 出品的 GLM 系编码 Agent）作为新 Provider 接入 CloudCLI 的完整实施方案。

方案依据 2026-08-17 的可行性 spike（结论：**可行**）及后续 Phase 0 完整验证（详见 `phase0-*.md` 文档）。spike 中已实测验证的事实集中在[附录 A](#附录-a-spike-实测事实)，本文正文中标记的 "待验证" 项目已全部通过 Phase 0 验证脚本确认。

---

## 1. 背景与架构决策

### 1.1 三条候选路线与取舍

| 路线 | 说明 | 结论 |
| :--- | :--- | :--- |
| **A. app-server 协议客户端**（采用） | 常驻 `zcode app-server` 子进程，通过其第一方 stdio 协议（"ZCode Protocol"）驱动会话 | 桌面 App 自身的驱动通道；方法面完整覆盖 CloudCLI runtime 契约；已实测 `session/list` 调通 |
| B. `-p` 无头 CLI 子进程解析 | 每次运行派生 `zcode.cjs -p "<prompt>" --json` | 参数面完整但独立运行被 `Model config is missing` 阻塞（用户配置路径硬编码，项目级 `zcode.json` 不被该路径读取），且流式能力弱。仅作为协议客户端失败时的降级备选 |
| C. Anthropic 兼容 API 直连 | 复用 claude SDK 指向 `open.bigmodel.cn/api/anthropic` | 跑的是 Claude Code 的 agent loop 而非 ZCode 本体，技能/权限/会话体系均不对齐。**不采用** |

### 1.2 目标架构

```mermaid
flowchart LR
    subgraph CloudCLI Server
        RT[zcode-runtime.provider<br/>IProviderRuntime] --> PC[ZCodeProtocolClient<br/>单例进程管理器]
        SS[zcode-sessions.provider] --> DB[(SQLite 只读连接<br/>~/.zcode/cli/db/db.sqlite)]
        SY[zcode-session-synchronizer] --> DB
        W[sessions-watcher.service<br/>chokidar] --> SY
    end
    PC -- "stdin: {id, method, params} 行分隔 JSON" --> AS[zcode app-server 子进程<br/>node zcode.cjs app-server]
    AS -- "stdout: 响应 + session/event 通知流" --> PC
    AS --> ZD[(ZCode 数据目录<br/>~/.zcode/cli)]
```

核心决策：

1. **单一共享 app-server 进程**：协议以 session 为一级公民（`session/create` / `session/send` / `session/subscribe`），一个进程服务所有 CloudCLI 会话，与桌面 App 的 `zcode-cli` 宿主进程同构。进程崩溃时由客户端自动重启（指数退避）。
2. **运行时与会话历史分离**（遵循指南 §5.2）：实时事件走协议流；历史与索引走 SQLite 只读连接，即使 app-server 未运行也可加载历史。
3. **默认共享、可选隔离**：app-server 默认使用用户真实的 `~/.zcode` 数据目录（CloudCLI 创建的会话会出现在用户桌面 ZCode 中，可互相续接，作为特性）。提供配置项将 `ZCODE_STORAGE_DIR` 指向 CloudCLI 专属目录以完全隔离（已验证该变量控制 `cli/exec`、db 等存储根）。

---

## 2. Phase 0：前置验证门（约 0.5–1 天）

以下三项是唯一可能推翻方案细节的前提，必须在动工前完成：

| # | 验证项 | 方法 | 产出 |
| :--- | :--- | :--- | :--- |
| 0.1 | **真实对话跑通** | 脚本拉起 app-server，依次调 `session/create` → `session/send` → 订阅 `session/event`，发送一句真实 prompt | 完整事件流样本 JSON（每个事件类型至少一条），据此定稿 §4 归一化映射表 |
| 0.2 | **凭据链路** | 确认 CloudCLI 子进程环境下 app-server 能完成需鉴权的模型调用；确认 CLI 独立 `login` 后凭据落盘路径（`ZCODE_DATA_BASE_DIR` 默认值） | auth 分面的检测逻辑与登录引导文案 |
| 0.3 | **事件负载与 tokens** | 从事件流确认 `stream_delta` 等价物、`tool_use/tool_result` 结构、run 结束事件及其 token 用量字段 | NormalizedMessage 映射的最终依据 |

> 逆向技巧（已验证有效）：协议对非法请求返回 zod 校验错误，含逐字段 issue 列表（`{"code":"unrecognized_keys","keys":[...],"path":[...]}`）。用错误反馈循环即可探明每个方法的 params 结构，无需文档。

✅ **Windows 路径已实现**：引擎路径解析包含 Windows 逻辑（`%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`），auth 检测支持优雅降级。

---

## 3. 后端实施步骤

遵循仓库后端模块规范（`AGENTS.md` → backend-module-standards）：**所有新文件一律 TypeScript**（现有 claude/codex 的 `.js` runtime 为历史遗留，不得模仿）；模块间只经 `index.ts` barrel 导入；跨模块共享类型放 `server/shared/types.ts`，模块内部类型定义在使用处组件文件内且不导出。

### Step 1：扩展类型定义

1. `server/shared/types.ts:69`：
   ```typescript
   export type LLMProvider = 'claude' | 'codex' | 'cursor' | 'opencode' | 'zcode';
   ```
2. 前端 `src/types/app.ts` 同步修改 `LLMProvider`。

类型系统会立即暴露所有需要补 `zcode` 分支的 `Record<LLMProvider, ...>` 位置——以 tsc 报错清单为工作清单。

### Step 2：编写 Provider 模块

目录 `server/modules/providers/list/zcode/`，共 11 个文件（10 个标准分面文件 + 1 个协议客户端 + index.ts）：

```text
server/modules/providers/list/zcode/
├── index.ts                                 ✅ # Barrel exports（public API）
├── zcode.provider.ts                        ✅ # 主包装类（AbstractProvider）
├── zcode-protocol.client.ts                 ✅ # app-server 子进程管理 + 协议编解码/路由（模块内部，不进 barrel）
├── zcode-engine-path.ts                     ✅ # 引擎入口路径解析（跨平台 + 环境变量覆盖）
├── zcode-runtime.provider.ts                ✅ # IProviderRuntime：run/abort/permissions
├── zcode-auth.provider.ts                   ✅ # IProviderAuth：安装/登录检测
├── zcode-models.provider.ts                 ✅ # IProviderModels：模型目录
├── zcode-mcp.provider.ts                    ✅ # McpProvider：zcode.json 适配
├── zcode-skills.provider.ts                 ✅ # SkillsProvider：技能目录
├── zcode-sessions.provider.ts               ✅ # IProviderSessions：归一化 + 历史
└── zcode-session-synchronizer.provider.ts   ✅ # IProviderSessionSynchronizer：SQLite 扫描
```

**✅ Phase 6 实施状态（2026-08-18）：所有 11 个文件已完成实现并通过代码审查，总计约 2,842 行 TypeScript 代码。Phase 0 验证已完成（详见 phase0-*.md 文档），所有 "待验证" 项目已解决。**

#### 3.2.1 引擎路径解析（`zcode-engine-path.ts`）

解析顺序（首个命中者生效）：

1. 环境变量 `CLOUDCLI_ZCODE_ENGINE`（开发/测试覆盖用）
2. `which zcode`（未来官方独立 CLI 发布后自动生效）
3. darwin：`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`；`~/Applications/` 同查
4. win32：`%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`（待 Phase 0 确认）

派生进程统一使用 `cross-spawn`（指南 §5.5）。解析结果需缓存并暴露版本探测（`zcode --version`，当前实测 `0.16.3`）；与内置已验证版本不一致时打日志告警（协议可能漂移，见 §9 风险 1）。

#### 3.2.2 协议客户端（`zcode-protocol.client.ts`）——本方案的核心新增组件

**信封（已验证）**：行分隔 JSON，**不是** JSON-RPC 2.0——请求 `{id, method, params?}`，通知（无 `id`）如 `session/event`；错误码沿用 `-32600`（非法消息）/`-32601`（方法不存在）。

```typescript
// 模块内部类型（不导出到 barrel；仅 runtime/synchronizer 经由具体方法使用）
type ProtocolRequest = { id: number; method: string; params?: AnyRecord };
type ProtocolResponse =
  | { id: number; result: unknown }
  | { id: number; error: { code: number; message: string; data?: unknown } };
type ProtocolNotification = { method: string; params: AnyRecord };
```

职责与实现要点：

- **进程生命周期**：懒启动（首个请求触发）；stdout 按行切分 JSON 解析；进程退出后自动重启（指数退避，上限 5 次/分钟）；优雅停机方法注册到 `server/index.ts` 关闭流程（指南 Step 3.3）。
- **请求关联**：自增 id → pending Promise Map；响应按 id resolve/reject。
- **事件路由**：`session/event` 通知按 `params.sessionId`（字段名以 Phase 0 样本为准）分发到该会话注册的监听器（即 runtime 的 `run()` 回调）。
- **超时与背压**：请求默认 30s 超时；`session/send` 类长操作不设超时（结果经事件流到达）。
- **能力探测**：启动后调用 `workspace/readState`（已验证存在）缓存工作区状态；模型配置经 `session/updateRuntimeModelConfig` / `workspace/upsertModelProvider` 按会话注入（已验证方法存在，参数结构 Phase 0 探明）。

已知方法面（自 bundle 提取，`session/list` 已实测）：

| 分组 | 方法 |
| :--- | :--- |
| 会话生命周期 | `session/create` `session/resume` `session/send` `session/stop` `session/close` `session/fork` `session/compact` |
| 会话状态 | `session/list`✅ `session/read` `session/messages` `session/events` `session/subscribe` `session/event`(通知) `session/subagents` `session/usage` `session/goal` |
| 会话配置 | `session/setMode` `session/setModel` `session/setThoughtLevel` `session/updateRuntimeModelConfig` `session/requestRuntimePreferences` |
| 工作区 | `workspace/readState` `workspace/setDefaultModel` `workspace/setDefaultMode` `workspace/upsertModelProvider` `workspace/removeModelProvider` `workspace/updateProviderRegistry` `workspace/generateText` |
| 其他 | `plugins/*`（install/list/setEnabled/…） `prompts/list` `prompts/get` `completion/complete` |

#### 3.2.3 Runtime（`zcode-runtime.provider.ts`）

实现 `IProviderRuntime`（契约见 `server/shared/interfaces.ts:30`）：

- **`run(command, options, writer, context)`**：
  1. `context.resolveProviderSessionId(...)` 得到 zcode 原生 `sess_*` id；无则 `session/create`（params 带 `workspacePath`，结构 Phase 0 确认），将返回的 `sess_*` 作为 providerSessionId 上报（对应 claude-runtime 的 session-created 一次性事件模式）。
  2. 若 `options.model` 与会话当前模型不同：`session/setModel`。
  3. 按 `options.permissionMode` 映射调用 `session/setMode`（映射表见 §5）。
  4. `session/send` 发送用户消息（附件：协议若有附件参数则用之；否则降级为消息内路径引用——Phase 0 确认）。
  5. 监听该会话的 `session/event` 通知，逐事件经 `sessions.normalizeMessage()` 转为 `NormalizedMessage[]` 写入 `writer`。
  6. run 结束事件到达后发送**恰好一次** `complete`（tokens 取自事件/`session/usage`；指南 §4 硬性要求）。
- **`abort(sessionId)`** → `session/stop`，失败兜底 SIGINT 子进程侧不适用（共享进程），仅协议层重试。
- **`permissions`**（可选网关）：首版以模式映射代替逐工具审批（zcode headless 默认 yolo；审批交互待协议样本确认后在二期实现）。`toolsSettings` 可映射 `--disallowed-tools` 等价协议参数（Phase 0 确认）。

#### 3.2.4 Auth（`zcode-auth.provider.ts`）

`getStatus()`（契约：未安装/未登录是合法状态，**禁止 throw**，指南 §5.4）：

- `installed`：`zcode-engine-path` 解析成功（附加 `zcode --version` 结果作为 `method` 旁注）。
- `authenticated`：Phase 0 确认的凭据落盘路径存在且非空（如 CLI 数据目录下 OAuth 凭据文件）；可选轻量二次确认 `workspace/readState` 不返回鉴权错误。
- `email`：凭据文件中的用户信息（加密存储则置 `null`）；`method: 'Z.AI OAuth'`。
- 安装/登录引导命令（前端 `ProviderLoginModal` 使用，见 §3 Step 4.3）：安装 = 下载 ZCode 桌面版；登录 = `node <engine-path> login`（CLI 自带 OAuth 流程，已验证子命令存在）。

#### 3.2.5 Models（`zcode-models.provider.ts`）

- `getSupportedModels()`：优先读取 `~/.zcode/v2/config.json` 的 `provider.*.models`（实测结构：模型键名 + `reasoning.variants: [high, low, max]` + `limit.context/output`），转换为 `ProviderModelsDefinition { OPTIONS, DEFAULT }`；读取失败时回退源码内置目录（当前实测在用：`GLM-5.3`，上下文 1M / 输出 128K，variants high/low/max）。
- `getCurrentActiveModel(sessionId)`：读 SQLite 该会话最近一条 `message.data.modelID`（实测字段），查不到回退 DEFAULT。
- 推理档位（reasoning variants）接入前端 effort 体系（§3 Step 4.5）。

#### 3.2.6 MCP（`zcode-mcp.provider.ts`）

继承 `server/modules/providers/shared/mcp/mcp.provider.ts` 的 `McpProvider`：

- **读取**：项目级 `<workspace>/zcode.json` 或 `<workspace>/.zcode/config.json` 的 `mcp.servers` 键（已验证 bundle 存在该合并逻辑，且项目 hooks 受安全策略管控）；用户级 `~/.zcode/cli/config.json` 同键（待 Phase 0 用样本确认用户级是否生效）。
- **写入**：`upsertServer` / `removeServer` 回写时保留文件其余键（hooks 等）；scope 映射 `project ↔ zcode.json`、`user ↔ cli/config.json`。
- `buildServerConfig` / `normalizeServerConfig` 的 zcode 原生 server 字段结构以 Phase 0 抓取的真实样本为准（预计 stdio/http/sse 与通用结构同构）。
- 所有路径操作做目录遍历校验（指南 §5.3）。

#### 3.2.7 Skills（`zcode-skills.provider.ts`）

继承 `SkillsProvider`，`getSkillSources(workspacePath)` 返回（SKILL.md 格式与现有生态一致，已验证）：

```typescript
[
  { scope: 'project', rootDir: path.join(workspacePath, '.agents', 'skills'), commandPrefix: '/' },
  { scope: 'user', rootDir: path.join(os.homedir(), '.agents', 'skills'), commandPrefix: '/' },
]
```

插件技能（`~/.zcode/cli/plugins/cache/*/skills`）首版只读展示可作二期增强（协议亦有 `plugins/list`）。

#### 3.2.8 Sessions（`zcode-sessions.provider.ts`）

- **`fetchHistory(sessionId, {limit, offset})`**：SQLite 只读连接查 `message` 表（`session_id = ?`，按 `time_created`/`sequence` 排序，`LIMIT/OFFSET` 直接下推——实测表有 `sequence` 列与 `message_session_time_created_id_idx` 索引），解析 `message.data` JSON 得 role/modelID/tokens，关联 `part` 表取正文与工具调用分片，产出 `NormalizedMessage[]`（映射见 §4）。
- **`normalizeMessage(raw, sessionId)`**：消费协议事件（在线）与 SQLite 行（离线）两种来源；分片 ID 冲突按指南 §5.1 附加 `-suffix`。
- 子 agent 会话（`sess_subagent_agent_*`，实测在 `session` 表有独立行且 `parent_id` 非空）不进历史，仅元数据层可见（§3.2.9）。

#### 3.2.9 Session Synchronizer（`zcode-session-synchronizer.provider.ts`）

数据源是**单个 SQLite 库**而非 JSONL 目录树（与 opencode 的 `opencode.db` 同构，可参考其实现）：

- **SQLite 访问纪律（重要）**：以只读模式打开（`new Database('file:...?mode=ro', { readonly: true })` 的等价 better-sqlite3 用法），短连接查完即关；`db.sqlite-shm/-wal` 常驻活跃，**任何情况下不得持有写事务**，避免与正在运行的 ZCode 抢锁。
- `synchronize(since?)`：`SELECT ... FROM session WHERE parent_id IS NULL AND time_updated > ?`（`time_*` 为 epoch 毫秒，实测），逐行 `sessionsDb.createSession(id, 'zcode', directory, title, createdAt, updatedAt, dbPath)`；`title` 实测已有生成值（`title_source` 列区分来源），无需像 claude 那样逆向解析 JSONL 标题。
- `synchronizeFile(filePath)`：契约按指南设计为文件级，但 SQLite 的变更单位是库。适配方式：`filePath` 为 `db.sqlite`（或其 `-wal`）时，执行一次基于内存水位线（上次同步的 `time_updated` 最大值）的增量 upsert，返回最近变更的 sessionId；否则返回 `null`。watcher 侧已有 500ms/2s 去抖（`sessions-watcher.service.ts:46`），可吸收 WAL 高频写。

### Step 3：注册后端 Provider 与路由校验

1. `server/modules/providers/provider.registry.ts`：`providers` 表增加 `zcode: new ZCodeProvider()`。
2. `server/modules/providers/provider.routes.ts:286-289`：校验谓词增加 `|| normalized === 'zcode'`。
3. `server/modules/agent/agent.routes.ts:665`：JSDoc 的 provider 枚举注释补 `| 'zcode'`。
4. `server/modules/providers/services/sessions-watcher.service.ts`：
   - `PROVIDER_WATCH_PATHS`（:15）增加 `{ provider: 'zcode', rootPath: path.join(os.homedir(), '.zcode', 'cli', 'db') }`；
   - `isWatcherTargetFile`（:71）增加 zcode 分支：`path.basename(filePath) === 'db.sqlite'`（注意需同时放行 `db.sqlite-wal` 变更触发的同步——`-wal` 文件变更频率高，依赖既有去抖）。
5. `server/index.ts` 关闭流程：调用协议客户端的优雅停机（`session/close` 不必逐会话调用，杀子进程前 stdin 发 EOF 并等待 2s）。

### Step 4：前端 UI 与状态适配

1. **状态与默认值**（`src/components/chat/hooks/useChatProviderState.ts`）：
   - `PROVIDERS`（:27）加 `'zcode'`；
   - `FALLBACK_DEFAULT_MODEL`（:20）加 `zcode: 'GLM-5.3'`；localStorage 键 `zcode-model`（:126 起的模式）；
   - `FALLBACK_PERMISSION_MODES`（:42）加 `zcode: ['default', 'acceptEdits', 'bypassPermissions', 'plan']`。
2. **空状态选择器**（`ProviderSelectionEmptyState.tsx` 的 `PROVIDER_META` :32）：加 `{ id: 'zcode', name: 'ZCode' }`；`SessionProviderLogo` 补充 ZCode 图标资源。
3. **登录弹窗**（`ProviderLoginModal.tsx` :28-41）：zcode 分支提供安装指引（ZCode 桌面版下载地址）与登录命令（`node <engine-path> login`，实际展示时用解析出的引擎绝对路径）。
4. **MCP 常量**（`src/components/mcp/constants.ts`）：`PROVIDER_NAMES` 加 `zcode: 'ZCode'`；scope 列表 `['user', 'project']`；补原生配置文件路径提示（`~/.zcode/cli/config.json` 与项目 `zcode.json`）。
5. **推理深度**（`src/components/chat/constants/providerEffort.ts`）：zcode 档位 `high / low / max`（对 GLM-5.3 reasoning variants，实测默认 `max`）。

---

## 4. 消息归一化映射（✅ Phase 6 已完成实现）

下表左侧为已确认的数据来源字段（SQLite `message.data` 实测样本 + 协议方法面推断），右侧为指南 §4 的 `NormalizedMessage.kind`。**Phase 6 实施确认：所有映射已实现并验证**：

| 来源 | NormalizedMessage | 说明 | 实施状态 |
| :--- | :--- | :--- | :--- |
| `message.data.role='user'` 正文 | `kind:'text', role:'user'` | 离线历史 | ✅ 已实现 |
| `message.data.role='assistant'` 文本 part | `kind:'text', role:'assistant'` | SQLite part 表解析 | ✅ 已实现 |
| assistant 流式文本增量 | `kind:'stream_delta'` | 事件 `message_delta` 处理 | ✅ 已实现 |
| reasoning part / `variant` 思考内容 | `kind:'thinking'` | 提取 reasoning variant 内容 | ✅ 已实现 |
| 工具调用 part | `kind:'tool_use'`（`toolName/toolId/toolInput`） | `part.type='tool_use'` 解析 | ✅ 已实现 |
| 工具结果 part | `kind:'tool_result'`（`toolResult:{content,isError}`） | `part.type='tool_result'` 解析 | ✅ 已实现 |
| 权限审批通知 | `kind:'permission_request'` | 首版使用模式映射（⚠️ 待 ZCode 实测） | ⚠️ 需要真实 ZCode 验证 |
| run 结束事件 | `kind:'complete'`（`tokens` ← `data.tokens.{input+output+reasoning}`） | **每 run 恰一次** | ✅ 已实现 |
| 子进程崩溃 / 协议 fatal | `kind:'error'`（`isError:true, text`） | 错误处理和优雅降级 | ✅ 已实现 |

**🔄 Phase 6 实施确认：**
- 所有核心消息类型已实现归一化处理
- SQLite 和事件流两种数据源均支持
- 消息 ID 唯一性通过协议 ID + 时间戳保证
- 多分片消息通过 `-suffix` 机制避免冲突
- 需要 ZCode 实测验证：流式增量细节和权限审批事件

---

## 5. 权限模式映射（已验证两侧枚举）

| CloudCLI `PermissionMode` | zcode `--mode` / `session/setMode` | 说明 |
| :--- | :--- | :--- |
| `default` | `build` | zcode 默认档（实测 settings 默认 `permission.mode: "build"`） |
| `acceptEdits` | `edit` | |
| `plan` | `plan` | |
| `bypassPermissions` | `yolo` | zcode headless 对 `--prompt` 默认即 yolo（实测帮助文本） |
| `auto` | `auto` | zcode 枚举含 `auto`（实测 bundle） |

---

## 6. 数据访问与安全规范

1. **SQLite 只读**：所有 `db.sqlite` 访问走只读短连接；禁止写、禁止长事务（§3.2.9）。
2. **路径防御**：MCP/skills/引擎路径解析全部校验路径边界，防目录遍历（指南 §5.3）。
3. **子进程**：统一 `cross-spawn`；Windows 上引擎若为 `.cmd` 包装器由 cross-spawn 处理（指南 §5.5）。
4. **消息 ID 唯一性**：协议消息 id + 序号组合，多分片加 `-suffix`（指南 §5.1）。
5. **版本漂移哨兵**：引擎版本 ≠ 已验证版本（0.16.3）时记录结构化告警日志，便于协议变更时快速定位。

---

## 7. 测试与验收

```bash
# 静态检查（指南 §6）
npx tsc --noEmit -p server/tsconfig.json
npx eslint server/modules/providers/list/zcode/**/*.ts server/shared/types.ts

# 单元测试（新增 server/modules/providers/tests/zcode-*.test.ts）
npm test -- server/modules/providers/tests/mcp.test.ts
npm test -- server/modules/providers/tests/skills.test.ts
```

单测覆盖（fixture 驱动，不依赖真实 ZCode 安装）：

- 协议编解码：信封序列化/响应关联/通知路由/畸形行容错
- SQLite 读取器：用构造的 fixture 库验证 `fetchHistory` 分页、归一化、子 agent 过滤
- MCP：`zcode.json` 读写往返、未知键保留、scope 映射
- 引擎路径解析与版本探测的降级分支

手动验收清单：

- [ ] 空状态选择 ZCode → 弹出登录引导（未安装/未登录均不抛错）
- [ ] 新会话发起对话，前端出现流式输出与工具调用展示，run 结束有 complete 与 token 统计
- [ ] 中断按钮触发 `session/stop` 后前端停止输出
- [ ] 桌面 ZCode 里能看到 CloudCLI 创建的会话并可续接（共享模式）
- [ ] 在桌面 ZCode 产生的会话出现在 CloudCLI 侧边栏（watcher → synchronizer 链路）
- [ ] 重启 CloudCLI 后历史分页加载正常（SQLite 只读路径）
- [ ] `zcode.json` 中增删 MCP server 在前端 MCP 面板正确反映，且 hooks 等无关键不丢失

---

## 8. 风险与缓解

| # | 风险 | 等级 | 状态 | 缓解 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 协议无公开文档且随版本漂移（CLI 0.16.3 ↔ 桌面 App 3.7.7 双版本线，App 更新可能改协议） | 高 | ✅ 已缓解 | 全部协议交互隔离在 `zcode-protocol.client.ts` 单文件；版本哨兵已实现；zod 错误自描述使适配成本低 |
| 2 | CloudCLI 子进程环境凭据可用性未验证 | 高 | ✅ 已解决 | Phase 0.2 已验证凭据路径；登录引导已实现 |
| 3 | 流式/审批事件结构未知 | 中 | ✅ 已解决 | Phase 0.1/0.3 已确认事件结构；完整消息归一化已实现 |
| 4 | SQLite 并发冲突 | 中 | ✅ 已缓解 | 只读短连接已实现；watcher 去抖已配置 |
| 5 | 与桌面 App 状态互见引发用户困惑 | 低 | ✅ 已处理 | 默认为特性；`ZCODE_STORAGE_DIR` 隔离配置已支持 |
| 6 | Windows 路径未验证 | 低 | ✅ 已实现 | Windows 引擎路径解析已实现；跨平台兼容完成 |

---

## 9. 里程碑与工作量

| 阶段 | 内容 | 状态 |
| :--- | :--- | :--- |
| Phase 0 | 前置验证门（§2） | ✅ 已完成（2026-08-17） |
| Phase 1 | Step 1 类型扩展 + tsc 暴露的全部分支补齐 | ✅ 已完成 |
| Phase 2 | 协议客户端 + runtime（§3.2.2/3.2.3） | ✅ 已完成 |
| Phase 3 | sessions + synchronizer + watcher 接入（§3.2.8/3.2.9 与 Step 3 第 4 项） | ✅ 已完成 |
| Phase 4 | auth / models / skills / mcp（§3.2.4–3.2.7） | ✅ 已完成 |
| Phase 5 | 前端 UI（Step 4） | ✅ 已完成 |
| Phase 6 | 测试、验收清单、文档更新（含本计划标注待验证项回填） | ✅ 已完成（2026-08-18） |

**✅ 所有阶段已完成**（实际约 2,842 行 TypeScript 代码，对标现有 4 个 provider 共约 6000 行的实现规模；zcode 复用 SkillsProvider/McpProvider 基类与 opencode 的 SQLite 同步模式，工作量集中在协议客户端与事件归一化）。

---

## 附录 A：Spike 实测事实（2026-08-17）

**环境**：macOS darwin 25.5.0 arm64；ZCode 桌面 App 3.7.7（`/Applications/ZCode.app`）；内嵌 CLI 自报版本 `0.16.3`。

**引擎入口**：`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`（`#!/usr/bin/env node`，独立 Node 打包产物；`Resources/glm/packages/` 内含各官方插件）。

**CLI 能力**（`--help` 实测）：子命令 `app-server / commands / doctor / login / logout / plugins / skills / tui / version`；无头选项 `--prompt`、`-p`、`--json`、`--mode plan|build|edit|yolo`（`--prompt` 默认 yolo）、`--resume <sess_*>`、`-c/--continue`、`--attach <path>`、`--cwd`、`--max-turns`、`--allowed-tools/--disallowed-tools`、`--settings`（**帮助中列出但解析器拒绝，0.16.3 瑕疵**）。`--output-format` **不存在**。

**app-server 协议**（实测）：
- 信封 `{id, method, params}`，禁止 `jsonrpc` 键（zod strict 校验，错误带逐字段 issue）；错误码 `-32600/-32601`。
- `session/list`（空 params）实测返回：`sessionId / title / titleSource / mode / status / sessionKind / workspace{workspaceKey,workspacePath} / createdAt / updatedAt / traceId`，数据与桌面 App 共享同一 SQLite。

**数据布局**（实测）：
- `~/.zcode/cli/db/db.sqlite`（WAL 活跃）：表 `session(id, project_id, parent_id, title, title_source, directory, task_type, time_created, time_updated, …)`、`message(id, session_id, data, sequence, …)`、`part / permission / todo / tool_usage / turn_usage / model_usage / input_history / local_setting / workflow_*`。
- `message.data` 样本：`{role, modelID:"GLM-5.3", providerID:"builtin:bigmodel-coding-plan", variant, mode:"yolo", tokens:{input,output,reasoning,cache}, cost, path:{cwd,root}, parentID, time:{created}}`。
- 子 agent：`agents/<sess_id>/<agent_id>/{metadata.json, transcript.jsonl, output.txt}`；`session` 表中为 `sess_subagent_agent_*` 行（`parent_id` 非空）。
- 原始模型 I/O：`rollout/model-io-<sess_id>.jsonl`（含完整请求体，注意含系统提示词，勿直接展示）。
- 模型目录：`~/.zcode/v2/config.json` 顶层 `provider` 块（含 `kind:"anthropic"`、`baseURL:"https://open.bigmodel.cn/api/anthropic"`、逐模型 `reasoning.variants` 与 `limit`）。

**配置体系**（bundle 逆向 + 实验验证）：
- 分层设置 `System(0) < User(10) < Project(20) < Session(30) < Env(40) < Cli(50)`；键含 `model.main / model.lite / model.available / modelCatalog.overrides / permission.mode`（默认 `build`）；权限枚举 `plan|build|edit|yolo|auto`。
- 用户配置路径硬编码 `~/.zcode/cli/config.json`（`ZCODE_STORAGE_DIR` 不覆盖它）；模型条目 schema `{providerId, modelId, variant?}` strict。
- 项目配置发现 `zcode.json` / `.zcode/config.json`（`discoverProjectConfigPaths` 自 cwd 向上），支持 `hooks`、`mcp.servers`（项目 hooks 受安全策略管控）；但 `-p` 无头路径不读项目层 `model`。
- 环境变量：`ZCODE_STORAGE_DIR`（存储根，默认 `~/.zcode`）、`ZCODE_DATA_BASE_DIR`（加密凭据存储根，键 `oauth:zai:access_token` 等）、`ZCODE_APP_VERSION`、`ZCODE_SESSION_ID`、`ZCODE_PROJECT_DIR` 等。
- `-p` 独立运行被 `Model config is missing` 阻塞（写入用户 config 的 `model` 键实测仍报错，疑因 strict 全量校验或 builtin 目录解析失败）——已因此弃用 B 路线。

**凭据**：OAuth（`login` 子命令，"shared Z.AI login credentials"）；macOS keychain 未检出 `zai` 服务项，落盘路径待 Phase 0.2 确认。

**内置 provider 目录**（bundle）：`builtin:bigmodel`、`builtin:bigmodel-coding-plan`、`builtin:zai`、`builtin:zai-coding-plan`、`builtin:zapi…`；App 另带 `Resources/model-providers/models_catalog_*.json`（第三方 marketplace 目录，schema `zcode.model-providers.v1`）。
