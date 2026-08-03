# Provider 公共接缝重构 测试定义

依据 `specs/provider-seams/spec.md`。本 change 是重构，最大风险是**回归**（改动 5 个 provider 的公共接缝）与**不可逆数据迁移**（唯一约束合并）。因此测试分两类：锁定既有行为的 characterization tests，与验证新契约的 spec tests。

## 测试目标与边界

**范围内：**
- 重构前后现有 4 个 provider 的 observable 行为一致（live event、resume、abort、history、usage、replay）。
- 新契约：能力与 facet 一致、unknown vs unsupported 错误码、native 身份隔离、per-provider 游标、单一终态。
- 唯一约束迁移：重复行合并的正确性与 provider-qualified 隔离。

**范围外：**
- Pi 的功能行为（由 `add-pi-provider` 覆盖）；本 change 只验证 Pi 迁入新接缝后 observable 不变。
- provider 上游 CLI 行为。

## 覆盖策略

| 维度 | 是否覆盖 | 样本数 | 说明 |
|---|---|---|---|
| 正常路径 | 是 | 6 | 五能力契约正常场景 + 4 provider 各自 characterization 冒烟 |
| 异常 | 是 | 5 | unknown provider、unsupported facet、descriptor 非法、runtime 抛错终态、同步单点失败 |
| 边界 | 是 | 4 | app id=native id 同值、相同 native id 跨 provider、部分索引空 native、失败 provider 下轮恢复 |
| 对抗 | 是 | 3 | abort 与迟到 native event 竞争、迁移遇真实重复行、runtime 试图发 complete 被拦 |
| 高风险 | 是 | 4 | 唯一约束迁移合并正确性、终态唯一性、providers→WS 反向依赖移除、4 provider 零回归 |

## 评测集

| 编号 | 输入 | 预期 | 维度 | 来源 |
|---|---|---|---|---|
| R1 | provider 有 usage facet / 无 mcp facet | `supportsTokenUsage=true` / `supportsMcp=false` | 正常 | spec: 能力一致 |
| R2 | 未注册 provider id 请求 facet | `ERR-UNSUPPORTED-PROVIDER` | 异常 | spec: 错误码区分 |
| R3 | 已注册 provider 请求缺失 facet | `ERR-PROVIDER-CAPABILITY-UNSUPPORTED` | 异常 | spec: 错误码区分 |
| R4 | 默认权限模式不在列表的 descriptor | 注册期 `ERR-PROVIDER-DESCRIPTOR-INVALID` | 异常 | spec: 错误码区分 |
| R5 | provider A、B 相同 native id | 视为两个 session，不合并 | 边界/高风险 | spec: 身份隔离 |
| R6 | 同 provider 重复 native id | 唯一约束拒绝或确定性合并 | 异常 | spec: 身份隔离 |
| R7 | app id 与 native id 同值 | 仍完成 DB mapping | 边界 | spec: 身份隔离 |
| R8 | 一个 provider 同步失败 | 其他 provider 游标独立推进 | 异常 | spec: 同步隔离 |
| R9 | 失败 provider 下轮恢复 | 从自身游标续扫，不重扫他人 | 边界 | spec: 同步隔离 |
| R10 | 一次 run 正常结束 | 恰好一个成功终态 | 正常 | spec: 单一终态 |
| R11 | abort 与迟到 native event 竞争 | 恰好一个 aborted 终态 | 对抗 | spec: 单一终态 |
| R12 | runtime 抛错/进程异常关闭 | coordinator 产生恰好一个失败终态 | 异常 | spec: 单一终态 |
| R13 | legacy runtime 试图发 `complete` | 被 adapter/类型拦截，不产生第二终态 | 对抗 | spec: 单一终态 |
| R14 | 真实库存在跨 provider 重复 native id，执行迁移 | provider-qualified 合并，不跨 provider 误并 | 高风险 | design: 迁移 |
| R15 | claude/codex/cursor/opencode 各自 characterization 冒烟 | 重构前后 observable 一致 | 正常/高风险 | design: 兼容性 |
| R16 | providers 模块静态依赖扫描 | 无 providers→WebSocket import | 高风险 | design: 依赖单向 |

## 评分规则

二值判定，断言全满足=通过。characterization tests（R15）以重构前录制的 golden 输出为基准逐条比对。逐样本记录含实际错误码/终态数量/依赖扫描结果与失败归因，留存于测试输出。放行看分维度门槛。

## 验收规则与回归门槛

| 规则 | 门槛 | 适用范围 |
|---|---|---|
| 4 provider 零回归 | 100% | R15（characterization 全绿） |
| 高风险全通过 | 100% | R5、R14、R16 及终态唯一性 R11 |
| 契约异常全通过 | 100% | R2、R3、R4、R6、R12（错误码精确匹配） |
| 单一终态 | 100% | R10、R11、R12、R13 |
| 边界 | ≥ 90% | R7、R9 等 |

## 上线门禁

- [ ] characterization tests 在**重构前**先建立并通过（golden 基准存在），否则不得开始替换。
- [ ] `npm run build`、`npm run typecheck`、`npm run lint`、`npm test` 全绿。
- [ ] 唯一约束迁移前已对真实库查询确认重复行情况（E12），合并在单事务内完成且可回滚。
- [ ] 一次 run 恰好一个终态（R10–R13 全通过）。
- [ ] providers 模块无对 WebSocket 的反向 import（R16）。
- [ ] 4 个现有 provider + Pi 的端到端冒烟不回归。
- [ ] `@ts-nocheck` 在本 change 范围内的目标文件已移除且 typecheck 通过。

## 报告审核清单

| 审核项 | 必须确认 | 不通过情形 | 结论影响 |
|---|---|---|---|
| 场景覆盖 | 五维均覆盖 | 只跑契约正常路径，缺 characterization | 不得放行 |
| 样本结构 | characterization 基于重构前真实录制 | 用重构后代码反推 golden | 报告不可信 |
| 评分规则 | 逐样本记录含错误码/终态计数/归因 | 只有总分 | 结论不可审计 |
| 验收规则 | 各维度达门槛 | 高风险或零回归未满足 | 不能判定通过 |
| 迁移证据 | 真实库重复行查询与合并结果留证 | 直接建索引未查重 | 直接不放行 |
| 问题归因 | 每个失败归因到 spec/设计/编排/数据 | 只写「重构副作用」 | 无法闭环 |
| 回归结果 | 修复后重跑并附证据 | 只有修复说明 | 问题不得关闭 |
| 门禁结论 | 全部硬门禁满足 | 任一未达标 | 直接不放行 |

**结论：** 待执行 — 依上述门禁判定。zero-regression 与迁移查重为一票否决项。
