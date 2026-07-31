# Pi Provider 集成方案（架构修订版）

> 状态：待实施
>
> 基线：基于当前仓库已有的 provider、WebSocket、Agent API、session、models、auth、skills、MCP 和 token usage 行为制定。
>
> 原则：只解决当前已经存在的功能契约及其架构问题，不为尚未存在的产品功能预留抽象。

## 1. 结论

Pi 不应作为“照抄 OpenCode 的第 5 套 adapter + 若干中央分支”接入。

最终方案分成两部分：

1. 先修正 provider 公共接缝，使 registry 成为 provider 描述、能力和 facet 的唯一真相。
2. 再通过 Pi 自带的 RPC 协议和共享 `PiSessionStore` 实现 Pi provider。

必须保留当前已经正确工作的 application 层机制：

- app session ID 与 provider-native session ID 分离。
- `ChatSessionWriter` 捕获并持久化 session mapping。
- `ChatRunRegistry` 保证一个 session 同时只有一个 run。
- live event 使用单调 `seq`，支持 reconnect replay。
- frontend 永远只接触 app session ID。
- duplicate `complete` 被防御性丢弃。

必须修正的核心问题：

- provider 差异仍泄漏在中央 capability、watcher、token usage、Agent API、server wiring 和 frontend state 中。
- `IProvider` 强迫所有 provider 实现并不支持的 facet。
- runtime 使用 `AnyRecord`、`unknown` 和隐式生命周期约定。
- runtime 与 gateway 同时拥有终态。
- provider-native session identity 未完整包含 provider。
- 同一份 native session 数据被 history、sync、model 和 usage 重复解析。

Pi runtime 必须使用：

```bash
pi --mode rpc
```

不使用：

```bash
pi -p --mode json
```

RPC 已提供当前集成所需的结构化能力：`get_state`、`prompt`、`abort`、`get_available_models`、`get_entries`、`get_tree`、`get_commands`、`get_session_stats` 和可靠终态 `agent_settled`。

## 2. 范围

### 2.1 本期范围

- WebSocket live chat。
- `/api/agent` 的 provider runtime 调度。
- abort。
- reconnect 和 replay。
- app/provider session 映射。
- session history 和 tail paging。
- session filesystem watcher 和 synchronizer。
- models、default model 和 reasoning effort。
- auth/installation status。
- token usage。
- skills discovery、安装和删除。
- 当前 MCP 接口中的 capability 表达。
- frontend provider、model、effort 和 permission state。

### 2.2 非目标

- 不实现 Pi extensions 与本项目 MCP 的转换层。
- 不实现新的 credential 管理 UI。
- 不实现 Pi 长驻 daemon 或 process pool。
- 不增加当前产品不存在的分支管理、session fork UI 或 extension 交互 UI。
- 不把 provider 架构重写扩大到与 Pi 无关的 Git workflow 行为。
- 不一次性重写现有四个 provider 的全部 runtime；迁移通过兼容 adapter 分阶段完成。

## 3. 第一性原理与系统不变量

Provider 模块的职责不是收集不同 CLI 的文件，而是吸收外部 CLI 差异，使 application 层只理解本项目自己的语义。

### 3.1 身份不变量

- `session_id` 是稳定的 app-facing ID。
- provider-native identity 是 `(provider, provider_session_id)`。
- app ID 和 provider ID 即使字符串相同，仍然是两个语义角色。
- runtime 第一次获得 native ID 时必须显式 bind，不能因为字符串相同而绕过 DB mapping。

### 3.2 运行不变量

- 一个 app session 同时最多一个 active run。
- 每个 run 拥有独立 `runId`。
- abort 针对 `runId`，不能只依赖 session ID。
- provider runtime 只产生非终态 event，并返回 outcome。
- application 层是 `complete` 的唯一生产者。
- reconnect replay 的 `seq` 由 application 层分配，provider 不参与。

### 3.3 数据不变量

- live stream 和 persisted session 是两种协议，不能假设事件结构相同。
- 同一份 provider-native session artifact 只解析一次。
- history、active model、usage 和 synchronizer 必须使用同一个解析结果。
- 正在写入的 JSONL 尾部半行不能让整个 session 读取失败。

### 3.4 能力不变量

- 已知 provider 但缺少某个 facet，应返回 `PROVIDER_CAPABILITY_UNSUPPORTED`。
- 未注册 provider 应返回 `UNSUPPORTED_PROVIDER`。
- “不支持”不能通过空成功结果伪装为“支持但没有数据”。
- frontend 行为由 backend provider descriptor 驱动；品牌名称和图标可以保留静态映射。

## 4. 当前架构判断

### 4.1 应保留的模块

`providerRuntimeService` 已经形成有效的 application/provider 接缝：它通过 registry 选择 runtime，并注入 model/session lookup，避免 provider runtime 反向解析 registry。

`ChatSessionWriter + ChatRunRegistry` 已经形成有效的 application/transport 接缝：

- `session_created` 和 `setSessionId()` 被转换成 DB mapping。
- provider-native ID 被改写成 app ID。
- event 被排序、缓存和 replay。
- active run 被集中管理。
- terminal event 被去重。

这些行为应继续由 application 层拥有。

### 4.2 必须修正的模块

| 问题 | 当前形态 | 目标形态 |
|---|---|---|
| Registry | 只负责实例查找 | provider descriptor、facet 和能力的唯一真相 |
| Capabilities | 中央静态矩阵 | provider descriptor 声明行为能力，facet 存在性表达结构能力 |
| Runtime | `command + AnyRecord + unknown writer` | typed request、typed event sink、typed outcome |
| Terminal lifecycle | runtime、process exit、gateway 都可能 complete | coordinator 唯一完成 run |
| Abort | provider 自建 `Map<sessionId, Process>` | coordinator 管理 `runId + AbortController` |
| Session identity | 部分 native lookup 不带 provider | 所有 native lookup 使用 `(provider, providerSessionId)` |
| Token usage | 中央按 provider 分支，默认落到 Claude | optional provider usage facet |
| Model cache | 中央 `UNCACHED_PROVIDERS` | model facet 声明 cache policy |
| Watch roots | 中央硬编码 provider 路径 | synchronizer 提供 watch targets |
| Scan cursor | 所有 provider 共用一个 cursor | per-provider cursor |
| Session notification | provider/watcher 反向导入 WebSocket | application publisher + WebSocket adapter |
| Agent API | 注入四个 runner 并 `if/else` | 注入一个 generic run coordinator |
| Frontend model state | 每 provider 一份 state/setter | `Partial<Record<LLMProvider, string>>` |

当前 `IProvider` 看似统一，实际上是浅模块：调用者仍需在多个位置了解每个 provider 的差异。目标是把复杂度收回 provider module，使新增 provider 的行为变化集中在 provider 自己的目录和一次 registry 注册中。

## 5. 目标架构

```text
HTTP/SSE routes                         WebSocket chat
      |                                      |
      +---------- transport adapters --------+
                         |
              ProviderRunCoordinator
        validation / identity / lifecycle / terminal
                         |
                  ProviderRegistry
       descriptor + required/optional provider facets
                         |
              concrete provider module
       native RPC / CLI / paths / files / conversion
```

依赖方向：

```text
transport -> application -> providers -> external CLI/files
```

禁止的依赖方向：

```text
providers -> websocket
providers -> HTTP/SSE routes
provider adapter -> ProviderRegistry
```

跨 `server/modules/*` 的调用必须通过对应模块的 `index.ts`。所有新增 backend 文件必须是 TypeScript。Route 只负责解析、验证、调用 application module 和转换响应。

## 6. Provider 定义和能力模型

当前产品中的 provider 都必须支持 runtime、models、auth、sessions 和 synchronizer。这些保留为 required facet。当前确实可能不支持的 MCP、skills 和 token usage 改为 optional facet。

建议目标形态：

```ts
type ProviderDefinition = {
  readonly descriptor: ProviderDescriptor;
  readonly runtime: IProviderRuntime;
  readonly models: IProviderModels;
  readonly auth: IProviderAuth;
  readonly sessions: IProviderSessions;
  readonly sessionSynchronizer: IProviderSessionSynchronizer;
  readonly skills?: IProviderSkills;
  readonly mcp?: IProviderMcp;
  readonly usage?: IProviderTokenUsage;
};

type ProviderDescriptor = {
  readonly id: LLMProvider;
  readonly permissionModes: readonly PermissionMode[];
  readonly defaultPermissionMode: PermissionMode;
  readonly supportsImages: boolean;
  readonly supportsFiles: boolean;
  readonly supportsAbort: boolean;
  readonly supportsPermissionRequests: boolean;
  readonly supportsEffort: boolean;
};
```

结构能力必须从 facet 是否存在派生：

- `supportsTokenUsage = Boolean(provider.usage)`。
- `supportsMcp = Boolean(provider.mcp)`。
- `supportsSkills = Boolean(provider.skills)`。

不能同时维护 facet 和第二份手写的 `supportsX` 真相。

Registry 负责：

- `listProviders()`。
- `resolveProvider(provider)`。
- `requireFacet(provider, facet)`。
- 注册时校验 descriptor，例如 default permission 必须存在于 permission modes 中。
- 生成 frontend capability response。

中央 routes、commands、watcher 和 services 不再包含 provider switch。

## 7. Typed Runtime 接缝

共享类型应放入 `server/shared/types.ts`，class contract 放入 `server/shared/interfaces.ts`，并遵循仓库的分组和文档注释规则。

```ts
type ProviderSessionReference = {
  appSessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  projectPath: string | null;
  artifactPath: string | null;
};

type ProviderRunRequest = {
  runId: string;
  command: string;
  session: ProviderSessionReference;
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode: PermissionMode;
  attachments: AttachmentDescriptor[];
  signal: AbortSignal;
};

type ProviderRunOutcome =
  | { status: 'completed'; exitCode: 0 }
  | { status: 'aborted'; exitCode: number }
  | { status: 'failed'; exitCode: number; error: ProviderRunError };

interface IProviderEventSink {
  bindSession(binding: {
    providerSessionId: string;
    artifactPath?: string | null;
  }): void;

  emit(event: ProviderNonTerminalEvent): void;
}

interface IProviderRuntime {
  run(
    request: ProviderRunRequest,
    sink: IProviderEventSink,
  ): Promise<ProviderRunOutcome>;
}
```

`ProviderNonTerminalEvent` 在类型层排除 `complete` 和 `session_created`。Native session binding 只能通过 `bindSession()` 完成。

### 7.1 Coordinator 生命周期

```text
validate provider and capability
  -> resolve one ProviderSessionReference
  -> create runId and AbortController
  -> register active run
  -> runtime.run(request, sink)
  -> receive outcome
  -> coordinator emits exactly one complete
  -> retain replay buffer
  -> evict completed run after retention window
```

### 7.2 Abort 生命周期

```text
chat.abort(appSessionId)
  -> resolve current runId
  -> AbortController.abort()
  -> provider maps signal to native abort
  -> runtime returns aborted outcome
  -> coordinator emits exactly one aborted complete
```

`ChatRunRegistry` 的 duplicate complete 防护继续保留，但只作为 invariant assertion 和兼容期保护，不作为正常控制流。

### 7.3 现有 provider 的迁移

现有四个 JavaScript runtime 不要求与 Pi 同时重写。先增加 `LegacyProviderRuntimeAdapter`：

- 将 typed request 转换为当前 options。
- 将旧 writer event 转换为 typed sink event。
- 拦截旧 runtime 的 `complete/session_created`。
- 将旧 `abort(sessionId)` 接到 request 的 `AbortSignal`。
- 根据旧 runtime resolve/reject 和捕获的终态构造 outcome。

Pi 直接实现新接口，不创建新的 JavaScript runtime。

## 8. Session Identity 和数据库

### 8.1 组合唯一性

增加 migration：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_provider_native_id
ON sessions(provider, provider_session_id)
WHERE provider_session_id IS NOT NULL;
```

迁移前必须检查并合并可能存在的重复 `(provider, provider_session_id)` 行，不能直接创建索引并假设数据干净。

### 8.2 Repository 接口修正

以下操作必须接收 provider：

```ts
assignProviderSessionId(
  appSessionId: string,
  provider: LLMProvider,
  providerSessionId: string,
): void;

getSessionByProviderSessionId(
  provider: LLMProvider,
  providerSessionId: string,
): SessionRow | null;
```

Duplicate merge SQL 必须包含 `provider = ?`，避免不同 provider 的相同 native ID 被错误合并。

`ProviderSessionReference` 由 application session module 根据 DB row 构造一次。History、model、usage 和 runtime 不再各自猜测传入的是 app ID 还是 native ID。

### 8.3 Pi mapping

Pi 使用 `--session-id <appSessionId>`，但在 `get_state` 成功后仍必须调用：

```ts
sink.bindSession({
  providerSessionId: state.sessionId,
  artifactPath: state.sessionFile,
});
```

绑定必须发生在第一条 live event 之前。

Pi 不使用 `findLatestPendingAppSession()` 的时间启发式。`get_state` 已提供精确 session ID 和 session file，可以确定性绑定。

## 9. Pi Provider 内部设计

### 9.1 文件结构

```text
server/modules/providers/list/pi/
  index.ts
  pi.provider.ts
  pi-paths.provider.ts
  pi-rpc-client.provider.ts
  pi-session-store.provider.ts
  pi-runtime.provider.ts
  pi-models.provider.ts
  pi-auth.provider.ts
  pi-skills.provider.ts
  pi-sessions.provider.ts
  pi-session-synchronizer.provider.ts
  pi-token-usage.provider.ts
```

不创建 `pi-runtime.provider.js` 或其他新的 backend JavaScript 文件。

`index.ts` 只导出 providers 模块注册 Pi 所需的公共定义。`PiRpcClient`、`PiPaths` 和 `PiSessionStore` 是 Pi module 的内部接缝，不暴露给其他 feature module。

### 9.2 内部依赖

```text
PiProvider
  |-- PiPaths
  |-- PiRpcClientFactory
  |-- PiSessionStore
       |-- sessions/history
       |-- session synchronizer
       |-- active model
       `-- token usage
```

`PiRpcClientFactory` 接受 process spawn dependency。生产使用真实 subprocess adapter，测试使用 fake process adapter。

## 10. PiPaths

`PiPaths` 是 Pi executable、agent directory 和 session roots 的唯一解释者。

解析范围：

- 应用可配置的 `PI_CLI_PATH`。
- `PI_CODING_AGENT_DIR`。
- `PI_CODING_AGENT_SESSION_DIR`。
- Pi `settings.json.sessionDir`。
- 默认 `<agentDir>/sessions`。

运行时不传 `--session-dir <cwd-slug>`。Pi 自己负责配置优先级和 cwd 目录编码；当前 session artifact 以 `get_state.sessionFile` 为权威。

Synchronizer 和 watcher 通过 `PiPaths.getSessionRoots()` 获得实际 root。所有路径在进入 filesystem 操作前 resolve/normalize。

## 11. PiRpcClient

`PiRpcClient` 隐藏以下实现复杂度：

- spawn `pi --mode rpc`。
- stdin JSONL serialization。
- stdout 任意 chunk 分割和多行合并。
- request ID 生成与 response correlation。
- unsolicited event 分发。
- stderr 收集。
- invalid JSON 和 unknown response 处理。
- process close 时 reject 所有 pending request。
- stdin backpressure 和 EPIPE。
- graceful close。

一次 turn 使用一个 RPC process。完成后关闭 stdin，让 Pi 正常退出。不引入常驻 process pool。

Runtime 和 probe 使用相同 extension policy：

```bash
--no-extensions
```

原因是当前应用没有 Pi extension UI request handler。若加载会发起交互请求的 extension，RPC 可能无限等待。该 flag 不表示未来永远不支持 extension，只定义本期 runtime 的确定行为。

## 12. Pi Runtime

### 12.1 Spawn

```bash
pi --mode rpc \
  --session-id <appSessionId> \
  --no-extensions \
  [--provider <upstream-provider>] \
  [--model <model-id>] \
  [--thinking <level>] \
  [--tools <tool-list>]
```

Process `cwd` 使用 request 的已验证项目路径。不向 shell 拼接 command string，所有 flags 使用 argv 数组。

### 12.2 状态机

```text
IDLE
  -> SPAWNING
  -> REQUESTING_STATE
  -> BINDING_SESSION
  -> PROMPTING
  -> STREAMING
  -> SETTLED
  -> CLOSED
```

失败状态：

```text
any non-terminal state
  -> ABORTING -> ABORTED
  -> FAILED
```

执行顺序：

1. Spawn RPC process。
2. 发送 `get_state`。
3. 校验 `sessionId`、`sessionFile`、model 和 thinking level。
4. 在任何 live event 之前调用 `sink.bindSession()`。
5. 发送 `prompt`。
6. 转换并发送非终态 event。
7. 收到 `agent_settled` 后将 run 标记为 settled。
8. 关闭 stdin 并等待 process 正常退出。
9. 返回 completed outcome。

`agent_end`、`turn_end` 或 exit code 0 都不能单独作为成功终态。`agent_settled` 之前发生的 process close 返回 failed outcome。

### 12.3 Event 映射

| Pi RPC event | App normalized event |
|---|---|
| `text_delta` | `stream_delta` |
| `thinking_delta` | `thinking` |
| `tool_execution_start` | `tool_use` |
| `tool_execution_end` | `tool_result` |
| assistant `stopReason: error` | `error` |
| retry start/update/end | `status` |
| `turn_end` | `stream_end` 和 usage snapshot |
| `agent_settled` | 返回 completed outcome，不直接 emit `complete` |

映射函数必须是 pure function，并用真实 RPC fixture 测试。Unknown event 记录 debug 信息后忽略；已知 event 的非法 payload 返回 protocol error，不能伪造成成功。

### 12.4 Abort

`request.signal` 触发后：

1. 向当前 RPC client 写入 `{ "type": "abort" }`。
2. 等待 `agent_settled` 或一个有上限的 graceful shutdown window。
3. graceful window 超时后终止该 run 的 process。
4. 返回 aborted outcome。

Process ownership 按 `runId` 管理，不建立 `Map<sessionId, ChildProcess>`。

## 13. PiSessionStore

Pi 的 live RPC event 和 session JSONL entry 不是同一协议。History 不能复用 runtime event parser。

`PiSessionStore` 提供一个小接口：

```ts
type PiSessionStore = {
  load(session: ProviderSessionReference): Promise<PiSessionSnapshot>;
};
```

`PiSessionSnapshot` 是一次解析后的不可变结果，包含：

- header/session ID/cwd/version。
- artifact path。
- active branch entries。
- current model。
- latest usable token usage。
- created/updated timestamps。
- 可转换为 history 的内容节点。

### 13.1 JSONL 读取规则

- 按行解析完整 JSON。
- 文件末尾最后一个非完整行视为 concurrent write，忽略而不是报错。
- 中间行损坏视为 artifact corruption，返回稳定错误并包含行号。
- 校验 header `type: "session"`、session ID、cwd 和支持的 version。
- 不支持的未来 session version 显式报错，不能静默误读。

### 13.2 Active branch

- 以最后一个有效 entry 作为当前 leaf。
- 根据 `parentId` 回溯到 root。
- 只转换 active branch，不显示已放弃的 sibling branch。
- 检测 cycle、重复 ID 和丢失 parent。
- 应用 Pi compaction 和 branch summary 语义，避免把已压缩内容重复展示。

### 13.3 History 转换

转换范围：

- user text。
- assistant text。
- thinking content。
- tool call 和 tool result。
- `display: true` 的 custom message。
- compaction 和 branch summary 的可显示内容。

明确忽略：

- hidden custom message。
- 非 active branch entry。
- 仅用于 session bookkeeping 的 entry。

稳定 message ID 使用：

```text
<entry.id>:<contentIndex>
```

分页继续使用现有 `sliceTailPage`，保持当前 tail paging 契约。

### 13.4 Active model

从 active branch 最后一个 `model_change` 取得当前模型，而不是读取文件中第一个 model event。

Frontend model value 使用：

```text
<upstream-provider>/<model-id>
```

内部保留结构化 `{ provider, modelId }`，只在 transport edge 序列化，避免通过任意 `/` 字符串反复猜测。

### 13.5 Token usage

取 active branch 最后一个满足以下条件的 assistant usage：

- message 没有 error stop reason。
- turn 没有 aborted。
- usage 字段完整有效。

Pi usage facet 只消费 `PiSessionSnapshot`，不重新读取 JSONL。

### 13.6 Synchronizer

Synchronizer 从同一个 snapshot 提取 session metadata 并 upsert：

- provider = `pi`。
- provider session ID。
- project/cwd。
- artifact path。
- current model。
- created/updated time。

## 14. Models

模型目录使用 RPC `get_available_models`，不直接读取 `models.json`。

原因：

- 配置文件不等于 runtime 实际目录。
- built-in、自定义 provider 和 credential 状态可能来自不同来源。
- probe 与 runtime 使用同一组 flags 才能保证 UI 中可选模型可以实际运行。

规则：

- canonical value 为 `<upstream-provider>/<model-id>`。
- default 来自 RPC `get_state.model`。
- 只有 `reasoning: true` 的模型提供 thinking effort。
- thinking level 限定为 Pi 当前接受的 `off|minimal|low|medium|high|xhigh|max`。
- Pi model facet 声明 `cachePolicy: none`；不向中央 `UNCACHED_PROVIDERS` 添加 Pi。
- runtime 收到 canonical model 后拆成独立 `--provider` 和 `--model` argv。

Model catalog probe 和 runtime 都使用 `--no-extensions`，避免 catalog/runtime policy 不一致。

## 15. Auth

Installed 定义：配置后的 Pi executable 能成功执行 `--version`。

- 不使用 shell `which pi`。
- 不从用户输入拼接 shell command。
- 支持 `PI_CLI_PATH`，否则按 process PATH 解析 executable。

Authenticated 定义：使用与 runtime 相同配置启动 RPC probe，并成功获得至少一个当前可用模型。

- 不读取或猜测 `auth.json`。
- 不直接检查某个固定 API key 环境变量。
- 不假设 credential 只能来自文件。
- “未安装”和“未认证”是正常状态，`getStatus()` 不为此抛异常。
- protocol corruption、spawn permission error 等异常与正常未认证状态区分。

## 16. Permissions

Pi 没有本项目所表达的逐工具确认权限系统，只有 tool allowlist。因此只暴露两个行为不同的模式：

| UI mode | Pi argv | 语义 |
|---|---|---|
| `plan` | `--tools read,grep,find,ls` | 仅提供当前确认的只读工具集 |
| `bypassPermissions` | 不传 `--tools` | Pi 默认完整工具集 |

Pi descriptor：

```ts
permissionModes: ['plan', 'bypassPermissions'];
defaultPermissionMode: 'bypassPermissions';
supportsPermissionRequests: false;
```

不暴露三个行为相同的 `default/acceptEdits/bypassPermissions`。Frontend 在切换 provider 时，如果当前 mode 不在 capability list 中，切换到该 provider 的 default。

`--tools` 是 agent tool allowlist，不是 OS sandbox。UI 和错误文案不能把它描述为操作系统级安全隔离。

## 17. Skills

权威 discovery 使用 RPC `get_commands`，过滤：

```ts
command.source === 'skill'
```

Pi skill invocation 格式为：

```text
/skill:<name>
```

不能照抄 OpenCode 的 `/<name>`。

Managed write root 使用 `PiPaths.agentDir/skills`。Add/remove 继续遵循当前 skills 功能的名称验证、路径约束和 `SKILL.md` 格式，不允许目录穿越。

## 18. MCP

Pi 当前没有本项目 MCP facet 所需的 provider-native 配置和写入语义。因此最终定义中 Pi 不提供 `mcp` facet。

结果：

- capability endpoint 返回 `supportsMcp: false`。
- frontend 不为 Pi 请求或展示可编辑 MCP 列表。
- 手工调用 Pi MCP route 返回 `PROVIDER_CAPABILITY_UNSUPPORTED`。

迁移期间若现有 `IProvider` 尚未改成 optional facet，可临时使用共享的 `UnsupportedProviderMcpAdapter`：

- `listServers()` 返回完整的 grouped empty shape，不返回裸 `[]`。
- `listServersForScope()` 返回对应 scope 的空数组。
- 所有 write 操作抛稳定 unsupported error。

完成 optional facet 迁移后删除该临时 adapter，不保留 `pi-mcp.provider.ts` 空实现。

## 19. Watcher、Synchronizer 和通知

### 19.1 Watch targets

`IProviderSessionSynchronizer` 增加动态 watch target 查询：

```ts
getWatchTargets(): Promise<ProviderWatchTarget[]>;
```

Watcher 从 registry 遍历 synchronizer 获取 roots，不维护中央 `PROVIDER_WATCH_PATHS`。

Pi watch targets 来自 `PiPaths.getSessionRoots()`，因此支持 env 和 settings 的当前配置。

### 19.2 Per-provider cursor

将单例 `scan_state(id = 1)` 迁移为 provider 维度，例如：

```sql
CREATE TABLE provider_scan_state (
  provider TEXT PRIMARY KEY,
  last_scanned_at TEXT NOT NULL
);
```

每个 provider 在自身 synchronize 成功后独立推进 cursor。Pi 失败不能阻止 Claude/Codex/Cursor/OpenCode 推进，反之亦然。

### 19.3 Session notification

Provider/session module 不直接导入 WebSocket。

定义 application-owned 的 session change publisher port：

- production adapter 将 upsert 转换成 WebSocket `session_upserted`。
- test adapter 在内存中记录 notification。

Synchronizer 只返回/upsert canonical app session ID，application module 决定是否通知 transport。

## 20. 两个 Runtime 入口

### 20.1 WebSocket

WebSocket handler 负责：

- transport payload 解析。
- capability validation。
- attachment 安全校验。
- 建立或解析 app session。
- 调用 `ProviderRunCoordinator.run()`。
- subscribe/replay/abort transport response。

它不做 provider dispatch，也不直接操作 Pi RPC。

### 20.2 `/api/agent`

Agent route 不再接收：

```text
queryClaude
queryCursor
queryCodex
queryOpenCode
queryPi
```

只注入一个 generic coordinator/application interface。Provider validation 通过 registry 完成，执行路径中不出现逐 provider `if/else`。

Agent API 当前的 repository clone、stream/non-stream response 和 cleanup 语义保持不变；只替换 provider 选择、model default 和 runtime execution 部分。相关业务编排应逐步从 `agent.routes.ts` 提取到 agent application module，使 route 恢复类型检查并移除 `@ts-nocheck`。

Git module 当前只支持特定 provider 的既有行为不属于 Pi 接入范围，不因本计划自动增加 Pi。

## 21. Frontend

### 21.1 Provider state

将独立的：

```text
claudeModel
cursorModel
codexModel
opencodeModel
```

改为：

```ts
Partial<Record<LLMProvider, string>>
```

统一处理初始化、localStorage、catalog validation 和 setter。Effort 已使用相似结构，model state 与之对齐。

### 21.2 Capability-driven behavior

以下行为来自 backend capability response：

- permission modes 和 default。
- effort 是否显示。
- token usage 是否可用。
- MCP 是否可用。
- skills 是否可用。
- abort、images 和 files 是否可用。

Frontend 只保留 provider logo、展示名称等静态品牌映射。

### 21.3 Pi UI

- 增加 `pi` provider type 和 brand metadata。
- 增加 Pi logo。
- model picker 展示 canonical Pi models。
- reasoning model 才展示 effort。
- permission picker 只展示 `plan` 和 `bypassPermissions`。
- MCP 页面不显示 Pi 为可配置 provider。
- skills command 显示 `/skill:<name>`。

## 22. 实施阶段

### Phase 0：行为基线和 fixtures

工作：

- 为当前四个 provider 补充 characterization tests。
- 固化 live event、mapping、resume、abort、history、usage 和 replay 契约。
- 保存真实 Pi RPC event 和 session v3 JSONL fixtures，移除 credential 和用户路径。

完成条件：

- 后续架构迁移可以用同一组 observable behavior tests 验证无回归。

### Phase 1：Registry 和 capability 收口

工作：

- 引入 `ProviderDefinition/ProviderDescriptor`。
- 将 MCP、skills、usage 改为 optional facet。
- capability response 从 registry 派生。
- model cache policy 移到 models facet。
- provider routes 和 commands provider parser 改为 registry 驱动。

完成条件：

- 新增一个测试 provider 只需注册一次，不需修改 capability、route parser 或 token service switch。
- unknown provider 与 unsupported facet 返回不同稳定错误。

### Phase 2：Session identity、sync 和 watcher

工作：

- 增加 `(provider, provider_session_id)` 唯一约束。
- 修正所有 native lookup 和 merge。
- 引入 `ProviderSessionReference`。
- watcher targets 改为 synchronizer 提供。
- scan cursor 改为 per-provider。
- 移除 providers 到 WebSocket 的反向 import。

完成条件：

- 两个 provider 使用相同 native ID 时不会错误合并。
- 单个 provider sync 失败不影响其他 provider cursor。

### Phase 3：Typed runtime 和 generic dispatcher

工作：

- 引入 typed run request、event sink、outcome。
- 引入 `ProviderRunCoordinator`。
- coordinator 成为唯一 terminal owner。
- 为当前四个 runtime 增加 legacy compatibility adapter。
- WebSocket 和 Agent API 使用 generic dispatcher。

完成条件：

- `/api/agent` 不存在新增 `queryPi` 的需求。
- provider runtime 不能通过类型发送 `complete`。
- abort 由 runId/AbortSignal 驱动。
- `agent.routes.ts` 的 provider dispatch 分支被删除。

### Phase 4：Pi 基础模块

工作：

- 实现 `PiPaths`。
- 实现并测试 `PiRpcClient`。
- 实现并测试 `PiSessionStore`。

完成条件：

- JSONL chunking、response correlation、abort 和 unexpected close 测试通过。
- branch、compaction、partial tail 和 corrupted line 测试通过。

### Phase 5：Pi facets 和注册

工作：

- runtime。
- models。
- auth。
- sessions/history。
- synchronizer/watch targets。
- token usage。
- skills。
- provider descriptor 和 registry registration。

完成条件：

- Pi 不需要中央 provider switch。
- Pi 没有空 MCP 实现。
- runtime 第一条 event 前已完成 session binding。

### Phase 6：Frontend 和端到端验收

工作：

- generic model state。
- Pi brand metadata/logo。
- capability-driven permissions、effort、usage、MCP 和 skills。
- real Pi smoke tests。

完成条件：

- 新建 session、第二轮 resume、abort、reconnect、history refresh、sidebar sync 和 model restore 全部通过。

## 23. 测试矩阵

### 23.1 Registry 和 application contract

- registry 枚举、解析和 unknown provider。
- required/optional facet validation。
- unsupported capability error。
- capability response 与 facet 存在性一致。
- generic Agent API dispatcher 不含 provider branch。

### 23.2 Runtime lifecycle

- session mapping 先于第一条 live event。
- 一个 session 拒绝第二个 active run。
- runtime success 只产生一个 complete。
- runtime throw/close 产生 failed complete。
- abort 只终止目标 run。
- abort 和 late native event 竞争仍只有一个 complete。
- completed run 可按 `seq` replay。
- buffer gap 回退 REST history。

### 23.3 Pi RPC

- 一个 chunk 多行。
- 一行跨多个 chunk。
- stdout 尾部无换行。
- response 与 event 交错。
- 多个 pending request 按 ID 匹配。
- malformed JSON。
- stderr 不污染 stdout parser。
- process unexpected close reject pending request。
- RPC abort、graceful settle 和 force termination fallback。
- retry 后以 `agent_settled` 完成。

### 23.4 Pi session store

- valid v3 header。
- 不支持版本。
- 尾部半行。
- 中间 corrupted line。
- active leaf 和 parent traversal。
- sibling branch discard。
- missing parent、duplicate ID 和 cycle。
- compaction 和 branch summary。
- hidden/display custom message。
- text、thinking、tool call/tool result。
- stable message ID。
- tail paging。
- active branch 最后 model change。
- 最后一个非 error/aborted usage。

### 23.5 Paths、models、auth 和 skills

- `PI_CLI_PATH`。
- custom `PI_CODING_AGENT_DIR`。
- custom `PI_CODING_AGENT_SESSION_DIR`。
- `settings.json.sessionDir`。
- default session root。
- canonical model ID round trip。
- reasoning model effort。
- no-extension probe/runtime policy 一致。
- installed/uninstalled/authenticated/unauthenticated。
- `/skill:<name>` discovery。
- skill path traversal rejection。

### 23.6 Database 和 sync

- 不同 provider 可拥有相同 native ID。
- 同 provider 重复 native ID 被唯一约束拒绝或确定性合并。
- app/native ID 同值仍完成 mapping。
- Pi 精确 binding 不使用 pending-session 时间启发式。
- per-provider scan cursor。
- watcher custom roots。
- session upsert notification 不依赖 provider 直接导入 WebSocket。

## 24. 验证命令

按阶段先运行窄测试，再运行完整检查：

```bash
node --import tsx --test <relevant-test-files>
npm run build
npm run typecheck
npm run lint
npm test
```

真实 Pi smoke test 至少覆盖：

1. RPC installation/model probe。
2. 新建 session 并流式输出 text/thinking。
3. tool start/end。
4. 第二轮使用同一 app session resume。
5. abort。
6. 进程完成后立即读取 history。
7. filesystem sync 后 sidebar 使用 app session ID。

## 25. 完成定义

只有同时满足以下条件，Pi provider 才算接入完成：

- Pi 只在 provider 本地目录和 registry 注册点出现；generic 中央模块没有 `if (provider === 'pi')`。
- WebSocket 和 Agent API 都通过统一 runtime coordinator。
- Runtime 和 route 不新增 `@ts-nocheck`。
- 所有新增 backend 文件为 TypeScript。
- app/native session mapping 在第一条 live event 前持久化。
- `(provider, provider_session_id)` 在 DB 和 repository 接口中均成立。
- gateway/application coordinator 是 terminal event 的唯一所有者。
- history、active model、usage 和 sync 共用 `PiSessionStore`。
- Pi models/auth 使用 RPC probe，不猜测 `models.json/auth.json`。
- Pi 只暴露真实 permission modes。
- Pi MCP 被表达为 unsupported，而不是空成功实现。
- per-provider scan cursor 和动态 watch roots 生效。
- frontend model state 不再逐 provider 复制。
- narrow tests、build、typecheck、lint、完整测试和 real Pi smoke tests 全部通过。

## 26. 主要风险与控制

| 风险 | 控制 |
|---|---|
| Pi RPC/session schema 随版本变化 | 保存真实 fixture、校验 session version、protocol error 显式失败 |
| 正在写入 JSONL 导致偶发解析失败 | 忽略尾部半行，中间损坏仍报错 |
| 大范围 runtime 迁移引入现有 provider 回归 | 先用 legacy adapter，按 observable contract 测试替换 |
| app/native mapping 与 watcher 竞争 | `get_state` 后立即 bind，DB transaction + provider-qualified merge |
| abort 与新 run 交错 | process 归属 `runId`，AbortSignal 只作用于当前 run |
| UI 展示无法兑现的权限语义 | descriptor 只暴露实际不同的两个 Pi mode |
| extension 发起无人处理的 RPC 交互 | runtime/probe 统一使用 `--no-extensions` |
| 中央遗漏 Pi 分支后静默走 Claude fallback | 删除中央 provider-specific fallback，使用 required facet dispatch |
