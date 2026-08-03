# Pi Provider 集成设计

## 背景

动机见 proposal.md - Why。本设计的核心约束是**范围切割**：只新增 Pi 一个 provider，沿用当前已存在的 `IProvider` 契约与中央装配模式，**不重构** provider 公共接缝。因此 Pi 会和现有 4 个 provider 一样，在若干中央文件里各留一处 provider 分支——这是本次刻意接受的现状，不是要修的问题。

两个来自用户的定向决策：
- 建造策略复用 Pi 官方实现（`@earendil-works/pi-coding-agent`），不自研 RPC 协议。
- 依赖锁定到稳定发布版本，不用 `latest`/`^`。

## 证据登记

| 编号 | 标签 | 陈述 | 依据 | 风险 |
|---|---|---|---|---|
| E1 | `[CONFIRMED]` | provider 通过 `IProvider` 8 facet 契约装配，registry 是 `Record<LLMProvider,IProvider>` | `server/modules/providers/provider.registry.ts`；`server/shared/interfaces.ts:47` | 低 |
| E2 | `[CONFIRMED]` | `IProvider` 强制 `mcp` facet（非 optional），Pi 必须提供一个实现 | `server/shared/interfaces.ts:47-56` | 中 |
| E3 | `[CONFIRMED]` | `LLMProvider` 是 4 元字符串联合，需加 `'pi'` | `server/shared/types.ts:69` | 低 |
| E4 | `[CONFIRMED]` | capabilities 是中央手写静态矩阵，逐 provider 一条 | `server/modules/providers/services/provider-capabilities.service.ts:37+` | 低 |
| E5 | `[CONFIRMED]` | token-usage 按 provider `if` 分支，未命中默认落 `.claude` | `.../provider-token-usage.service.ts:269/281/293/326` | 中 |
| E6 | `[CONFIRMED]` | watcher 路径为中央常量 `PROVIDER_WATCH_PATHS` | `.../sessions-watcher.service.ts:15` | 低 |
| E7 | `[CONFIRMED]` | scan cursor 为全局单例；任一 provider 失败则跳过游标推进，但各 synchronizer 独立执行 | `.../session-synchronizer.service.ts:49` | 中 |
| E8 | `[CONFIRMED]` | agent 路由逐 provider `if/else` 注入 `queryClaude/...`，文件头 `@ts-nocheck` | `server/modules/agent/agent.routes.ts:1,21-24,985-1018` | 中 |
| E9 | `[CONFIRMED]` | native session lookup 签名不含 provider | `server/modules/database/repositories/sessions.db.ts:179,263` | 高 |
| E10 | `[CONFIRMED]` | 现有 runtime 是 `.js`，其余 facet 是 `.ts` | `list/opencode/opencode-runtime.provider.js` 等 | 低 |
| E11 | `[CONFIRMED]` | Pi 提供 RPC 模式与官方客户端（`rpc-client.ts` / `AgentSession`），JSONL 严格以 `\n` 分隔，Node `readline` 不合规 | pi.dev/docs rpc + npm `@earendil-works/pi-coding-agent` | 中 |
| E12 | `[PENDING_VERIFY]` | Pi `agent_settled` 事件在目标锁定版本中存在且语义为「无 retry/compaction/follow-up 后的终态」 | 需在选定版本 changelog 与实测中确认 | 高 |
| E13 | `[PENDING_VERIFY]` | `get_state` 返回 `sessionId`/`sessionFile`/`model`；`get_available_models`/`get_commands` 可用 | 需对锁定版本实测 | 中 |
| E14 | `[PENDING_VERIFY]` | 前端每 provider 一份 model state（`claudeModel`/`cursorModel`/...）的具体位置与结构 | `src/stores/useSessionStore.ts` 等，需读确认 | 低 |

- [x] 每条关于现存代码的陈述都已登记。
- [x] 每条 `[INFERRED]` 都写出了推理依据（本表无 INFERRED）。
- [x] 高风险结论（E9/E12）未仅依赖 INFERRED：E9 为 CONFIRMED，E12 标记 PENDING_VERIFY 待实测。

## 目标 / 非目标

**目标：**
- Pi 以 `IProvider` 契约完整接入，覆盖 spec 中全部 `pi-provider` 需求。
- Pi runtime 复用 Pi 官方 RPC 客户端，不自研 JSONL 分帧/关联。
- 依赖锁定稳定版本。

**非目标（本设计层面的边界，超出 proposal 已声明范围的部分）：**
- 不新增 `(provider, provider_session_id)` 唯一约束，不改 `sessions.db.ts` 的 native lookup 签名（E9 现状保留）。
- 不改 capabilities 为「从 facet 派生」；沿用静态矩阵（E4）。
- 不做 per-provider scan cursor（E7 现状保留）。
- 不引入 typed runtime / generic coordinator；Pi 走现有 `IProviderRuntime.run(command, options, writer, context)` 契约与 agent 路由分支（E8）。
- 不消除 `@ts-nocheck`。

## 设计决策

**决策 1：Pi runtime 复用官方 RPC 客户端，通过 `pi --mode rpc` 子进程。**
理由：Pi 官方已实现 JSONL 分帧、请求关联、事件分发；E11 指出手写易踩 `readline` 不合规坑。复用官方客户端消除这一整类风险。
替代方案：(a) 自研 `PiRpcClient`——被否，重复造轮子且承担协议维护；(b) `AgentSession` 进程内内嵌——被否，与现有 4 个 provider「spawn CLI 子进程」的运行模型不一致，会引入独立的生命周期/隔离语义，超出「照现有模式加一个 provider」的范围。

**决策 2：runtime 用 TypeScript 实现（`pi-runtime.provider.ts`），不产出新的 `.js`。**
理由：现有 `.js` runtime 是历史遗留（E10）；新文件用 TS 可通过 typecheck、复用官方包类型。不改动现有 `.js`。

**决策 3：Pi 提供「不支持」语义的 mcp facet，而非把 mcp 改成 optional。**
理由：`IProvider` 当前强制 mcp（E2），改成 optional 属于被切掉的重构。Pi 的 mcp facet 读操作返回完整的分组空结构，写操作抛 `ERR-PROVIDER-CAPABILITY-UNSUPPORTED`。capabilities 矩阵里 Pi 手写 `supportsMcp:false`。

**决策 4：session 身份沿用现有 provider-less lookup，Pi native id 依赖其 UUID 唯一性。**
理由：改 lookup 签名与加唯一约束属于被切掉的重构（E9）。Pi 的 native session id 为 UUID，跨 provider 碰撞概率可忽略。此为**已知局限**，见风险表。

## 模块边界

| 模块 | 职责 | **不负责** | 输入 | 输出 | 依赖 | 状态归属 |
|---|---|---|---|---|---|---|
| `list/pi/PiPaths` | 解析 Pi 可执行文件、agent 目录、session 根 | RPC、文件解析、DB | env / settings | 路径 | fs | 无（纯解析） |
| `list/pi/PiRpcClient`（薄封装官方 client） | spawn `pi --mode rpc`、收发 RPC、事件分发 | 事件语义映射、终态判定 | argv / 请求 | 事件流 / 响应 | 官方包、PiPaths | 进程句柄（按 runId） |
| `list/pi/pi-runtime` | 运行状态机、事件映射、终态（agent_settled）、abort | 历史解析、DB 写 | run 请求 | 归一化事件 / outcome | PiRpcClient | 当前 run 进程归属 |
| `list/pi/PiSessionStore` | 解析 session JSONL 为不可变快照（一次解析） | RPC、DB 写 | session 文件 | `PiSessionSnapshot` | PiPaths、fs | 无 |
| `list/pi/pi-sessions` | 快照 → 归一化 history / 分页 | 磁盘扫描 | app session | history | PiSessionStore | 无 |
| `list/pi/pi-session-synchronizer` | 扫描 session 根 → upsert metadata | 通知 transport | 扫描触发 | upsert 计数 | PiSessionStore、sessions.db | DB session 行（与其他 provider 共享表） |
| `list/pi/pi-models` | `get_available_models` + 默认模型 + effort | 运行、认证判定 | RPC probe | 模型目录 | PiRpcClient | 无 |
| `list/pi/pi-auth` | 安装（`--version`）+ 认证（RPC probe 得模型） | 凭据管理 UI | 配置 | 状态 | PiPaths、PiRpcClient | 无 |
| `list/pi/pi-skills` | `get_commands` 过滤 skill，`/skill:<name>` | 安装/删除路径约束（复用现有 skills 规则） | RPC | skill 列表 | PiRpcClient、PiPaths | 无 |
| `list/pi/pi-token-usage`（经 pi-sessions 快照） | 从快照取最后有效 usage | JSONL 二次读取 | app session | usage | PiSessionStore | 无 |
| `list/pi/pi-mcp`（unsupported adapter） | 读返回空分组、写抛不支持 | 真实 MCP 配置 | - | 空 / 错误 | 无 | 无 |

- [x] 没有任何模块跨越多个领域。
- [x] 每一行的「不负责」都已填写。
- [x] 每份状态数据都只有一个归属模块（session 行由 synchronizer 归属；与其他 provider 共享同一张表但按 provider 维度写入）。
- [x] 依赖单向：facet → PiSessionStore/PiRpcClient → PiPaths → fs/官方包，无环。

## 规则与约束

| 类型 | 规则 | 覆盖需求 |
|---|---|---|
| 业务规则 | Pi 仅暴露 `plan` 与 `bypassPermissions` 两个权限模式，默认 `bypassPermissions` | Pi 权限模式 |
| 业务规则 | skill 调用格式为 `/skill:<name>`（不照抄 OpenCode 的 `/<name>`） | Pi skills 发现 |
| 业务规则 | token usage 取 active branch 最后一个无 error/未中止/字段完整的 assistant usage | Pi token usage |
| 系统规则 | runtime 与 auth/model probe 使用相同 flags（含 `--no-extensions`），保证目录与运行一致 | runtime / 模型 / 认证 |
| 系统规则 | 第一条 live 事件之前必须完成并持久化 app/native 绑定 | session 身份绑定 |
| 系统规则 | `agent_settled` 是唯一成功终态；其之前的进程关闭视为失败 | live chat runtime |
| 系统规则 | 进程归属按 runId 管理，abort 只作用当前 run | 运行中止 |
| 技术约束 | RPC 为严格 JSONL、仅 `\n` 分隔；由官方客户端处理，禁止用 Node `readline` 自行分帧 | live chat runtime |
| 技术约束 | 依赖锁定为精确稳定版本（无 `^`/`~`/`latest`） | 全部 |
| 技术约束 | 所有新增 backend 文件为 TypeScript | 全部 |

## 错误码注册表

| ERR ID | 常量名 | 错误码 | 提示文案 | 引用位置 |
|---|---|---|---|---|
| ERR-UNSUPPORTED-PROVIDER | `UNSUPPORTED_PROVIDER` | 已有 | 「不支持的 provider」（沿用现有 registry 错误） | registry（现存） |
| ERR-PROVIDER-CAPABILITY-UNSUPPORTED | `PROVIDER_CAPABILITY_UNSUPPORTED` | 400 | 「该 provider 不支持此能力」 | pi-mcp 写操作 |
| ERR-PI-NOT-INSTALLED | `PI_NOT_INSTALLED` | 状态值 | 「Pi 未安装」（正常状态，非抛异常） | pi-auth |
| ERR-PI-NOT-AUTHENTICATED | `PI_NOT_AUTHENTICATED` | 状态值 | 「Pi 未认证」（正常状态） | pi-auth / pi-models |
| ERR-PI-RPC-PROTOCOL | `PI_RPC_PROTOCOL` | 502 | 「Pi RPC 协议错误」 | pi-runtime 事件映射 |
| ERR-PI-RUN-FAILED | `PI_RUN_FAILED` | 500 | 「Pi 运行失败」 | pi-runtime 终态 |
| ERR-PI-SESSION-CORRUPT | `PI_SESSION_CORRUPT` | 500 | 「Pi session 文件损坏（行号 N）」 | PiSessionStore |
| ERR-PI-SESSION-VERSION-UNSUPPORTED | `PI_SESSION_VERSION_UNSUPPORTED` | 500 | 「不支持的 Pi session 版本」 | PiSessionStore |

## 数据模型

不新增数据库字段、不新增迁移。Pi 复用现有 `sessions` 表与 `assignProviderSessionId`/`getSessionByProviderSessionId`（E9，provider-less）。

| 字段 | 类型 | 必填 | 含义 | 示例 | 约束 | 枚举值 | 默认值 | 空值语义 |
|---|---|---|---|---|---|---|---|---|
| `LLMProvider` | union 扩展 | 是 | 新增成员 `'pi'` | `'pi'` | 类型联合 | claude/codex/cursor/opencode/**pi** | - | - |

Pi 运行状态机（进程内，非持久化）：
**状态流转：** `IDLE -> SPAWNING -> REQUESTING_STATE -> BINDING_SESSION -> PROMPTING -> STREAMING -> SETTLED -> CLOSED`；任一非终态可 `-> ABORTING -> ABORTED` 或 `-> FAILED`。终态：`CLOSED`、`ABORTED`、`FAILED`。

## 非功能要求

| 维度 | 要求 |
|---|---|
| 延迟 / 吞吐 | 一次 turn 一个 RPC 进程；首个流式事件应在 spawn+get_state 后立即产出，不额外缓冲 |
| 并发 | 一个 app session 同时最多一个 active run（沿用 `ChatRunRegistry`） |
| 超时 | auth/model probe 有上限超时（建议 ≤10s）；abort 优雅窗口有上限（建议 ≤5s）后强杀 |
| 重试策略 | Pi 内部 retry 映射为 `status` 事件；本层不对 RPC 做自动重试 |
| 一致性 | app/native 绑定在第一条 live 事件前持久化；同一份 session JSONL 只解析一次（PiSessionStore 快照） |
| 可观测性 | unknown event 记 debug；协议错误、spawn 错误、session 损坏各有独立错误码 |

## 风险与权衡

- [跨 provider native session id 碰撞] -> 不做唯一约束/provider-qualified lookup（切给重构）。Pi native id 为 UUID，碰撞概率可忽略；作为已知局限记录，重构变更中根治。（E9）
- [全局 scan cursor：Pi 同步失败使本轮游标不推进，下轮重扫] -> 各 synchronizer 独立执行，不丢 upsert，仅产生一次冗余重扫；不阻塞其他 provider 数据写入。（E7）
- [依赖 Pi 内部 `rpc-client` 稳定性] -> 锁定精确稳定版本；升级 Pi 需回归 RPC fixture 测试。（E11/E12）
- [`agent_settled` 是新特性，版本敏感] -> 锁定包含该特性的稳定版本并 `[PENDING_VERIFY]` 实测；probe/runtime 统一 `--no-extensions` 避免交互挂起。（E12）
- [token-usage 中央默认落 claude] -> Pi 显式在 token-usage service 增加 `pi` 分支，命中前不进入默认路径。（E5）

## 迁移计划

无数据库迁移。上线为纯新增：加依赖 → 加 `list/pi/` → registry 与中央分支注册 → 前端。回滚 = 移除 registry 注册与中央 Pi 分支（现有 4 provider 不受影响）。无已写入数据需处理。

## 待明确问题

- Pi 锁定的具体稳定版本号（须包含 `agent_settled` 与 RPC）——在 tasks 第一步 `[PENDING_VERIFY]` 中确定，不改变 spec 或模块边界。
- `--tools` 只读子集在锁定版本中的确切工具名（`plan` 模式用）——实测确定，属实现细节。
