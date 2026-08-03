## Why

工程当前支持 4 个 provider（Claude、Codex、Cursor、OpenCode），需要接入第 5 个 Pi coding agent（`@earendil-works/pi-coding-agent`）。Pi 提供官方 RPC 模式和官方客户端实现，可以直接复用，无需从零手写进程协议。

本次变更**只做 Pi 集成**，刻意不捆绑「provider 公共接缝的架构重构」——那是一个独立的、影响现有 4 个 provider 的高风险变更，与「新增一个 provider」是两件不同的事。Pi 沿用当前已经存在的 `IProvider` 契约与中央装配模式接入，把架构收口留给后续独立变更。

## What Changes

- 新增 `pi` 到 `LLMProvider` 类型联合。
- 新增 `server/modules/providers/list/pi/` 目录，实现 `IProvider` 的各 facet：runtime、models、auth、sessions、sessionSynchronizer、skills，以及一个「不支持」语义的 mcp facet（当前 `IProvider` 强制 mcp）。
- 引入官方依赖 `@earendil-works/pi-coding-agent`，**锁定到一个已包含 RPC 模式与 `agent_settled` 的稳定发布版本**（非 `latest`/`^`），Pi runtime 复用官方 RPC 客户端而非自研 JSONL 协议。
- 在 registry 注册 Pi，并按现有模式补齐必要的中央接入点（capabilities、token usage、watcher 路径、agent 路由、前端 provider/model/brand state）。
- 前端新增 Pi 品牌元数据、logo、model picker、permission picker（仅 `plan` 与 `bypassPermissions`）、`/skill:<name>` 展示。
- 非目标：**不**重构 provider 公共接缝（capabilities 派生、optional facet、typed runtime、generic coordinator、per-provider scan cursor 等）。这些保留现状，留待独立变更。

## Capabilities

### New Capabilities
- `pi-provider`: 把 Pi coding agent 作为一个完整 provider 接入，覆盖 live chat runtime、模型目录、安装/认证状态、session 历史与磁盘同步、skills 发现、权限模式，以及在 MCP 与 token usage 上的能力表达。

### Modified Capabilities
<!-- 无既有 spec；这些能力此前从未以 spec 形式描述，本次仅新增 Pi 能力，不修改既有 spec 行为。 -->

## Impact

- 依赖：新增 `@earendil-works/pi-coding-agent`（锁定稳定版本）。
- 类型：`server/shared/types.ts` 的 `LLMProvider` 联合。
- Backend：`provider.registry.ts`、`provider-capabilities.service.ts`、`provider-token-usage.service.ts`、`sessions-watcher.service.ts`、`agent/agent.routes.ts` 各新增 Pi 分支（沿用现有模式）。
- 新增：`server/modules/providers/list/pi/` 全部 facet 文件。
- Frontend：provider/model/brand state 与相关 picker 组件新增 Pi。
- 不影响现有 4 个 provider 的运行时行为。
