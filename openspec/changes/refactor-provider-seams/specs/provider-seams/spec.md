## Purpose

定义 provider 公共接缝重构后对外可见的行为契约：能力表达与 facet 存在性一致、未注册 provider 与不支持能力的错误码区分、跨 provider 的 native session 身份隔离、单个 provider 同步失败的隔离，以及一次 run 的单一终态所有权。仅登记对外可观测的行为变化，纯内部实现手段（typed runtime、generic dispatcher、前端 state 收敛）不进入本 spec。

## ADDED Requirements

### Requirement: 能力表达与 facet 存在性一致

The system SHALL 使 provider 的能力描述从其 facet 的存在性派生：`supportsMcp`、`supportsSkills`、`supportsTokenUsage` 分别等于对应 optional facet 是否存在。

The system SHALL NOT 同时维护 facet 与第二份手写的 `supportsX` 真相；能力描述与 facet 存在性不一致时以 facet 为准。

#### Scenario: 具备 facet 的能力为真
- **WHEN** 一个 provider 提供了 usage facet
- **THEN** 其能力描述中 `supportsTokenUsage` 为 `true`

#### Scenario: 缺失 facet 的能力为假
- **WHEN** 一个 provider 未提供 mcp facet
- **THEN** 其能力描述中 `supportsMcp` 为 `false`

### Requirement: 未注册 provider 与不支持能力的错误码区分

The system SHALL 对"未注册的 provider"返回 `ERR-UNSUPPORTED-PROVIDER`，对"已注册但缺少某 facet"返回 `ERR-PROVIDER-CAPABILITY-UNSUPPORTED`，二者为不同的稳定错误。

The system SHALL NOT 用空成功结果把"不支持"伪装成"支持但无数据"。

#### Scenario: 未注册 provider
- **WHEN** 调用方以一个未注册的 provider id 请求任意 facet
- **THEN** 系统以 `ERR-UNSUPPORTED-PROVIDER` 拒绝

#### Scenario: 已注册但 facet 不支持
- **WHEN** 调用方对一个已注册 provider 请求其未提供的 facet
- **THEN** 系统以 `ERR-PROVIDER-CAPABILITY-UNSUPPORTED` 拒绝，而非返回空成功

#### Scenario: 注册时 descriptor 非法
- **WHEN** 注册一个默认权限模式不在其权限模式列表中的 provider
- **THEN** 系统在注册阶段以 `ERR-PROVIDER-DESCRIPTOR-INVALID` 拒绝，不进入可用集合

### Requirement: 跨 provider native session 身份隔离

The system SHALL 以 `(provider, provider_session_id)` 作为 native session 的唯一标识；所有 native session 的查找与合并 SHALL 携带 provider。

The system SHALL NOT 因两个不同 provider 拥有相同 native session id 字符串而将它们合并为同一行。

#### Scenario: 相同 native id 不同 provider 不合并
- **WHEN** provider A 与 provider B 各有一个 native session id 相同的 session
- **THEN** 系统将其视为两个不同 session，不合并

#### Scenario: 同 provider 重复 native id
- **WHEN** 同一 provider 出现重复的 native session id
- **THEN** 系统按唯一约束拒绝或确定性合并为同一 app session

#### Scenario: app id 与 native id 同值
- **WHEN** 某 session 的 app id 与 native id 字符串相同
- **THEN** 系统仍显式完成 mapping，不因字符串相同而跳过 DB 绑定

### Requirement: per-provider 同步失败隔离

The system SHALL 为每个 provider 维护独立的扫描游标，各 provider 在自身同步成功后独立推进其游标。

The system SHALL NOT 因某一个 provider 同步失败而阻止其他 provider 推进各自的游标。

#### Scenario: 单 provider 失败不影响他人游标
- **WHEN** 某个 provider 的同步失败
- **THEN** 其他 provider 的游标仍各自独立推进，仅失败 provider 的游标不推进

#### Scenario: 失败 provider 下轮重试
- **WHEN** 失败的 provider 在下一轮扫描恢复
- **THEN** 系统从其自身游标位置继续，不重扫其他 provider

### Requirement: 单一终态所有权

The system SHALL 使 application 层的 coordinator 成为一次 run 终态（complete/aborted/failed）的唯一生产者；provider runtime 只产生非终态事件并返回 outcome。

The system SHALL NOT 允许 provider runtime、进程退出或 gateway 各自独立产生终态；一次 run 对外 SHALL 恰好观察到一个终态。

#### Scenario: 正常完成只有一个终态
- **WHEN** 一次 run 正常结束
- **THEN** 对外恰好观察到一个成功终态

#### Scenario: abort 与迟到事件竞争
- **WHEN** abort 与 provider 迟到的 native 事件竞争
- **THEN** 对外仍恰好观察到一个终态（aborted）

#### Scenario: runtime 抛错或进程关闭
- **WHEN** provider runtime 抛错或进程异常关闭
- **THEN** coordinator 产生恰好一个失败终态
