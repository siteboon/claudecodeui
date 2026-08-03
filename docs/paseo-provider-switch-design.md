# Paseo 跨 Provider 会话切换机制与 CloudCLI 实现设计

## 结论

Paseo 确实实现了用户所感知的“在同一个任务/session 中切换任意 agent/provider”。其核心不是让一个 Claude 原生 session 变成 Codex thread，而是把身份分成三层：

```text
Project
└── Workspace                         # 稳定的用户任务容器
    ├── Agent session A               # provider=claude
    │   └── Claude native session id
    ├── Agent session B               # provider=codex
    │   └── Codex native thread id
    └── Agent session C               # provider=opencode / ACP
        └── provider-native handle
```

用户留在同一个 Workspace；每次跨 provider 都创建新的 Paseo `agentId` 和新的 provider-native handle。旧 agent 及其原生恢复句柄继续保留。需要继承上下文时，Paseo 从源 agent 的规范化 timeline 生成 `chat_history`，将它作为目标 agent 首次 prompt 的上下文附件。

对 CloudCLI，正确的目标同样是：

```text
Conversation (稳定 URL / 侧边栏条目)
└── 1..N AgentSession (每个 provider leg 一个不可变身份)
    └── 0..1 provider-native session/thread
```

不能通过原地更新当前 `sessions.provider` 和 `provider_session_id` 实现切换。那样会破坏旧历史、恢复、取消、权限、usage 和 watcher 去重的归属关系。

## 研究基线

- Paseo repository: <https://github.com/getpaseo/paseo.git>
- Paseo commit: [`87ef631ac48fead7104b310c49c0d01e69eed3e0`](https://github.com/getpaseo/paseo/commit/87ef631ac48fead7104b310c49c0d01e69eed3e0)
- CloudCLI commit: `d9d3c12770dfc83a3e7ab937f640a0ac60949992`
- Paseo PR [#1788](https://github.com/getpaseo/paseo/pull/1788): 首次实现从 assistant turn 生成 chat-history attachment 并 fork 到 draft。
- Paseo PR [#2022](https://github.com/getpaseo/paseo/pull/2022): 把 fork chat 扩展到所有 agent provider。
- Paseo changelog 明确记录 “Fork chats with every supported agent provider”: [`CHANGELOG.md` L202](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/CHANGELOG.md#L202)。

## Paseo 的真实实现

### 1. Workspace 是稳定 session，Agent session 是 provider-bound leg

Paseo 的产品文档明确说明它以 workspace 而不是 chat 为组织单位，一个 workspace 可以包含多个同时存在的 session：

- [`public-docs/workspaces.md` L9-L36](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/public-docs/workspaces.md#L9-L36)
- [`public-docs/workspaces.md` L47-L60](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/public-docs/workspaces.md#L47-L60)

一个 agent session 则固定对应一个 provider、model、cwd 和 timeline：

- [`docs/glossary.md` L24-L29](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/docs/glossary.md#L24-L29)

Workspace 自身保存稳定 `workspaceId`、`projectId` 和 `cwd`：

- [`workspace-registry.ts` L37-L85](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/workspace-registry.ts#L37-L85)

每个 agent record 独立保存 `id`、`provider`、`workspaceId`、配置、runtime 信息和 persistence handle：

- [`agent-storage.ts` L13-L82](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-storage.ts#L13-L82)

Agent 到 Workspace 是显式 ownership，不在运行时通过 cwd 猜测：

- [`agent-manager.ts` L303-L329](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L303-L329)
- [`workspace-directory.ts` L614-L629](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/workspace-directory.ts#L614-L629)

### 2. 跨 provider 会创建新 agent，而不是改写旧 agent

新 agent 请求把 `workspaceId` 与 `config.provider/model` 分开传递。创建流程生成新的 `agentId`，按目标 provider 选择 client，创建目标 provider 的原生 session，再把新 agent 归入原 workspace：

- [`create-agent/create.ts` L173-L186](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/create-agent/create.ts#L173-L186)
- [`create-agent/create.ts` L226-L299](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/create-agent/create.ts#L226-L299)
- [`agent-manager.ts` L1001-L1040](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L1001-L1040)
- [`agent-manager.ts` L2799-L2848](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L2799-L2848)

### 3. Provider-native handle 严格绑定 provider

Paseo 的通用持久化句柄同时保存 provider discriminator 和 native session id：

- [`agent-types.ts` L140-L160](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/protocol/src/agent-types.ts#L140-L160)

恢复时，`AgentManager` 强制选择 `handle.provider` 对应的 client；即使传入 override，也不能借此把旧 handle 换到另一个 provider：

- [`agent-manager.ts` L1072-L1120](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L1072-L1120)
- [`agent-manager.ts` L1196-L1242](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L1196-L1242)

ACP adapter 对 provider mismatch 直接抛错：

- [`acp-agent.ts` L796-L815](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/acp-agent.ts#L796-L815)

不同 adapter 分别保存自己的原生身份：

- Claude session id: [`claude/agent.ts` L2433-L2447](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/claude/agent.ts#L2433-L2447)
- Codex thread id: [`codex-app-server-agent.ts` L4207-L4231](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/codex-app-server-agent.ts#L4207-L4231)
- OpenCode session id: [`opencode-agent.ts` L4137-L4148](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/opencode-agent.ts#L4137-L4148)

所以 provider-native key 的完整类型至少是 `(provider, nativeSessionId)`，且它只属于一个 app agent session。

### 4. 上下文连续性来自 fork/handoff

Paseo 的协议支持从明确 timeline 边界生成 fork context：

- request/response: [`messages.ts` L1404-L1410](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/protocol/src/messages.ts#L1404-L1410)、[`messages.ts` L3662-L3673](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/protocol/src/messages.ts#L3662-L3673)
- server 读取源 agent canonical tail: [`session.ts` L6258-L6311](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/session.ts#L6258-L6311)

Curator 的关键行为：

1. 在 collapse/update 之前按精确 sequence/cursor 选择原始 timeline rows。
2. 检查 timeline epoch，拒绝 stale cursor。
3. 把 provider-specific rows 投影为统一 timeline item。
4. 保留 user/assistant 文本和经过摘要的 tool call。
5. 排除 reasoning、raw external tool input 和不应转移的运行时噪音。
6. 生成 `text/plain`、`contextKind: chat_history` 的附件，并用 `<chat-history-summary>` 包裹。

源码：[`activity-curator.ts` L224-L336](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/activity-curator.ts#L224-L336)。

历史附件会排在新 user text 前面：

- [`prompt-attachments.ts` L7-L38](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/prompt-attachments.ts#L7-L38)

UI 把 attachment 放进同 workspace 的 draft，默认继承源 provider/model，但 draft 的 provider/model 可改为任意可用项：

- [`agent-stream/view.tsx` L270-L319](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/agent-stream/view.tsx#L270-L319)
- [`agent-stream/view.tsx` L477-L541](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/agent-stream/view.tsx#L477-L541)
- [`workspace-tab.tsx` L136-L209](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/composer/draft/workspace-tab.tsx#L136-L209)

最终序列为：

```text
source agent
  -> canonical normalized timeline through boundary
  -> curated chat_history
  -> same-workspace draft
  -> choose arbitrary provider/model
  -> new agentId
  -> new provider-native session/thread
  -> chat_history + new user prompt
```

### 5. Model switch 与 provider switch 是两条路径

已运行 agent 的 model selector 只展示当前 `agent.provider` 的 model，并调用当前 agent 的 model mutation：

- [`agent-controls/index.tsx` L1417-L1466](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/composer/agent-controls/index.tsx#L1417-L1466)
- [`agent-controls/index.tsx` L1493-L1517](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/composer/agent-controls/index.tsx#L1493-L1517)

因此应保持以下语义：

```text
同 provider 切 model  -> 更新当前 AgentSession 的 model/config
跨 provider           -> 新建 AgentSession + 新 native handle + context handoff
```

### 6. 并发、取消和权限不跟随 UI focus

Paseo 每个 agent 只允许一个 active foreground run：

- [`agent-manager.ts` L1943-L1976](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L1943-L1976)

同一 agent 的 provider event 被串行处理：

- [`agent-manager.ts` L2916-L2993](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L2916-L2993)

取消会等待 provider acknowledgement/terminal settlement；取消失败时 replacement/reload/rewind 不能继续：

- [`agent-manager.ts` L2261-L2348](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L2261-L2348)

权限请求属于具体 agent runtime，不会搬到目标 provider：

- [`agent-manager.ts` L2226-L2258](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L2226-L2258)

## CloudCLI 当前架构评估

### 已经具备的基础

CloudCLI 当前已经有第一层 identity indirection：

- `sessions.session_id` 是稳定 app-facing id。
- `sessions.provider_session_id` 是 provider-native id。
- 新会话在第一次 WebSocket send 之前就分配 app id。
- provider runtime 内部使用 native id resume。
- `ChatSessionWriter` 把 provider-native event 的 `sessionId` 改写回 app id。

关键源码：

- 表结构：`server/modules/database/schema.ts` L99-L123。
- app/native ID 映射：`server/modules/database/repositories/sessions.db.ts` L148-L214。
- 建立 app session：`server/modules/providers/services/sessions.service.ts` L150-L176。
- history 使用数据库中的 provider/native id：同文件 L178-L225。
- WebSocket 从数据库解析 provider，不信任 client provider：`server/modules/websocket/services/chat-websocket.service.ts` L141-L231。
- writer 隐藏 provider-native id：`server/modules/websocket/services/chat-session-writer.service.ts` L30-L145。
- provider dispatcher：`server/modules/providers/services/provider-runtime.service.ts` L35-L106。

这意味着无需推翻现有 adapter。需要把当前 `AppSession 1:1 ProviderSession` 扩展为 `Conversation 1:N AgentSession`。

### 当前阻止跨 provider 的绑定点

1. `sessions` 一行只能保存一个 `provider/provider_session_id/model/jsonl_path`。
2. `chat.send` 从这一行选择唯一 provider。
3. `chatRunRegistry` 直接按 app `sessionId` 键控运行。
4. `fetchHistory` 只调用这一行的一个 provider history adapter。
5. `ChatSessionWriter` 只能把一个 native id 绑定回一个 app session。
6. 前端 provider selector 仅在 `!selectedSession && !currentSessionId` 时展示：`src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx` L175-L187。
7. 打开已有 session 后，`useChatProviderState` 强制同步到 `selectedSession.__provider`：`src/components/chat/hooks/useChatProviderState.ts` L454-L461。
8. queued message 只保存 conversation/session id，没有保存 expected agent segment：`src/hooks/useQueuedMessageAutoSend.ts` L20-L68。

因此直接执行下面的更新是错误方案：

```sql
UPDATE sessions
SET provider = 'codex', provider_session_id = NULL
WHERE session_id = :id;
```

它会让旧 Claude transcript 失去 owner，resume 走错 adapter，abort/permission 路由可能命中错误 runtime，watcher 后续还会重新插入或错误合并旧 native session。

## CloudCLI 目标数据模型

为了兼容当前代码，建议新增 `conversations` 根表，并继续把当前 `sessions` 表作为 provider-bound agent segment 使用。第一阶段不必物理重命名表，代码类型和服务中应明确叫 `AgentSession`。

```text
Project
└── Conversation                         # 稳定 URL: /session/:conversationId
    ├── activeAgentSessionId
    ├── AgentSession 1 (sessions row)     # claude + native id
    ├── AgentSession 2 (sessions row)     # codex + native id
    └── AgentSession N
```

建议 schema：

```sql
CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  custom_name TEXT,
  active_agent_session_id TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_path) REFERENCES projects(project_path)
);

ALTER TABLE sessions ADD COLUMN conversation_id TEXT;
ALTER TABLE sessions ADD COLUMN ordinal INTEGER;
ALTER TABLE sessions ADD COLUMN previous_session_id TEXT;
ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE sessions ADD COLUMN handoff_id TEXT;
ALTER TABLE sessions ADD COLUMN handoff_boundary_seq INTEGER;
ALTER TABLE sessions ADD COLUMN context_digest TEXT;

CREATE UNIQUE INDEX idx_sessions_conversation_ordinal
  ON sessions(conversation_id, ordinal);

CREATE UNIQUE INDEX idx_sessions_provider_native
  ON sessions(provider, provider_session_id)
  WHERE provider_session_id IS NOT NULL;
```

`provider` 在 native handle 建立后不可变。`model` 可以在同 provider 且 provider 支持时更新。

建议增加两类持久化记录：

```text
ConversationEvent
  eventId
  conversationId
  agentSessionId
  runId / turnId
  seq                       # conversation 内单调递增
  providerMessageId
  kind / role / payload
  visibility

Handoff
  handoffId                 # 幂等键
  conversationId
  sourceAgentSessionId
  targetAgentSessionId
  boundarySeq
  contextText / contextJson
  contextDigest
  estimatedTokens
  status
```

Canonical `ConversationEvent` 很重要。当前历史由各 provider artifact 临时读取，跨多个 segment 做稳定边界、去重和分页会很脆弱。Gateway 应把 live normalized semantic events 写入 canonical timeline；`stream_delta` 可继续只放内存，turn 完成后用 provider transcript 对账并 upsert final message/tool rows。

每条消息、run、permission、usage 必须保留 `agentSessionId`，即使 UI 只显示一个连续 conversation。

## 切换协议

当前 Claude/Codex/Cursor/OpenCode adapter 通常要在第一次 prompt 时才真正得到 native session/thread id。因此，不建议仅点选 provider 就创建一个空 native session。UI 选择目标 provider 时先形成本地 draft；下一次发送使用一个明确的原子意图：

```json
{
  "type": "chat.switch-and-send",
  "conversationId": "conv-123",
  "expectedSourceAgentSessionId": "agent-claude-1",
  "expectedConversationVersion": 7,
  "idempotencyKey": "client-generated-uuid",
  "target": {
    "provider": "codex",
    "model": "gpt-5.4"
  },
  "boundary": {
    "eventId": "evt-456",
    "seq": 123
  },
  "cancelRunning": false,
  "contextMode": "curated",
  "content": "继续完成剩余测试",
  "options": {}
}
```

普通同-provider turn 继续使用 `chat.send`，但也应加入：

```json
{
  "conversationId": "conv-123",
  "expectedAgentSessionId": "agent-codex-2",
  "clientMessageId": "uuid"
}
```

服务端永远通过 agent-session row 解析 provider/native handle；不能直接把客户端 `target.provider` 用于 resume 已有 handle。

## 两阶段切换状态机

Provider runtime 是异步外部系统，不能把整个创建过程包在 SQLite transaction 里。应使用 reservation + activation 两阶段流程：

```text
source active/idle
    |
    | reserve (DB transaction)
    v
target initializing, source still active
    |
    | start target runtime with handoff + user prompt
    v
native handle captured
    |
    | activate (DB transaction)
    v
target active, source historical, conversation version++
```

详细步骤：

1. 读取 conversation，并校验 `expectedSourceAgentSessionId` 和 `version`。
2. 如果 source run 仍运行且 `cancelRunning=false`，返回 `409 RUN_IN_PROGRESS`。
3. 如果请求取消，先向 source adapter 发 abort，并等待明确 terminal settlement；未确认不能继续。
4. 终结或拒绝 source 的 pending permissions，不把它们转移到 target。
5. 在明确的 completed assistant boundary 读取 canonical timeline。
6. 生成 provider-neutral handoff context 和 digest。
7. 在一个 DB transaction 中按 `idempotencyKey` 插入 target `AgentSession(status=initializing)` 和 `Handoff(status=reserved)`；此时不推进 active pointer。
8. 在 transaction 外调用目标 provider runtime。内部 `sessionId` 参数使用 target `agentSessionId`，让现有 adapter 的 process map、abort 和 native-id resolution 都按 segment 隔离。
9. `ChatSessionWriter` 捕获目标 provider-native id 后，在一个 transaction 中保存 handle、标记 target active、source historical、写入 `provider_switched` boundary event、推进 `active_agent_session_id` 并增加 conversation version。
10. 激活前产生的 provider events 暂存在小型 buffer；激活成功后再按 conversation id 发布，避免失败 target 污染可见 timeline。
11. 如果 native id 建立前失败，target/handoff 标记 failed，source 保持 active，active pointer 不变。
12. 如果 native id 已建立但首个 turn 后续失败，切换已经成功；保留 target active，只把该 turn 标记 failed。
13. 相同 `idempotencyKey` 的重试返回同一 target/run，绝不创建第二个 native session。

目标状态至少应包括：

```text
draft -> initializing -> active -> historical -> archived
                    \-> failed
```

## Runtime、WebSocket 与权限改造

### ChatRunRegistry

当前 registry 按公开 app `sessionId` 键控。改造后应：

- `runsByAgentSessionId`: 精确路由 provider runtime。
- `activeRunByConversationId`: 执行“一个 conversation 只允许一个 foreground run”的产品规则。
- run event 带 `conversationId`、`agentSessionId`、`runId` 和 `segmentEpoch/conversationVersion`。
- reconnect replay 必须同时匹配 run/epoch，不能只凭会在新 run 重置的 `seq`。

### ChatSessionWriter

Writer 应同时持有：

```text
conversationId          # 对外 sessionId，URL/前端 store key
agentSessionId          # 对内 runtime owner
provider
providerSessionId       # provider-native handle
runId
```

对外仍发送 `sessionId=conversationId`，同时增加 `agentSessionId`。`setSessionId(nativeId)` 只更新 target agent-session row。

### ProviderRuntimeContext

`resolveProviderSessionId` 应改为：

```text
resolveProviderSessionId(agentSessionId, expectedProvider)
```

并强制验证 row.provider 与 expected provider 相同。`assignProviderSessionId` 合并 watcher duplicate 时也必须按 `(provider, providerSessionId)` 匹配；当前只按 native id 查询的逻辑应一并收紧。

### Abort 与 permission

- abort 地址是 `agentSessionId`，不是当前 UI focus 或 conversation active pointer。
- 现有 `chat.abort` 在 adapter 返回 boolean 后立即合成 complete；切换前应升级为可等待 settlement 的 `AbortResult`。
- permission request 增加 `agentSessionId/runId`。
- permission response 校验请求仍属于该 run；过期 request 返回 `STALE_PERMISSION_REQUEST`。
- target provider 从不继承 source pending permission。

## Handoff context 设计

Handoff 不是客户端文件附件，不能经过当前“只允许 upload store 文件”的 attachment trust boundary。应定义 server-trusted `HandoffContext`，只由服务端 curator 创建。

建议包含：

1. 用户目标和约束。
2. 已完成的关键结论与决策。
3. 最近的 user/assistant turns。
4. 工具调用的名称和短结果摘要。
5. 修改过的文件、测试结果和未解决问题。
6. source provider、boundary seq 和 digest，用于审计，不作为模型指令。

必须排除：

- reasoning/thinking 原文。
- raw tool input 中可能存在的 secret。
- permission request/response。
- 大段 shell 输出和重复 stream delta。
- target provider 不理解的 source runtime metadata。

建议预算：

```text
handoffBudget = min(64k tokens, targetContextWindow * 30%)
```

超预算时保留首个目标、最近 turns 和 unresolved work；中段先结构化摘要，再截断低价值 tool output。不要像简单 tail truncation 那样丢掉任务目标。

对只接受单字符串 prompt 的 CLI adapter，可使用可识别 envelope：

```text
<cloudcli-handoff version="1" source-provider="claude" boundary-seq="123">
...
</cloudcli-handoff>

<current-user-message>
继续完成剩余测试
</current-user-message>
```

Canonical timeline 是 UI 的权威来源，因此这个注入块不会被重复显示成用户消息。Provider history normalizer 仍应识别并剥离 envelope，作为对账 fallback。

## History、usage、archive 与 watcher

### History

`GET /api/providers/sessions/:id/messages` 应迁移为 conversation-aware service：

1. 通过 conversation id 取全部 segments。
2. 优先读 canonical events 并按 conversation seq 分页。
3. 对尚未导入的 legacy segment，调用其 provider history adapter，标记 agentSessionId 后导入/合并。
4. 切换边界作为显式 event 展示。
5. 不重复展示注入给 target 的 handoff history。

### Token usage

Usage 仍按 agent segment/provider 读取，再返回：

```json
{
  "total": {},
  "segments": [
    { "agentSessionId": "...", "provider": "claude", "usage": {} },
    { "agentSessionId": "...", "provider": "codex", "usage": {} }
  ]
}
```

### Archive/delete

- archive conversation：隐藏根记录，保留所有 segments/native handles。
- restore conversation：恢复根记录和 active pointer。
- force delete：逐 segment 使用对应 provider 的 deletion policy；OpenCode 共享 DB 不能因为删除一个 segment 而删除整个 DB。
- 若以后允许删除单 segment，不能删除 active segment，除非显式选择 rollback target。

### Session synchronizer

外部 CLI 新发现的 provider session 仍创建一个新的 conversation + 初始 segment。App 发起的 target segment 则通过 writer 回调认领 native id。Watcher duplicate 合并必须同时验证：

```text
provider matches
native id matches
target segment is initializing/active
project path matches
```

仅凭 “同 provider + 同 cwd 下最新 pending row” 是启发式规则；有并发 session 时可能误认领。无法从 artifact 获得 creation nonce 的 provider，应该延迟 watcher 广播并等待 runtime mapping，而不是抢先绑定不确定的 row。

## Frontend 设计

1. URL 和 sidebar 继续只使用 `conversationId`，切换后不导航到新 ID。
2. 在已有 conversation 的 composer 中也展示 provider/model selector。
3. 同 provider 选 model：调用当前 active agent-session model API。
4. 选不同 provider：只更新 `draftTargetProvider/model`，显示 “下一条消息将由 Codex 继续” 的状态；尚不创建 native session。
5. 下一次发送走 `chat.switch-and-send`。
6. 成功后插入可见边界：`Claude -> Codex · gpt-5.4`。
7. Sidebar logo 显示 active provider；详情菜单可列出 provider lineage 和每段 usage。
8. `selectedSession.__provider` 改为服务端返回的 active provider，而不是 conversation 的永久 provider。
9. session store 仍以 conversationId 分槽；每条 NormalizedMessage 增加 `agentSessionId`。
10. reconnect 订阅携带 `conversationVersion + runId + lastSeq`。

Queued message 必须保存并发送：

```text
conversationId
expectedAgentSessionId
expectedConversationVersion
targetProvider/model (若它本身是 switch draft)
clientMessageId
```

如果 active segment 已改变，服务端返回 `STALE_AGENT_SESSION`；不能悄悄把旧队列投递给新 provider。

## 推荐模块边界

按当前 backend module 规范，conversation orchestration 不应塞进 provider route 或 WebSocket route。建议：

```text
server/modules/conversations/
  index.ts
  conversation.routes.ts                  # 只校验 transport + 调 service
  repositories/conversation.repository.ts
  services/conversation.service.ts
  services/provider-switch.service.ts
  services/handoff-context.service.ts
  services/conversation-timeline.service.ts
  tests/
```

Provider adapter 继续只负责 native run/resume/abort 和 native history normalization。WebSocket handler 只解析命令并调用 `provider-switch.service` 或普通 chat orchestration service。跨模块只通过各模块 `index.ts`。

被 WebSocket、providers、conversations 共同使用的 `ConversationId`、`AgentSessionId`、`ConversationEvent`、`ProviderSwitchInput/Result` 应按仓库规范放到 `server/shared/types.ts`，并有完整约束注释；不要在各模块重复定义。

## 迁移与上线顺序

### Phase 1: 只拆身份，不开放切换

1. 创建 `conversations`，给当前 `sessions` 增加 segment 字段。
2. 每个 legacy row 创建 `conversation_id = session_id` 的根记录。
3. 原 row 成为 ordinal 1，`active_agent_session_id = session_id`。
4. URL、REST response 和 WebSocket 对外行为保持不变。
5. 运行 registry、writer、permission 和 usage 内部改用 agentSessionId。

### Phase 2: Canonical timeline

1. 增加 conversation event store。
2. 导入 legacy provider histories。
3. live gateway 写 semantic events，complete 后与 provider transcript 对账。
4. history API 改为统一 timeline，保持现有分页 response 兼容。

### Phase 3: Handoff backend

1. 实现 completed-turn boundary cursor。
2. 实现 curator、预算、digest 和 idempotent handoff。
3. 实现两阶段 `chat.switch-and-send`。
4. 先用 feature flag 仅开放 Claude <-> Codex，再覆盖 Cursor/OpenCode。

### Phase 4: UI 与兼容清理

1. 已有 session 显示 provider selector 和 switch boundary。
2. queue/reconnect/export/usage 改为 segment-aware。
3. 老 `/api/providers/sessions/*` route 保留兼容代理，再逐步迁移到 `/api/conversations/*`。
4. 最后再考虑把 SQL `sessions` 物理重命名为 `agent_sessions`；这不是功能前置条件。

## 必须覆盖的测试

1. Migration 后所有旧 session ID、URL、名称、历史和 provider-native mapping 不变。
2. Claude -> Codex 后 conversation ID 不变，生成两个不同 agent-session/native handle。
3. 旧 Claude segment 仍可按其 handle 恢复或回滚。
4. target native session 创建失败时 active pointer 不移动。
5. 相同 idempotency key 重试不会创建第二个 target。
6. 两个并发 switch 只有一个通过 version compare-and-swap。
7. source run 活跃时默认拒绝切换。
8. `cancelRunning=true` 只有在 acknowledged settlement 后继续。
9. pending permission 被 source 终结，不出现在 target。
10. stale queued message 不会发送给新 provider。
11. 跨 segment history 顺序、tail pagination 和 boundary 正确。
12. target history 不重复显示 handoff 注入文本。
13. context curator 排除 reasoning、raw secret/tool input 和 permission events。
14. reconnect replay 不会把旧 segment/run 的 seq 当作新 run seq。
15. watcher race 只合并相同 provider/native id 的 duplicate。
16. model 必须存在于 target provider catalog。
17. usage 同时返回 conversation total 和 per-segment breakdown。
18. archive/restore/delete 覆盖所有 segments，并遵守 OpenCode 共享 DB 规则。

## 不变量

- Conversation/Workspace identity 稳定，且显式拥有 1..N AgentSession。
- `AgentSession.provider` 在 native handle 建立后不可变。
- native handle 只在 `(provider, agentSessionId)` 范围内有效。
- model 必须属于该 AgentSession 的 provider catalog。
- message、run、abort、permission 和 usage 始终保留 agentSessionId。
- UI focus 或 active pointer 不能改变一个正在运行的 run 的 owner。
- 跨 provider 上下文只能来自规范化 timeline，不能直接复用 provider-native transcript/handle。
- switch 激活失败时 source 仍是 active，且 target 不污染可见 timeline。
- 所有 switch/retry 都有 idempotency key 和 optimistic version guard。

这套设计保留了 CloudCLI 当前稳定 app session ID 与 provider-native ID 分离的优点，并把 1:1 映射提升为 Paseo 所采用的稳定任务容器到多个 provider-bound agent session 的 1:N 映射。
