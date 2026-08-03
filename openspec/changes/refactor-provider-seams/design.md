# Provider 公共接缝重构设计

## 背景

动机见 proposal.md - Why。本 change 是 `add-pi-provider` 切出的另一半。关键约束：**Pi 先落地并沿用现状**，本重构在其后进行，范围包含把已存在的 5 个 provider 都迁进新接缝。两者中央文件交集大，必须串行。

重构采用 Feathers「先加接缝、按可观测契约测试、再替换」的路线：先补齐 characterization tests（见 test-definition.md），再逐层替换，避免大范围一次性重写引入回归。

## 证据登记

| 编号 | 标签 | 陈述 | 依据 | 风险 |
|---|---|---|---|---|
| E1 | `[CONFIRMED]` | registry 仅是 `Record<LLMProvider,IProvider>` + `resolveProvider`，无 descriptor/facet 概念 | `provider.registry.ts` | 低 |
| E2 | `[CONFIRMED]` | `IProvider` 的 `mcp`/`skills` 为必选 readonly，非 optional | `server/shared/interfaces.ts:47-56` | 中 |
| E3 | `[CONFIRMED]` | capability 为中央手写静态矩阵 | `provider-capabilities.service.ts:37+` | 低 |
| E4 | `[CONFIRMED]` | token-usage 逐 provider `if`，未命中落 `.claude` | `provider-token-usage.service.ts:269/281/293/326` | 中 |
| E5 | `[CONFIRMED]` | watcher 路径为中央常量 | `sessions-watcher.service.ts:15` | 低 |
| E6 | `[CONFIRMED]` | 同步失败则跳过全局游标推进；各 synchronizer 独立执行 | `session-synchronizer.service.ts:49` | 中 |
| E7 | `[CONFIRMED]` | native lookup 签名不含 provider | `sessions.db.ts:179,263` | 高 |
| E8 | `[CONFIRMED]` | agent 路由逐 provider `queryX` + `if/else`，`@ts-nocheck` | `agent/agent.routes.ts:1,21-24,985-1018` | 中 |
| E9 | `[CONFIRMED]` | `IProviderRuntime.run(command, options:AnyRecord, writer, context)`，`abort(sessionId)` | `server/shared/interfaces.ts:30` | 中 |
| E10 | `[CONFIRMED]` | runtime 为 `.js`，其余 facet 为 `.ts` | `list/*/*-runtime.provider.js` | 低 |
| E11 | `[CONFIRMED]` | 已有 provider-native mapping 测试与 merge 行为存在 | `database/tests/sessions-provider-mapping.test.ts` | 中 |
| E12 | `[PENDING_VERIFY]` | 现网 `sessions` 表是否已存在跨 provider 相同 native id 的碰撞行 | 迁移前须对真实库查询确认 | 高 |
| E13 | `[PENDING_VERIFY]` | `ChatRunRegistry`/`ChatSessionWriter` 当前终态去重与 seq 分配的确切位置 | `websocket/services/*`，迁移前读确认 | 中 |

- [x] 每条现存代码陈述已登记。
- [x] 无 INFERRED 项混入实施结论。
- [x] 高风险项 E7 为 CONFIRMED；E12 标 PENDING_VERIFY，迁移前必须核实真实数据（涉及数据合并，硬规则要求）。

## 目标 / 非目标

**目标：**
- 把 8 处泄漏接缝收回 provider 模块，使"加 provider"回到"1 处注册 + 自身目录"。
- 对外可观测行为在重构前后保持一致（本 spec 的行为契约除外，它们是刻意的行为收紧）。
- 5 个现有 provider（含 Pi）全部迁入新接缝。

**非目标：**
- 不改变任何 provider 的上游 CLI 行为或模型能力。
- 不新增产品功能（分支管理、session fork、extension UI 等）。
- 不把重构扩大到与 provider 无关的 Git workflow。

## 设计决策

**决策 1：registry 升级为 descriptor + facet 真相，capability 从 facet 派生。**
替代方案：保留静态矩阵并加校验——被否，双真相必然漂移（E3）。

**决策 2：mcp/skills/usage 改 optional facet；unknown provider 与 unsupported facet 用不同错误码。**
替代方案：保留必选 facet + 空实现（如 Pi 的 unsupported mcp adapter）——被否，空成功掩盖"不支持"，违反契约（E2）。迁移期可临时保留空实现 adapter，optional 化完成后删除。

**决策 3：引入 typed runtime + `ProviderRunCoordinator`（终态唯一所有者），现有 5 个 runtime 经 `LegacyProviderRuntimeAdapter` 接入，不一次性重写。**
替代方案：直接重写 5 个 runtime——被否，回归风险过大。适配器把 typed request↔旧 options、旧 writer event↔typed sink、`abort(sessionId)`↔`AbortSignal` 互转，并拦截旧 runtime 的 `complete/session_created`（E9/E10）。

**决策 4：native 身份加 `(provider, provider_session_id)` 唯一约束 + provider-qualified lookup/merge。**
替代方案：仅靠 UUID 唯一性（即 add-pi-provider 现状）——被否，那是临时兜底；本 change 的职责就是根治（E7）。迁移前必须先合并真实库中的重复行（E12）。

**决策 5：scan cursor 迁 per-provider 表；watcher roots 由 synchronizer 提供；session 通知走 application publisher port。**
替代方案：保留全局游标——被否，一个 provider 失败拖累全体重扫（E6）。

## 模块边界

| 模块 | 职责 | **不负责** | 输入 | 输出 | 依赖 | 状态归属 |
|---|---|---|---|---|---|---|
| `ProviderRegistry`（重塑） | descriptor/facet 真相、`requireFacet`、descriptor 校验、生成 capability response | 运行、DB、transport | provider 定义 | provider/能力 | provider 定义 | 无 |
| `ProviderRunCoordinator`（新） | 校验/身份/生命周期/唯一终态/replay 保留 | 事件语义映射、native 协议 | run 请求 | 归一化事件/终态 | registry、runtime、run registry | active run + 终态 |
| `LegacyProviderRuntimeAdapter`（新） | typed↔旧 runtime 互转 | 终态生产（交回 coordinator） | typed request | typed outcome | 各旧 runtime | 无 |
| session identity（重塑 `sessions.db`） | provider-qualified lookup/merge | 能力、runtime | `(provider, nativeId)` | session 行 | DB | `sessions` 表 |
| `provider_scan_state`（新表 + synchronizer service 改造） | per-provider 游标 | 能力、runtime | 同步结果 | 游标推进 | DB | `provider_scan_state` 表 |
| session change publisher port（新） | application→transport 通知端口 | provider 逻辑 | upsert 事件 | 通知 | WebSocket adapter（生产）/内存（测试） | 无 |
| agent application module（提取自 `agent.routes.ts`） | generic run 编排 | provider dispatch 分支 | HTTP 请求 | 响应 | coordinator | 无 |
| frontend model state（收敛） | `Partial<Record<LLMProvider,string>>` 统一处理 | 逐 provider setter | provider/model | UI state | capability response | localStorage |

- [x] 每模块单一领域。
- [x] 「不负责」列已填。
- [x] `sessions` 表由 session identity 归属；`provider_scan_state` 由 synchronizer 归属，无双写。
- [x] 依赖单向：transport → application(coordinator/agent module) → registry → provider；providers 不再反向依赖 WebSocket（用 publisher port 打破原环 E-notify）。

## 规则与约束

| 类型 | 规则 | 覆盖需求 |
|---|---|---|
| 业务规则 | 一个 app session 同时最多一个 active run | 单一终态所有权 |
| 系统规则 | 终态只能由 coordinator 产生；runtime 只发非终态事件 | 单一终态所有权 |
| 系统规则 | 所有 native lookup/merge 必须携带 provider | 身份隔离 |
| 系统规则 | 每个 provider 独立推进自身游标 | 同步失败隔离 |
| 系统规则 | 能力描述从 facet 存在性派生，禁止第二份真相 | 能力表达一致 |
| 技术约束 | 现有 runtime 经 legacy adapter 接入，不一次性重写 | 全部（迁移安全） |
| 技术约束 | 唯一约束迁移前必须合并真实库重复行 | 身份隔离 |
| 技术约束 | 新增/改造 backend 文件为 TypeScript，逐步移除 `@ts-nocheck` | 全部 |

## 错误码注册表

| ERR ID | 常量名 | 错误码 | 提示文案 | 引用位置 |
|---|---|---|---|---|
| ERR-UNSUPPORTED-PROVIDER | `UNSUPPORTED_PROVIDER` | 400 | 「不支持的 provider」 | registry.resolveProvider |
| ERR-PROVIDER-CAPABILITY-UNSUPPORTED | `PROVIDER_CAPABILITY_UNSUPPORTED` | 400 | 「该 provider 不支持此能力」 | registry.requireFacet |
| ERR-PROVIDER-DESCRIPTOR-INVALID | `PROVIDER_DESCRIPTOR_INVALID` | 500 | 「provider descriptor 非法」 | registry 注册校验 |

## 数据模型

| 字段 | 类型 | 必填 | 含义 | 示例 | 约束 | 枚举值 | 默认值 | 空值语义 |
|---|---|---|---|---|---|---|---|---|
| `sessions` 唯一索引 | index | 是 | `(provider, provider_session_id)` 唯一 | - | `WHERE provider_session_id IS NOT NULL` | - | - | 部分索引：native id 为空的行不受约束 |
| `provider_scan_state.provider` | TEXT PK | 是 | 每 provider 一行游标 | `'pi'` | 主键 | 5 个 provider | - | 无行=该 provider 从未扫描 |
| `provider_scan_state.last_scanned_at` | TEXT | 是 | 该 provider 上次扫描时间 | ISO 字符串 | - | - | - | - |
| `IProvider.mcp` | optional facet | 否 | MCP 能力 | - | - | - | `undefined` | `undefined`=不支持 MCP |
| `IProvider.skills` | optional facet | 否 | skills 能力 | - | - | - | `undefined` | `undefined`=不支持 skills |
| `IProvider.usage` | optional facet | 否 | token usage 能力 | - | - | - | `undefined` | `undefined`=不支持 usage |

**状态流转（一次 run，由 coordinator 拥有）：** `REGISTERED -> RUNNING -> (COMPLETED | ABORTED | FAILED)`；后三者为终态，且对外恰好观察到一个。

## 非功能要求

| 维度 | 要求 |
|---|---|
| 延迟 / 吞吐 | 重构不得引入额外流式延迟；事件路径保持零额外缓冲 |
| 并发 | 一个 app session 同时最多一个 active run（沿用现有 run registry） |
| 一致性 | 唯一约束迁移在单事务内完成合并+建索引；provider-qualified merge |
| 可观测性 | 一次 run 恰好一个终态；unknown/unsupported 错误码可区分并被日志记录 |
| 兼容性 | 重构前后现有 4 provider 的 observable 行为由 characterization tests 锁定，零回归 |

## 风险与权衡

- [唯一约束迁移在真实库遇到重复 native id] -> E12 迁移前查询并合并；provider-qualified merge SQL 含 `provider = ?`；单事务。此为不可逆数据操作，须 `[PENDING_VERIFY]` 核实后执行。
- [大范围 runtime 迁移引入现有 provider 回归] -> 先补 characterization tests（test-definition），legacy adapter 分阶段替换。
- [facet optional 化触及 `IProvider` 所有实现] -> BREAKING，但由类型系统兜底：改 interface 后 typecheck 会列出全部待改点。
- [与 add-pi-provider 文件交集] -> 硬串行：本 change 必须在 add-pi-provider 归档后开始。
- [coordinator 与现有 ChatRunRegistry 终态去重职责重叠] -> 去重防护保留为 invariant assertion 与兼容期保护，不作正常控制流（E13 迁移前确认位置）。

## 迁移计划

| 项 | 内容 |
|---|---|
| 上线步骤 | 1) 补 characterization tests；2) registry+capability 派生+facet optional 化；3) 身份唯一约束（先查重合并）+per-provider 游标+publisher port；4) typed runtime+coordinator+legacy adapter，5 provider 接入；5) agent/websocket 走 generic dispatcher，去 `@ts-nocheck`；6) frontend state 收敛 |
| 回滚策略 | 分阶段，每阶段可独立回滚代码；唯一约束迁移提供 down migration（删索引/表） |
| 回滚后数据处理 | 唯一约束回滚：删除新增索引即可，已合并的重复行**不自动拆回**——须人工核对（合并是有损操作）。`provider_scan_state` 回滚：保留表，回退读写到旧 `scan_state` |

## 待明确问题

- 迁移顺序细节（capability 先还是身份先）可在 tasks 内按依赖微调，不改变 spec 与模块边界。
