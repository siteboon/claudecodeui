# Paseo 同一工作上下文切换 Agent 的源码分析与实现设计

## 结论先行

Paseo 确实实现了用户所感知的“在同一个 session 中切换任意 agent/provider”，而且实现不是 UI 假象。它采用的是一组刻意分层的身份，而不是把同一个 provider 原生会话原地改成另一个 provider：

```text
Project
└── Workspace                         # 稳定的任务/工作上下文，持有 cwd
    ├── Agent session A               # provider=claude
    │   ├── Paseo agentId=A
    │   ├── 独立 timeline
    │   └── Claude native session ID
    ├── Agent session B               # provider=codex
    │   ├── Paseo agentId=B
    │   ├── 独立 timeline
    │   └── Codex native thread ID
    └── Workspace tabs/layout         # 在 A、B、draft、terminal 等目标之间切换
```

其关键机制是：

1. `workspaceId` 和 `cwd` 保持不变，因此新旧 agent 看到同一份文件、Git 状态和运行环境。
2. 每个 agent session 固定绑定一个 provider，并拥有独立的 Paseo `agentId`、timeline 和 provider-native session/thread ID。
3. 普通的新 agent 只共享 workspace 和文件状态；需要继承对话时，用户从一个已完成的 assistant turn 执行 fork。
4. fork 服务端按明确的 timeline cursor 截断旧 timeline，投影为 provider-neutral 的 `chat_history` 附件。
5. 客户端打开一个 draft。draft 默认继承源 agent 的 provider/model，但在发送前可以改选任意可用 provider/model。
6. 发送 draft 后，Paseo 在同一个 workspace 下创建新的 agent session 和新的 provider-native session，把 `chat_history` 放在新 prompt 之前。
7. 源 agent 不被覆盖，原 timeline、运行状态和原生恢复句柄仍然属于源 agent。

因此，准确的工程表述是：

> Paseo 在产品层保持同一个 workspace/task session 连续，在 provider 层创建或选择不同的 agent session。跨 provider 连续性来自共享 cwd 加显式的 turn-level context handoff，而不是让 Codex resume Claude 的 session ID。

这一区分不是否定 Paseo 的能力，恰恰是它能够可靠支持任意 provider 的原因。

## 研究基线

- 源仓库：`https://github.com/getpaseo/paseo.git`
- 默认分支：`main`
- 固定 commit：[`87ef631ac48fead7104b310c49c0d01e69eed3e0`](https://github.com/getpaseo/paseo/commit/87ef631ac48fead7104b310c49c0d01e69eed3e0)
- 本地只读 clone：`/tmp/paseo-analysis.IWa2kv/paseo`
- 调查日期：2026-07-31

下文所有 Paseo GitHub 链接都固定到该 commit，避免默认分支后续变化影响结论。`本地` 引用给出本次 clone 的文件和行号，便于复核。

## 必须区分的三种行为

Paseo 源码中有三种看起来都像“切换”的行为。只有分清它们，设计才不会把 provider、model、agent 和 workspace 混成一个概念。

| 行为 | 稳定身份 | 是否创建新 `agentId` | 是否创建新 native session | 是否自动带旧对话 |
| --- | --- | ---: | ---: | ---: |
| 切换 workspace 内已有 agent tab | `workspaceId` | 否，只改变焦点 | 否 | 各 tab 展示各自 timeline |
| 同 provider 切 model/热重载 | `agentId`、provider handle | 否 | 通常 resume 原 handle | 保留或从同 provider 重载 |
| 跨 provider fork/handoff | `workspaceId` | 是 | 是 | 是，以 `chat_history` 注入 |
| `/clear` 后换 provider | 当前 workspace/tab 位置 | 是 | 是 | 否，是 fresh draft |

### 1. Workspace 内切换已有 agent tab

Paseo 的官方文档直接说明它“围绕 workspace 而不是 chats 组织”；一个 workspace 可以同时包含多个 agent session，每个 session 是一个 tab，workspace 才是稳定容器：[`public-docs/workspaces.md` L9-L36](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/public-docs/workspaces.md#L9-L36)（本地：`public-docs/workspaces.md:9`）。创建 workspace 和向已有 workspace 添加 agent 也是两个独立动作：[`public-docs/workspaces.md` L47-L60](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/public-docs/workspaces.md#L47-L60)（本地：`public-docs/workspaces.md:47`）。

客户端 tab target 是 discriminated union。draft 引用 `draftId`，已创建的 agent tab 只引用 `agentId`；布局持久化 key 是 `${serverId}:${workspaceId}`：[`workspace-tabs/model.ts` L19-L46](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/workspace-tabs/model.ts#L19-L46)（本地：`packages/app/src/workspace-tabs/model.ts:19`）。布局和焦点按 workspace 保存到 AsyncStorage：[`workspace-layout-store.ts` L69-L117](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/stores/workspace-layout-store.ts#L69-L117)、[`L943-L959`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/stores/workspace-layout-store.ts#L943-L959)（本地：`packages/app/src/stores/workspace-layout-store.ts:69`、`:943`）。

这个路径只改变 UI 焦点，不迁移消息，也不改变任何 provider-native session。

### 2. 同 provider 切 model 或热重载

已创建 agent 的控件只从 `agent.provider` 对应的 snapshot 构造模型列表，并调用 `setAgentModel(agentId, modelId)`：[`agent-controls/index.tsx` L1441-L1517](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/composer/agent-controls/index.tsx#L1441-L1517)（本地：`packages/app/src/composer/agent-controls/index.tsx:1441`）。服务端的 `setAgentModel` 修改当前 provider session 的 model 和 agent config，并不修改 provider：[`agent-manager.ts` L1557-L1573](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L1557-L1573)（本地：`packages/server/src/server/agent/agent-manager.ts:1557`）。

热重载也明确锁定原 provider。`reloadAgentSession` 先取消本 agent 的活跃 run，然后取 `handle.provider ?? existing.provider`，resume 同一 provider handle 或为同 provider 新建 session；传入 override 不能把它变成另一个 provider：[`agent-manager.ts` L1196-L1243](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L1196-L1243)（本地：`packages/server/src/server/agent/agent-manager.ts:1196`）。

### 3. 跨 provider fork/handoff

只有 draft controls 接收跨 provider 的 `onSelectProviderAndModel`：[`agent-controls/index.tsx` L1651-L1753](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/composer/agent-controls/index.tsx#L1651-L1753)（本地：`packages/app/src/composer/agent-controls/index.tsx:1651`）。用户改选 provider/model 时，form reducer 同时更新两者及 provider-specific 偏好：[`use-agent-form-state.ts` L426-L460](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/hooks/use-agent-form-state.ts#L426-L460)（本地：`packages/app/src/hooks/use-agent-form-state.ts:426`）。

这意味着跨 provider 不是 active-agent mutation，而是：源 agent -> fork context -> 可换 provider 的 draft -> 新 agent。

### 4. `/clear` 是 fresh replacement，不是 context handoff

`/clear` 的定义就是“Archive this agent and start a fresh draft”：[`client-slash-commands/index.ts` L17-L35](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/client-slash-commands/index.ts#L17-L35)（本地：`packages/app/src/client-slash-commands/index.ts:17`）。处理器先把当前 tab retarget 为继承配置的 draft，再归档旧 agent：[`agent-panel.tsx` L1481-L1516](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/panels/agent-panel.tsx#L1481-L1516)（本地：`packages/app/src/panels/agent-panel.tsx:1481`）。

这个 draft 可以改 provider，但没有 fork 生成的 `chat_history`。因此普通 New Agent 或 `/clear` 共享 cwd/files，不自动共享旧对话。

## 身份与所有权模型

### Workspace 是稳定用户容器

Paseo glossary 对概念边界的定义很明确：

- Workspace 是 daemon 上一个具体 `cwd`，拥有 agents、tabs、terminals 等 workspace-owned state。
- Agent session 是“one provider, one model, one cwd, one timeline”。
- Provider 是 Claude Code、Codex、OpenCode 等后端；Model 是某个 provider 提供的具体 LLM。
- Tab 只是 workspace 内一个 session 的 UI surface。

证据：[`docs/glossary.md` L6-L29](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/docs/glossary.md#L6-L29)（本地：`docs/glossary.md:6`），尤其是 [`L22-L29`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/docs/glossary.md#L22-L29)。

持久化 workspace record 独立保存 `workspaceId/projectId/cwd/kind/title/branch/...`，不保存 active provider：[`workspace-registry.ts` L37-L85](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/workspace-registry.ts#L37-L85)（本地：`packages/server/src/server/workspace-registry.ts:37`）。`workspaceId` 是与路径独立生成的 opaque ID：[`docs/data-model.md` L479-L503](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/docs/data-model.md#L479-L503)（本地：`docs/data-model.md:479`）。

### Agent record 是 provider-bound 子实体

每个 agent record 分别保存：

- Paseo `id`
- `provider`
- `cwd`
- owning `workspaceId`
- provider-neutral config（含 model/mode/thinking/features）
- runtime info
- provider persistence handle
- status、title、labels、archive metadata

实现 schema：[`agent-storage.ts` L26-L82](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-storage.ts#L26-L82)（本地：`packages/server/src/server/agent/agent-storage.ts:26`）。公开 snapshot 同时暴露 `id/provider/cwd/workspaceId/model/status/persistence/runtimeInfo`：[`messages.ts` L670-L718](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/protocol/src/messages.ts#L670-L718)（本地：`packages/protocol/src/messages.ts:670`）。

Agent 到 Workspace 的归属是明确外键。运行时目录按 `agent.workspaceId` 分组，而不是根据 cwd 猜测：[`workspace-directory.ts` L614-L629](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/workspace-directory.ts#L614-L629)（本地：`packages/server/src/server/workspace-directory.ts:614`）。数据模型文档也把 `workspaceId` 称为 ownership 的 single source：[`docs/data-model.md` L74-L103](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/docs/data-model.md#L74-L103)（本地：`docs/data-model.md:74`）。

因此，同 workspace 新增 Codex agent 不修改 Claude agent record，也不修改 workspace provider；只是新增另一个 `workspaceId` 相同、`provider` 不同的 agent record。

## 持久化结构

Paseo 当前使用 `$PASEO_HOME` 下的 file-backed JSON，而非关系数据库：[`docs/data-model.md` L33-L70](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/docs/data-model.md#L33-L70)（本地：`docs/data-model.md:33`）。主要持久化分离为：

```text
$PASEO_HOME/
├── agents/{sanitized-cwd}/{agentId}.json
└── projects/
    ├── projects.json
    └── workspaces.json
```

每个 agent JSON 的实际 path 由 `cwd` 派生目录和 `${agentId}.json` 组成：[`agent-storage.ts` L346-L349](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-storage.ts#L346-L349)（本地：`packages/server/src/server/agent/agent-storage.ts:346`）。bootstrap 分别创建 `AgentStorage`、project registry、workspace registry 和 `AgentManager`：[`bootstrap.ts` L773-L823](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/bootstrap.ts#L773-L823)（本地：`packages/server/src/server/bootstrap.ts:773`）。

这种拆分非常重要：workspace 生命周期、agent 生命周期和 provider 原生恢复句柄不会彼此覆盖。

## 跨 provider fork 的完整调用链

### 步骤 1：从已完成 turn 取得精确边界

fork 菜单提供 `Fork in a new tab` 和 `Fork in a new workspace`：[`assistant-fork-menu.tsx` L15-L18](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/components/assistant-fork-menu.tsx#L15-L18)、[`L97-L117`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/components/assistant-fork-menu.tsx#L97-L117)（本地：`packages/app/src/components/assistant-fork-menu.tsx:15`、`:97`）。

它挂在 `CompletedTurnFooter` 上，只对能解析出边界的完成 turn 显示：[`turn-footer.tsx` L134-L179](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/agent-stream/turn-footer.tsx#L134-L179)（本地：`packages/app/src/agent-stream/turn-footer.tsx:134`）。边界优先使用 Paseo timeline `{epoch, seq}`，旧 daemon 才回退到 provider message ID：[`turn-boundary.ts` L3-L22](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/agent-stream/turn-boundary.ts#L3-L22)（本地：`packages/app/src/agent-stream/turn-boundary.ts:3`）。

这使 fork 的含义是“截至这个 assistant turn 的状态”，而不是“请求发出时当前 timeline 的尾部”。

### 步骤 2：客户端请求服务端构建 context

客户端 RPC 为：

```ts
agent.fork_context.request {
  agentId,
  boundaryCursor?,
  boundaryMessageId?,
  requestId
}
```

协议 schema：[`messages.ts` L1404-L1410](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/protocol/src/messages.ts#L1404-L1410)；client 调用：[`daemon-client.ts` L2840-L2873](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/client/src/daemon-client.ts#L2840-L2873)（本地：`packages/protocol/src/messages.ts:1404`、`packages/client/src/daemon-client.ts:2840`）。response 返回 `attachment/itemCount/boundaryMessageId/boundaryCursor`：[`messages.ts` L3662-L3673](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/protocol/src/messages.ts#L3662-L3673)（本地：`packages/protocol/src/messages.ts:3662`）。

### 步骤 3：服务端从 Paseo canonical timeline 截断

服务端先确保源 agent 已加载，然后以 `limit: 0` 读取全部当前 timeline rows，再把 cursor/message boundary 交给 curator：[`session.ts` L6258-L6293](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/session.ts#L6258-L6293)（本地：`packages/server/src/server/session.ts:6258`）。timeline API 的 `limit: 0` 明确定义为 selected window 中全部 rows：[`agent-timeline-store-types.ts` L16-L24](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-timeline-store-types.ts#L16-L24)（本地：`packages/server/src/server/agent/agent-timeline-store-types.ts:16`）。

截断发生在 raw rows 上，之后才做 tool update projection/collapse：[`activity-curator.ts` L224-L270](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/activity-curator.ts#L224-L270)（本地：`packages/server/src/server/agent/activity-curator.ts:224`）。所以同一个 tool call 在 fork 点之后出现的 completed update 不会污染 fork 点之前的上下文。对应测试：[`activity-curator.test.ts` L357-L397](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/activity-curator.test.ts#L357-L397)。

cursor 还带 epoch。若 UI 保存的是旧 timeline epoch，服务端拒绝而不是悄悄选择错误内容：[`activity-curator.ts` L244-L260](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/activity-curator.ts#L244-L260)，测试见 [`activity-curator.test.ts` L422-L440](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/activity-curator.test.ts#L422-L440)。

### 步骤 4：转换成 provider-neutral `chat_history`

curator 的确定性规则是：

- `maxItems: 0`，不套用普通 recent activity 数量上限。
- 只保留 `user_message`、`assistant_message`、`tool_call`。
- tool call 变成可读摘要，不传外部工具的原始 input。
- reasoning、todo、error 等不在 include list 中。
- 包装为 `<chat-history-summary>...</chat-history-summary>`，附源 agent title 和 cwd。

实现：[`activity-curator.ts` L277-L336](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/activity-curator.ts#L277-L336)（本地：`packages/server/src/server/agent/activity-curator.ts:277`）。测试明确验证 reasoning 和外部工具 raw input 被排除、边界之后内容不进入附件：[`activity-curator.test.ts` L270-L329](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/activity-curator.test.ts#L270-L329)；也验证 25 条旧消息没有被 generic recent limit 截掉：[`L331-L355`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/activity-curator.test.ts#L331-L355)。

这里的 `summary` 是 XML tag/展示名称，不代表另起一次 LLM summarization。源码是确定性的 timeline projection 和字符串渲染，没有调用模型做摘要。

### 步骤 5：在同一 workspace 打开可改 provider 的 draft

客户端把 response 保存成 draft-scoped `chat_history` attachment，并记录源 `serverId/agentId/boundary/itemCount`：[`agent-stream/view.tsx` L270-L319](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/agent-stream/view.tsx#L270-L319)（本地：`packages/app/src/agent-stream/view.tsx:270`）。

fork handler 调用 `buildAgentForkContext` 后，将 attachment 写入 workspace attachment store；`target=tab` 时使用原 `workspaceId` 打开新 draft tab：[`agent-stream/view.tsx` L477-L516](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/agent-stream/view.tsx#L477-L516)（本地：`packages/app/src/agent-stream/view.tsx:477`）。`target=workspace` 则把同一个 draft context 带到 New Workspace flow：[`L519-L537`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/agent-stream/view.tsx#L519-L537)。

draft setup 默认复制源 agent 的 provider、model、mode、thinking 和 feature values，但它只是初值，不是锁定：[`agent-stream/view.tsx` L294-L311](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/agent-stream/view.tsx#L294-L311)。前述 DraftAgentControls 可以在发送前选择其他 provider/model。

### 步骤 6：创建新 Paseo agent 和新 native session

draft submit 组装新的 `AgentSessionConfig`，携带同一个 `workspaceId`、`initialPrompt` 和 attachments 调用 `createAgent`：[`composer/draft/workspace-tab.tsx` L136-L209](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/composer/draft/workspace-tab.tsx#L136-L209)（本地：`packages/app/src/composer/draft/workspace-tab.tsx:136`）。wire request 也把 `config`、`workspaceId`、`initialPrompt` 和 `attachments` 分开建模：[`messages.ts` L1254-L1273](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/protocol/src/messages.ts#L1254-L1273)（本地：`packages/protocol/src/messages.ts:1254`）。

服务端在创建前调用 `buildAgentPrompt`；`chat_history` attachments 被固定放在新用户文本之前，图片和其他 attachments 在后：[`prompt-attachments.ts` L7-L37](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/prompt-attachments.ts#L7-L37)（本地：`packages/server/src/server/agent/prompt-attachments.ts:7`）。对应顺序测试：[`prompt-attachments.test.ts` L9-L38](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/prompt-attachments.test.ts#L9-L38)。

create command 解析目标 provider config、workspace ownership 和首轮 prompt：[`create-agent/create.ts` L254-L299](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/create-agent/create.ts#L254-L299)（本地：`packages/server/src/server/agent/create-agent/create.ts:254`）。`AgentManager` 生成新 `agentId`，按 `storedConfig.provider` 选择 provider client，调用其 `createSession`，并把新 session 注册到相同 `workspaceId`：[`agent-manager.ts` L1001-L1040](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L1001-L1040)（本地：`packages/server/src/server/agent/agent-manager.ts:1001`）。

注册后的 managed agent 同时保留 Paseo ID、provider、cwd、workspaceId、provider session 和 persistence handle：[`agent-manager.ts` L2799-L2856](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L2799-L2856)（本地：`packages/server/src/server/agent/agent-manager.ts:2799`）。

### 步骤 7：draft tab 原位变成新 agent tab

create 成功后，客户端把同一个 tab 从 `{kind: "draft", draftId}` retarget 为 `{kind: "agent", agentId: newId}`：[`agent-panel.tsx` L359-L397](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/panels/agent-panel.tsx#L359-L397)（本地：`packages/app/src/panels/agent-panel.tsx:359`）。

这一步制造了视觉上的连续性，但没有伪造底层身份连续性：新 tab target 指向新 agent，旧 tab/agent 仍可返回。

## Provider-native session/thread ID 如何处理

Paseo 的通用持久化句柄为：

```ts
interface AgentPersistenceHandle {
  provider: AgentProvider;
  sessionId: string;
  nativeHandle?: string;
  metadata?: AgentMetadata;
}
```

定义：[`agent-sdk-types.ts` L183-L189](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-sdk-types.ts#L183-L189)（本地：`packages/server/src/server/agent/agent-sdk-types.ts:183`）。通用 `AgentSession` 契约要求各 adapter 实现 `describePersistence/interrupt/close` 等行为：[`agent-sdk-types.ts` L619-L647](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-sdk-types.ts#L619-L647)。

具体 adapter 的含义如下：

| Provider | `sessionId/nativeHandle` 的实际含义 | create/resume 证据 | persistence 证据 |
| --- | --- | --- | --- |
| Claude | Claude Code session ID | [`claude/agent.ts` L1458-L1501](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/claude/agent.ts#L1458-L1501)、[`L3047-L3052`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/claude/agent.ts#L3047-L3052) | [`L2433-L2446`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/claude/agent.ts#L2433-L2446) |
| Codex | Codex app-server thread ID | [`codex-app-server-agent.ts` L3175-L3209](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/codex-app-server-agent.ts#L3175-L3209)、[`L6317-L6377`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/codex-app-server-agent.ts#L6317-L6377) | [`L4207-L4231`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/codex-app-server-agent.ts#L4207-L4231) |
| OpenCode | OpenCode session ID | [`opencode-agent.ts` L1286-L1387](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/opencode-agent.ts#L1286-L1387) | [`L4137-L4147`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/opencode-agent.ts#L4137-L4147) |
| ACP providers | ACP session ID | [`acp-agent.ts` L760-L843](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/acp-agent.ts#L760-L843) | [`L2006-L2018`](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/acp-agent.ts#L2006-L2018) |

ACP resume 甚至显式拒绝 `handle.provider !== this.provider`：[`acp-agent.ts` L796-L815](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/providers/acp-agent.ts#L796-L815)。通用 resume path 也强制 `provider: handle.provider` 并只取得对应 client：[`agent-manager.ts` L1051-L1120](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L1051-L1120)（本地：`packages/server/src/server/agent/agent-manager.ts:1051`）。

所以 native ID 必须至少以 `(provider, nativeSessionId)` 解释，并且只属于一个 app-level agent session。跨 provider handoff 必然创建新的 native session。

## Timeline 与历史连续性

### 每个 agent 的 timeline 独立

Paseo timeline store 的全部 API 都以 `agentId` 为 key，每行有 `seq/timestamp/item`，cursor 为 `{epoch, seq}`：[`agent-timeline-store-types.ts` L3-L60](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-timeline-store-types.ts#L3-L60)（本地：`packages/server/src/server/agent/agent-timeline-store-types.ts:3`）。当前默认 manager 使用 `Map<agentId, state>` 的 in-memory timeline：[`agent-timeline-store.ts` L138-L185](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-timeline-store.ts#L138-L185)（本地：`packages/server/src/server/agent/agent-timeline-store.ts:138`）。

当前 bootstrap 创建 `AgentManager` 时没有注入可选的 `durableTimelineStore`：[`bootstrap.ts` L813-L823](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/bootstrap.ts#L813-L823)。因此 daemon 重启后，agent record 和 provider handle 持久化，Paseo timeline 则通过 provider history 重建：`ensureAgentLoaded` 先按 handle resume，再调用 `hydrateTimelineFromProvider`：[`agent-loading.ts` L62-L135](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-loading.ts#L62-L135)（本地：`packages/server/src/server/agent/agent-loading.ts:62`）；manager 将 provider `streamHistory()` 事件重新记录到 agent timeline：[`agent-manager.ts` L3134-L3267](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L3134-L3267)（本地：`packages/server/src/server/agent/agent-manager.ts:3134`）。

### Fork 不是把两条 timeline 物理拼接

源 agent timeline 和目标 agent timeline 始终独立。目标 timeline 的第一轮 prompt 含源 history attachment，于是目标 provider 在自己的原生 conversation 中“知道之前发生了什么”；UI 仍可回到源 agent 的原 timeline。

因此连续性有两部分：

1. 物理工作状态：相同 workspace/cwd 下的文件、Git diff、进程和 terminal。
2. 对话语义状态：显式、可审计、带边界的 `chat_history` context。

## 并发、取消、权限和消息队列

### 不同 agent 可以并行，同一 agent 拒绝重复 foreground run

服务端 run map 按 `agentId` 保存：[`agent-run-state.ts` L40-L75](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-run-state.ts#L40-L75)（本地：`packages/server/src/server/agent/agent-run-state.ts:40`）。所以同 workspace 的 Claude agent 和 Codex agent 可以并行运行。对同一 `agentId`，如果已有 active turn/tracked run，`streamAgent` 抛出 `already has an active run`：[`agent-manager.ts` L1943-L1976](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L1943-L1976)（本地：`packages/server/src/server/agent/agent-manager.ts:1943`）。

replace 语义会先 cancel 这个 agent 的 run，再启动下一轮：[`agent-manager.ts` L2088-L2117](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L2088-L2117)。它不会取消同 workspace 的其他 agent。

### Fork 不隐式取消源 agent

fork context handler 是只读的 ensure-loaded + fetch-timeline + build-attachment 路径，没有调用 cancel。由于边界先于 projection，即便源 agent 已经继续产生后续 timeline rows，目标 context 仍只到选中的 turn。由此可得：fork 是 branch 语义，不是 replace 语义；源 agent 可以保持运行或等待其自己的 permission。

如果产品要提供“切换并停止旧 agent”，应把它设计成显式的 replace policy，而不能把 cancel 暗藏在 context fork 中。

### Permission 和 cancel 始终路由到确切 agent

permission response 接收 `agentId + requestId`，再调用该 agent session 的 adapter：[`agent-manager.ts` L2226-L2258](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L2226-L2258)（本地：`packages/server/src/server/agent/agent-manager.ts:2226`）。cancel 也只 interrupt 目标 `agentId` 的 session，并清理该 agent 的 pending permissions：[`agent-manager.ts` L2261-L2311](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-manager.ts#L2261-L2311)（本地：`packages/server/src/server/agent/agent-manager.ts:2261`）。

UI 当前焦点、workspace active tab 或“最新创建 agent”都不能替代这个执行归属 key。

### 队列按 agent 隔离，切 tab/fork 不转移旧队列

客户端 queue 是 `Map<agentId, QueuedMessage[]>`：[`session-store.ts` L388-L392](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/stores/session-store.ts#L388-L392)（本地：`packages/app/src/stores/session-store.ts:388`）。enqueue 明确写入 `input.agentId` 的数组：[`composer/actions.ts` L246-L261](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/composer/actions.ts#L246-L261)（本地：`packages/app/src/composer/actions.ts:246`）。

agent 从 running 变为 stopped 时，只 drain 对应 `agentId`：[`directory-sync/agent-replica.ts` L61-L97](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/runtime/directory-sync/agent-replica.ts#L61-L97)（本地：`packages/app/src/runtime/directory-sync/agent-replica.ts:61`）。drain 用 `${serverId}:${agentId}` 防止同 agent 并发 drain，并从相同 agent queue 取首条发送：[`host-runtime.ts` L2051-L2097](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/runtime/host-runtime.ts#L2051-L2097)（本地：`packages/app/src/runtime/host-runtime.ts:2051`）。发送失败会把原消息恢复到该 queue 的最前面：[`composer/actions.ts` L307-L335](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/app/src/composer/actions.ts#L307-L335)。

所以 fork 到新 agent 后，旧 agent 已排队的消息仍属于旧 agent；Paseo 不把它们偷偷发送给新 provider。

## Provider、Model、Agent、Run 的关系

```text
Provider 1 ── N Model
Provider 1 ── N AgentSession
Workspace 1 ── N AgentSession
AgentSession 1 ── 1 current provider-native handle
AgentSession 1 ── N Turn/Run（通常同一时刻最多一个 foreground run）
```

`AgentModelDefinition` 自带所属 `provider`：[`agent-sdk-types.ts` L75-L85](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/agent-sdk-types.ts#L75-L85)（本地：`packages/server/src/server/agent/agent-sdk-types.ts:75`）。模型列表也是先按 provider snapshot 查询，再解析该 provider 的 default model：[`provider-snapshot-manager.ts` L318-L340](https://github.com/getpaseo/paseo/blob/87ef631ac48fead7104b310c49c0d01e69eed3e0/packages/server/src/server/agent/provider-snapshot-manager.ts#L318-L340)（本地：`packages/server/src/server/agent/provider-snapshot-manager.ts:318`）。

设计不变量应是：

- model 不是 agent，也不是 provider；model ID 必须在目标 provider catalog 中解析。
- 同 provider 且 adapter 支持时，可以在同一个 agent session 内切 model。
- provider 一旦产生 native handle，就不应原地修改；换 provider 创建新 agent session。
- run/turn 是 agent session 内的一次执行，不是 session 本身。

## 对 `cli-web-ui` 当前实现的映射

以下是本仓库源码事实，不是 Paseo 源码事实。

### 已经具备的基础

当前 `sessions` 表已经把应用 ID 和 provider-native ID 分开：`session_id` 是前端稳定 ID，`provider_session_id` 在 provider 首次报告原生 ID 后填入；同一行还保存一个 `provider` 和一个 `model`。见本地 [`server/modules/database/schema.ts:99`](../server/modules/database/schema.ts#L99) 和 [`server/modules/database/repositories/sessions.db.ts:148`](../server/modules/database/repositories/sessions.db.ts#L148)。

创建新会话时，服务端先生成 app `sessionId`，provider-native ID 为空：[`server/modules/providers/services/sessions.service.ts:150`](../server/modules/providers/services/sessions.service.ts#L150)。provider runtime 后续报告原生 ID 时，run registry 把映射写回该 app session：[`server/modules/websocket/services/chat-run-registry.service.ts:163`](../server/modules/websocket/services/chat-run-registry.service.ts#L163)。

运行态也已经按 app `sessionId` 隔离：run registry 是 `Map<appSessionId, ChatRun>`，同一 app session 拒绝并发 run，不同 app session 可以并行：[`server/modules/websocket/services/chat-run-registry.service.ts:57`](../server/modules/websocket/services/chat-run-registry.service.ts#L57)、[`L207`](../server/modules/websocket/services/chat-run-registry.service.ts#L207)。

这些都可以直接保留。现有 `sessions` 实际上已经很接近 Paseo 的 provider-bound `AgentSession`。

### 当前不能原地改 provider 的原因

目前一条 `sessions` row 只有一个 `provider` 和一个 `provider_session_id`。`chat.send` 不相信客户端提供 provider，而是用 `sessionId` 读取数据库行，随后据此选择 runtime、resume ID、cwd 和 project path：[`server/modules/websocket/services/chat-websocket.service.ts:141`](../server/modules/websocket/services/chat-websocket.service.ts#L141)。

历史读取同样先由 session row 解析 provider，再把该行的 native ID 交给对应 adapter：[`server/modules/providers/services/sessions.service.ts:178`](../server/modules/providers/services/sessions.service.ts#L178)。因此直接执行：

```sql
UPDATE sessions SET provider = 'codex' WHERE session_id = '<claude-app-session>';
```

会让后续 history、resume、abort、permission 和 token usage 用 Codex adapter 解释 Claude native ID。这不是切换，而是破坏身份映射。

前端也显式把打开的 session 锁回其 `__provider`：[`src/components/chat/hooks/useChatProviderState.ts:454`](../src/components/chat/hooks/useChatProviderState.ts#L454)。只有尚未创建 session 的 empty draft selector 才显示所有 provider/model：[`src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx:175`](../src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx#L175)、[`L186`](../src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx#L186)。

### 缺失的父级身份

当前 route/sidebar identity 与 provider-bound app `sessionId` 是同一个概念。要获得 Paseo 等价能力，需要在它上面增加稳定的 `Conversation` 或 `WorkspaceConversation`：

```text
Conversation / WorkspaceConversation
└── 1..N existing sessions rows（每行就是一个 provider-bound AgentSession）
```

换 provider 时新增 session row，而不是更新旧行 provider。旧 `session_id -> provider_session_id` gateway、runtime adapter、history loader 和 abort 路由都可以继续使用。

## 面向 `cli-web-ui` 的推荐设计

本节是基于 Paseo 机制的设计建议，不声称是 Paseo 当前源码结构。

### 推荐领域模型

```text
Conversation
  id
  projectPath / cwd
  title
  activeAgentSessionId?       # 只表示 UI 默认焦点，不表示执行归属
  createdAt / updatedAt / archivedAt

AgentSession                  # 可先继续使用现有 sessions 表名
  sessionId                   # 现有稳定 app ID
  conversationId             # 新增 FK
  previousSessionId?          # lineage/handoff edge
  provider                    # native handle 创建后不可变
  model
  providerSessionId?          # 现有 provider-native ID
  status
  createdAt / updatedAt / archivedAt

Handoff
  handoffId                   # client idempotency key
  conversationId
  sourceSessionId
  targetSessionId?
  sourceBoundary
  contextText / contextHash
  targetProvider / targetModel
  status: preparing | ready | submitted | failed

TimelineEvent（若要单一视觉时间线）
  conversationId
  agentSessionId              # 永远保留真实 producer
  runId / turnId?
  sequence
  kind / content / metadata
```

如果产品希望像 Paseo 一样用多个 tab，可以不立即建设统一 `TimelineEvent` 表，每个 session 继续读取自己的 provider history。如果产品要求 URL 和聊天窗都保持“同一个 session”，则 `conversationId` 应成为 URL/sidebar identity，UI 把各 agent session 渲染为带明确 `Claude -> Codex` boundary 的连续 segments。

### 推荐切换事务

1. 客户端提交 `conversationId/sourceSessionId/sourceBoundary/targetProvider/targetModel/handoffId`。
2. 服务端校验 source session 属于该 conversation，并校验目标 model 属于目标 provider。
3. 按明确 boundary 从 source 的 normalized history 构建 server-owned handoff context；客户端不能伪造任意 history attachment。
4. 在同一 conversation/projectPath 下创建新的 app session row，provider-native ID 初始为空。
5. 将 handoff context 放在目标 provider 第一条用户 prompt 之前。
6. 目标 runtime 创建自己的 native session/thread 后，只把 native ID 写入目标 session row。
7. 创建成功后再更新 conversation 的默认 active session；失败时保留源 session 和源 active pointer。
8. 源 session、源 native handle、源 queue 和源 pending permission 保持原归属。
9. 对相同 `handoffId` 返回同一个 target session，避免网络重试创建重复 agent。

建议把两种操作明确区分：

- `fork`: 不取消 source run，允许源/目标并行。
- `replace`: 先按 `sourceSessionId` settle/abort，再创建目标 session。

### 推荐 handoff 状态机

SQLite 写入和外部 provider 创建不可能处在同一个数据库原子事务中，因此不能只用一个 `active` 布尔值描述切换。建议以 `handoffId` 为状态机主键：

```text
requested
  │ validate source ownership + target provider/model
  ▼
preparing_context
  │ snapshot source boundary + build normalized context
  ▼
creating_target
  │ create target app session row (native id is NULL)
  ▼
target_allocated
  │ submit first prompt + context to target runtime
  ▼
starting_provider
  │ capture and persist target providerSessionId
  ▼
ready
  │ update conversation.activeAgentSessionId / focus target
  ▼
completed
```

失败分支：

- `requested/preparing_context -> failed_validation`: 不创建 target，不改变 source。
- `creating_target -> failed_allocation`: 不改变 source，可用相同 `handoffId` 重试。
- `target_allocated/starting_provider -> failed_start`: target row 标记 failed 或 archived，source pointer 不变；不能把 source native ID 填入 target。
- 客户端超时后重试：服务端按 `handoffId` 返回已有状态/`targetSessionId`，不能再分配一条 target session。
- `replace` mode 的 source cancel 若被 provider 拒绝，应在创建 target 前失败；`fork` mode 不经过 source cancel。

状态转换、target session 分配和 conversation pointer 更新应分别使用短数据库事务；等待 provider 的网络/进程调用时不能持有 SQLite transaction。`activeAgentSessionId` 只是默认 UI 焦点，即使状态到 `ready`，source run、permission 和 queue 仍通过 source `sessionId` 独立存活。

### API 草案

```http
POST /api/conversations/:conversationId/handoffs
Idempotency-Key: <handoffId>
Content-Type: application/json

{
  "sourceSessionId": "app-session-claude",
  "boundary": { "messageId": "..." },
  "target": {
    "provider": "codex",
    "model": "gpt-5.4"
  },
  "mode": "fork",
  "initialPrompt": "继续完成测试并修复失败"
}
```

```json
{
  "conversationId": "conversation-1",
  "sourceSessionId": "app-session-claude",
  "targetSessionId": "app-session-codex",
  "handoffId": "client-generated-id",
  "status": "ready"
}
```

WebSocket 运行协议仍应使用 `targetSessionId`：

```json
{
  "type": "chat.send",
  "sessionId": "app-session-codex",
  "content": "继续完成测试并修复失败",
  "options": {
    "handoffId": "client-generated-id"
  }
}
```

`chat.abort`、permission decision、queue、stream subscribe 也继续使用精确 `sessionId`，不能只传 `conversationId` 或“当前 active session”。

### Backend 模块落点

按本仓库 backend module 约束，建议：

- 新的父级聚合及 handoff orchestration 放在 `server/modules/conversations/`，由 `index.ts` 暴露最小 public API。
- transport route 只校验参数、调用 service、格式化 response。
- 现有 provider/session history 与 runtime 能力继续通过 `server/modules/providers/index.ts` 使用，避免跨模块 deep import。
- 跨模块使用的 handoff request/result 类型放入 `server/shared/types.ts`，使用 `export type`/`import type` 并补完整约束注释。
- context projection、idempotency、目标 session 创建和失败补偿属于 service/store，不放 route。
- tests 放在 owning module 的 `tests/` 下。

### 队列和权限策略

建议完全复制 Paseo 的 ownership 原则：

- queue key 为 source/target `sessionId`，切换 UI 时不自动搬迁 queued messages。
- 尚未入队的 composer draft 可以由用户明确带到 target；已经排队的消息属于其原 session。
- permission key 至少为 `(sessionId, requestId)`。
- abort key 为精确 source `sessionId`，不能解析 conversation 当前焦点后再取消。
- sidebar/conversation 可聚合显示多个 session 的 running/permission badge，但点击后路由到真实 owner。

### Context 大小与安全

Paseo 当前 fork 对条目数不设上限，但目标 provider 仍有 context window。移植时建议在确定性 projection 后增加 token budget：优先保留目标、最近 turns、文件变更、测试结果和 unresolved work；超限时再做可审计的 deterministic truncation 或显式 model summary，并记录被裁剪范围。

handoff context 应由服务端从已授权 source history 构建，并作为一种独立的 server-owned attachment type。不要复用当前图片文件 path attachment 的 trust boundary，也不要允许浏览器提交任意本地路径或把任意文本标记成 trusted history。

## 实施阶段建议

### Phase 1：最小可用跨 provider fork

1. 增加 conversation parent 和 `sessions.conversation_id`。
2. 将旧 session 一对一 backfill 成 conversation，保持所有旧 URL/API 可读。
3. 增加 server-side handoff context builder 和 idempotent handoff endpoint。
4. provider switch 创建新 sessions row，并通过现有 `chat.send` 发给目标 runtime。
5. UI 在当前 session 完成 turn 后提供“Fork with...”入口，目标选择器复用新会话 provider/model catalog。
6. 旧 session history、abort、permission 和 queue 保持原逻辑。

### Phase 2：单一视觉 conversation

1. route/sidebar 改用 conversation ID，保留 `/session/:id` redirect/兼容解析。
2. conversation 页面加载全部 agent-session segments。
3. 插入可见的 provider switch boundary，并允许返回任一旧 segment。
4. 聚合运行态和 attention badge，但所有执行命令仍携带真实 session ID。

### Phase 3：持久化 canonical timeline

1. 为 provider-normalized events 增加稳定 message ID、epoch/seq cursor。
2. fork 精确到 turn boundary，拒绝 stale cursor。
3. 支持 source 后续仍运行时的稳定 branch，以及 context preview/audit。
4. 建立 token-budget、redaction 和 provider capability policy。

## 必测场景

- Claude -> Codex、Codex -> Claude、OpenCode -> Claude 均创建新的 app session 和新的 native ID。
- target native ID 永远不会覆盖 source row，source history/resume 仍走原 provider adapter。
- 同 provider 只切 model 时不创建新的 agent session；跨 provider 必须创建。
- source 正在运行时 fork 已完成 turn，不取消 source，context 不包含 boundary 后事件。
- replace mode 只取消 source session，不影响同 conversation 的其他 sessions。
- source 有 pending permission 时，permission 仍显示并只能用 source session ID 响应。
- source 有 queued messages 时，切换后 queue 不进入 target；target queue 独立。
- handoff 网络重试使用相同 idempotency key，只产生一个 target session。
- target provider 启动失败时，source active pointer、history 和 native handle 不变。
- stale/missing boundary 返回明确错误，不静默使用 timeline 尾部。
- history context 位于 target 首条 user prompt 前；reasoning/private raw tool input 不进入 handoff。
- context 超过 target model budget 时执行定义好的裁剪策略并可观察。
- daemon/browser 重启后 conversation、source/target sessions 及各自 native handle 都能恢复。

## 不应采用的实现

- 不要在同一 session row 上直接改 `provider`。
- 不要把 Claude session ID 传给 Codex resume API，反之亦然。
- 不要只在前端拼接旧消息，而服务端仍认为当前 session 属于旧 provider。
- 不要用 cwd 当 workspace/conversation identity；相同 cwd 可以有多个独立工作上下文。
- 不要用 UI 当前 tab/active session 推断 abort、permission、queue 或 stream owner。
- 不要在切换时覆盖或删除 source native handle。
- 不要把普通 New Agent 宣称为自动继承对话；需要 context 时必须走 fork/handoff。
- 不要让 model selector 跨 provider 后仍调用现有 session 的 `setModel`。

## 最终判断

Paseo 的实现可以概括为两个正交平面：

```text
共享状态平面：Workspace -> cwd/files/git/terminal/layout
执行状态平面：AgentSession -> provider/model/native handle/timeline/run/permission/queue
```

跨 provider 时，共享状态平面不变，执行状态平面新增一个 agent session；显式 handoff attachment 把源执行上下文桥接到目标执行上下文。这个模型既满足用户体验上的“同一个 session 里切换任意 agent”，又保留每个 provider 对自己原生 session/thread 的正确所有权和可恢复性。
