## Why

现有 provider 集成的公共接缝在泄漏：`IProvider` 看似统一，实际是浅模块——新增或改动一个 provider 时，调用者仍需在多个中央位置了解该 provider 的差异（capability 静态矩阵、token usage 分支、watcher 硬编码路径、agent 路由 `if/else`、native session lookup 缺 provider）。这导致"加一个 provider = 1 处干净注册 + 8 处中央改动"，且部分中央分支缺失时会**静默回退到 Claude**。

`add-pi-provider` 刻意沿用了现状、把这套重构切出去独立进行。本 change 就是被切出的另一半：把复杂度收回 provider 模块，使新增 provider 的行为变化集中在其自身目录与一次 registry 注册中。

**顺序依赖**：`add-pi-provider` 先落地（Pi 沿用现状 8 处分支）。本 change 在其后进行，范围包含把**已存在的全部 5 个 provider（claude/codex/cursor/opencode/pi）**迁移到新接缝。两者有中央文件交集，必须串行，不可并行。

## What Changes

- registry 成为 provider descriptor、facet 与能力的唯一真相：`listProviders` / `resolveProvider` / `requireFacet`，注册时校验 descriptor。
- capability response 从 facet 存在性派生（`supportsMcp = Boolean(provider.mcp)` 等），移除中央静态矩阵。
- MCP、skills、token usage 改为 **optional facet**；不支持时返回 `PROVIDER_CAPABILITY_UNSUPPORTED`，与未注册 provider 的 `UNSUPPORTED_PROVIDER` 区分。**BREAKING**：`IProvider` 的 `mcp`/`skills` 由必选改为可选。
- 引入 typed runtime 接缝（typed request / typed event sink / typed outcome）与 `ProviderRunCoordinator` 作为终态唯一所有者；现有 `.js` runtime 通过 `LegacyProviderRuntimeAdapter` 分阶段接入，不一次性重写。
- native session 身份改为 `(provider, provider_session_id)`：新增唯一约束与 provider-qualified lookup/merge。**BREAKING**：`assignProviderSessionId` / `getSessionByProviderSessionId` 签名新增 `provider` 参数。
- scan cursor 由全局单例改为 per-provider；watcher roots 由 synchronizer 动态提供；session 通知改为 application-owned publisher port，移除 providers→WebSocket 反向依赖。
- Agent API 与 WebSocket 统一走 generic coordinator，移除逐 provider `queryX` 与 `if/else`；逐步从 `agent.routes.ts` 提取业务编排并移除 `@ts-nocheck`。
- frontend 每-provider model state 收敛为 `Partial<Record<LLMProvider, string>>`，行为由 backend capability 驱动。

## Capabilities

### New Capabilities
- `provider-seams`: provider 公共接缝的对外行为契约——能力表达与 facet 存在性一致、unknown provider 与 unsupported facet 的错误码区分、跨 provider native session 身份隔离、per-provider 同步失败隔离、单一终态所有权。

### Modified Capabilities
- `pi-provider`: Pi 由"沿用现状中央分支"迁移到 optional facet + generic coordinator。仅当 `add-pi-provider` 已归档、其行为进入主 spec 后才产生 delta；本 change 不改变 Pi 的对外可观测行为，故此项为实现层迁移，不新增 Pi 行为需求。

## Impact

- 数据库：新增 `(provider, provider_session_id)` 唯一约束迁移（迁移前须合并重复行）；`scan_state` 单例迁移为 `provider_scan_state`。
- 类型/契约：`server/shared/interfaces.ts`（facet 可选化 + typed runtime）、`server/shared/types.ts`。
- Backend：`provider.registry.ts`、`provider-capabilities.service.ts`、`provider-token-usage.service.ts`、`sessions-watcher.service.ts`、`session-synchronizer.service.ts`、`sessions.db.ts`、`agent/agent.routes.ts`、`websocket/*`，以及 5 个 provider 的 runtime 适配。
- Frontend：model state 收敛与 capability 驱动行为。
- 交集与串行：与 `add-pi-provider` 的中央文件重叠，必须在其之后执行。
