# Pi Provider 测试定义

依据 `specs/pi-provider/spec.md` 的需求与场景。本变更涉及外部进程、RPC 协议解析、并发中止竞态、磁盘 session 解析，属真实风险变更，需在场景通过/失败之外给出分维度门槛。

## 测试目标与边界

**范围内：**
- Pi runtime 的事件映射、终态判定（`agent_settled` 唯一成功终态）、协议错误处理。
- app/native session 绑定发生在第一条 live 事件之前。
- abort 只作用当前 run、优雅窗口超时后强杀。
- PiSessionStore 的 JSONL 解析：有效、尾部半行、中间损坏、不支持版本、active branch、usage 提取。
- models/auth 的 RPC probe 行为与「未安装/未认证」正常态。
- skills `/skill:<name>` 发现；权限模式仅两种；MCP 不支持表达。
- registry 解析与能力描述一致性。

**范围外：**
- provider 公共接缝重构（唯一约束、per-provider cursor、typed runtime）——不在本变更。
- 现有 4 个 provider 的行为回归（本变更不改其运行时代码，仅新增中央 Pi 分支）。
- Pi 上游模型本身的输出质量。

## 覆盖策略

| 维度 | 是否覆盖 | 样本数 | 说明 |
|---|---|---|---|
| 正常路径 | 是 | 9 | 每条 spec 需求的正常场景各一 |
| 异常 | 是 | 8 | 进程早关、协议错误、未认证、未安装、中间损坏、不支持版本、优雅超时、无 usage |
| 边界 | 是 | 5 | 单 chunk 多行、一行跨多 chunk、尾部半行、active leaf 回溯、最后 model_change |
| 对抗 | 是 | 4 | 畸形 JSON、stderr 污染 stdout parser、未知事件、已知事件非法 payload |
| 高风险 | 是 | 4 | abort 与 late native event 竞争仅一个终态、绑定先于首事件、进程 unexpected close reject pending、`--no-extensions` probe/runtime 一致 |

## 评测集

RPC 与 session JSONL 使用**去敏的真实 Pi fixture**（移除凭据与用户路径）。样本按 spec 场景一一映射挑选，覆盖每类适用异常。

| 编号 | 输入 | 预期 | 维度 | 来源 |
|---|---|---|---|---|
| T1 | 正常 prompt，RPC 流至 `agent_settled` | 归一化 text/thinking 流 + 一次成功完成 | 正常 | spec: live chat |
| T2 | 进程在 `agent_settled` 前 close | `ERR-PI-RUN-FAILED` 失败完成 | 异常 | spec: live chat |
| T3 | 已知事件携带非法 payload | `ERR-PI-RPC-PROTOCOL` | 对抗 | spec: live chat |
| T4 | 未知事件 | 忽略并记 debug，运行不受影响 | 对抗 | spec: live chat |
| T5 | 新 session 首轮 get_state 成功 | 首事件前持久化 app/native 绑定 | 高风险 | spec: 身份绑定 |
| T6 | 同 app session 第二轮 | 复用映射，无重复绑定 | 正常 | spec: 身份绑定 |
| T7 | abort 流式中的 run | 一次「已中止」完成 | 正常 | spec: 中止 |
| T8 | abort 后 Pi 迟发 native event | 仍只有一个终态 | 高风险 | spec: 中止 |
| T9 | 优雅窗口内无响应 | 强杀 + 「已中止」完成 | 异常 | spec: 中止 |
| T10 | `get_available_models` probe | canonical 模型列表 + 默认 | 正常 | spec: 模型 |
| T11 | 未认证下取模型 | `ERR-PI-NOT-AUTHENTICATED`，非空目录冒充 | 异常 | spec: 模型/认证 |
| T12 | 可执行 `--version` 失败 | 报未安装，不抛异常 | 异常 | spec: 认证 |
| T13 | 可执行但 probe 无模型 | 报未认证，不抛异常 | 异常 | spec: 认证 |
| T14 | 有效 v-header session | active branch 归一化 history | 正常 | spec: 历史 |
| T15 | 尾部半行 | 忽略半行，返回其余 | 边界 | spec: 历史 |
| T16 | 中间损坏行 | `ERR-PI-SESSION-CORRUPT` 含行号 | 异常 | spec: 历史 |
| T17 | 不支持 session 版本 | `ERR-PI-SESSION-VERSION-UNSUPPORTED` | 异常 | spec: 历史 |
| T18 | 单 chunk 含多行 / 一行跨多 chunk | 官方 client 正确分帧 | 边界 | spec: runtime（RPC 协议） |
| T19 | 畸形 JSON / stderr 混入 stdout | 不污染 parser，pending 正确处理 | 对抗 | spec: runtime |
| T20 | 进程 unexpected close | reject 所有 pending request | 高风险 | spec: runtime |
| T21 | active branch 最后 model_change | 取该模型为当前模型 | 边界 | spec: 模型/历史 |
| T22 | 最后一个非 error/未中止 usage | 返回该 usage | 正常 | spec: usage |
| T23 | 无满足条件 usage | 返回「无 usage」，不套用他 provider 默认 | 异常 | spec: usage |
| T24 | `get_commands` 过滤 skill | `/skill:<name>` 格式 | 正常 | spec: skills |
| T25 | 读 Pi 能力描述 | 仅 `plan`/`bypassPermissions`，默认后者 | 正常 | spec: 权限 |
| T26 | 对 Pi 请求 MCP 写 | `ERR-PROVIDER-CAPABILITY-UNSUPPORTED` | 异常 | spec: 能力表达 |
| T27 | 未注册 provider id | `ERR-UNSUPPORTED-PROVIDER` | 异常 | spec: 注册 |
| T28 | probe 与 runtime flags 对比 | 两者均含 `--no-extensions`，一致 | 高风险 | design 规则 |

## 评分规则

每个样本二值判定：断言全部满足=通过，否则失败。逐样本记录（输入摘要、实际输出/错误码、判定、失败归因）必须留存于测试输出。总分 = 通过数 / 总数，但放行看**分维度**门槛而非总分。真实 Pi smoke 另行逐项签署。

## 验收规则与回归门槛

| 规则 | 门槛 | 适用范围 |
|---|---|---|
| 正常路径全通过 | 100% | T1,T6,T7,T10,T14,T22,T24,T25 |
| 异常路径 | 100% | 全部异常样本（错误码精确匹配） |
| 高风险全通过 | 100% | T5,T8,T20,T28 |
| 对抗 | 100% | T3,T4,T19 |
| 边界 | ≥ 90% | T15,T18,T21 等 |

## 上线门禁

- [ ] narrow 测试、`npm run build`、`npm run typecheck`、`npm run lint`、`npm test` 全绿。
- [ ] 所有异常样本错误码精确匹配（不得以空成功冒充）。
- [ ] 高风险样本（终态唯一性、绑定时序、pending reject、flags 一致）全通过。
- [ ] 真实 Pi smoke：新建 session 流式、第二轮 resume、abort、进程完成后立即读 history、sync 后 sidebar 用 app session id——逐项通过。
- [ ] 锁定的 Pi 版本号已确定并写入 `package.json`（精确版本），`agent_settled` 已实测存在。
- [ ] 现有 4 个 provider 冒烟不回归。

## 报告审核清单

| 审核项 | 必须确认 | 不通过情形 | 结论影响 |
|---|---|---|---|
| 场景覆盖 | 五个维度均覆盖 | 只跑正常路径 | 不得放行 |
| 样本结构 | fixture 为去敏真实数据，覆盖真实风险 | 用手造理想数据替代真实 RPC/JSONL | 报告不可信 |
| 评分规则 | 逐样本记录含错误码与归因 | 只有总分 | 结论不可审计 |
| 验收规则 | 各维度达门槛 | 高风险样本失败 | 不能判定通过 |
| 问题归因 | 每个失败归因到 spec/设计/编排/模型/数据 | 只写「模型问题」 | 无法闭环 |
| 回归结果 | 修复后重跑并附证据 | 只有修复说明 | 问题不得关闭 |
| 门禁结论 | 全部硬门禁满足 | 任一未达标 | 直接不放行 |

**结论：** 待执行 — 依上述门禁判定。

## E2E 验证配置（可选）

| 字段 | 值 |
|---|---|
| VisionE2E 项目 | （按需，前端 Pi provider 可视化） |
| 目标 URL | 本地 dev server |
| 用例来源 | 生成 |
| 生成策略 | smoke |
| 登录方式 | none |

### E2E 验收门槛

| 维度 | 通过率门槛 | 说明 |
|---|---|---|
| 正常路径 | ≥ 100% | Pi 选择 provider → 新建 session → 发送 → 流式显示 |
| 异常 | ≥ 80% | 未认证提示、切 provider 权限模式回退 |
