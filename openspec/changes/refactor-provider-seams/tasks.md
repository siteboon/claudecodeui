# Provider 公共接缝重构 实现任务

「构建什么」见 `specs/provider-seams/spec.md`，「怎么构建」见 `design.md`。

**前置硬约束**：本 change 必须在 `add-pi-provider` 归档后开始（中央文件交集，见 design 迁移计划）。characterization tests（任务组 1）必须先于任何替换完成并通过。

## 0. 文件归属

| 任务组 | 独占文件/目录 | 禁止改动 | 共享文件处理 |
|---|---|---|---|
| 1 | `server/modules/providers/tests/characterization/`、`server/modules/websocket/tests/` 新增用例 | 生产代码 | 只读生产代码，仅新增测试 |
| 2 | `provider.registry.ts`、`provider-capabilities.service.ts`、`server/shared/interfaces.ts`（facet 可选化）、`provider-token-usage.service.ts`、各 provider `*.provider.ts`（facet 挂载） | runtime `.js`、DB、agent 路由 | 串行在任务组 1 之后 |
| 3 | `sessions.db.ts`、`database/migrations.ts`、`database/schema.ts`、`session-synchronizer.service.ts`、`sessions-watcher.service.ts`、新增 publisher port | registry、runtime | 串行在任务组 2 之后 |
| 4 | 新增 `ProviderRunCoordinator`、`LegacyProviderRuntimeAdapter`、typed runtime 类型、5 个 runtime 的适配接入 | DB 迁移、registry | 串行在任务组 3 之后 |
| 5 | `agent/agent.routes.ts`、新增 agent application module、`websocket/services/*` | provider `list/` | 串行在任务组 4 之后 |
| 6 | `src/`（frontend model state 收敛与 capability 驱动） | backend | 无（可与 5 并行，写集不相交） |
| 7 | 无（只运行验证） | 全部 | 只读 |

- [x] 任意两个任务组「独占文件」无交集（6 与 5 分属 src/ 与 backend）。
- [x] 共享文件已串行：2→3→4→5 顺序依赖。

## 1. Characterization 基线（替换前必须完成）

- [ ] 1.1 为 claude/codex/cursor/opencode 各录制 live event、resume、abort、history、usage、replay 的 golden 输出，落为可重跑的 characterization tests（对应 R15）。
- [ ] 1.2 为「一次 run 恰好一个终态」录制现状基线（正常/abort/异常各一），作为 R10–R12 的回归锚点。
- [ ] 1.3 全部基线测试通过并纳入 `npm test`；确认后方可进入替换。

## 2. Registry、capability 与 facet 可选化

- [ ] 2.1 在 `interfaces.ts` 引入 `ProviderDescriptor` 与 `ProviderDefinition`，将 `mcp`/`skills`/`usage` 改为 optional facet（**BREAKING**）；运行 typecheck 得到全部待改实现点清单。
- [ ] 2.2 重塑 `ProviderRegistry`：`listProviders`/`resolveProvider`/`requireFacet`、注册期 descriptor 校验（默认权限模式∈权限模式列表，否则 `ERR-PROVIDER-DESCRIPTOR-INVALID`）。补测 R2、R4。
- [ ] 2.3 capability response 从 facet 存在性派生，删除中央静态矩阵；补测 R1、R3（能力与 facet 一致、unsupported facet 错误码）。
- [ ] 2.4 `provider-token-usage.service.ts` 改为 optional usage facet 派发，移除逐 provider `if` 与 `.claude` 默认回退。
- [ ] 2.5 5 个 provider 的 `*.provider.ts` 按 optional facet 重新挂载（不支持者不挂载对应 facet，删除临时空实现 adapter，如 Pi 的 unsupported mcp）。characterization（1.1）保持全绿。

## 3. Session 身份、per-provider 游标与通知端口

- [ ] 3.1 **迁移前**：对真实库查询 `(provider, provider_session_id)` 重复行（E12），记录并制定合并方案（一票否决门禁）。
- [ ] 3.2 新增迁移：单事务内合并重复行 + 建部分唯一索引 `idx_sessions_provider_native_id`（`WHERE provider_session_id IS NOT NULL`）；提供 down migration。
- [ ] 3.3 `sessions.db.ts`：`assignProviderSessionId`/`getSessionByProviderSessionId` 签名加 `provider`（**BREAKING**），merge SQL 含 `provider = ?`。补测 R5、R6、R7。
- [ ] 3.4 新增 `provider_scan_state` 表，`session-synchronizer.service.ts` 改 per-provider 游标独立推进；补测 R8、R9。
- [ ] 3.5 `sessions-watcher.service.ts` 的 watch roots 改由各 synchronizer 提供，移除中央 `PROVIDER_WATCH_PATHS`。
- [ ] 3.6 引入 application-owned session change publisher port（生产=WebSocket adapter，测试=内存），移除 providers→WebSocket 反向 import；补测 R16（依赖扫描）。

## 4. Typed runtime 与 coordinator

- [ ] 4.1 定义 typed `ProviderRunRequest`/`IProviderEventSink`（类型层排除 `complete`/`session_created`）/`ProviderRunOutcome`（`server/shared/types.ts` + `interfaces.ts`）。
- [ ] 4.2 实现 `ProviderRunCoordinator`：校验/身份/生命周期/**唯一终态**/replay 保留；成为终态唯一生产者。补测 R10、R11、R12。
- [ ] 4.3 实现 `LegacyProviderRuntimeAdapter`：typed request↔旧 options、旧 writer event↔typed sink、`abort(sessionId)`↔`AbortSignal`，拦截旧 runtime 的 `complete/session_created`。补测 R13。
- [ ] 4.4 5 个现有 runtime 经 legacy adapter 接入 coordinator；characterization（1.1、1.2）保持全绿。

## 5. Generic dispatcher 与去 @ts-nocheck

- [ ] 5.1 从 `agent.routes.ts` 提取业务编排到 agent application module，route 只做解析/校验/调用/响应转换。
- [ ] 5.2 Agent API 与 WebSocket 统一注入 generic coordinator，删除 `queryClaude/queryCursor/queryCodex/queryOpenCode/queryPi` 与逐 provider `if/else`。
- [ ] 5.3 移除本 change 目标文件的 `@ts-nocheck`，typecheck 通过。

## 6. Frontend state 收敛

- [ ] 6.1 model state 由逐 provider（`claudeModel` 等）收敛为 `Partial<Record<LLMProvider,string>>`，统一初始化/localStorage/catalog 校验/setter。
- [ ] 6.2 permission/effort/usage/mcp/skills 显示改由 backend capability response 驱动；前端仅保留 logo/展示名等静态品牌映射。

## 7. 验证

- [ ] 7.1 characterization + 契约测试（R1–R16）全绿。
- [ ] 7.2 `npm run build`、`npm run typecheck`、`npm run lint`、`npm test` 全绿。
- [ ] 7.3 端到端冒烟：5 个 provider（含 Pi）新建/resume/abort/reconnect/history/sidebar/model restore 不回归。
- [ ] 7.4 确认「加一个测试 provider」只需注册一次，无需改 capability/route parser/token service。
