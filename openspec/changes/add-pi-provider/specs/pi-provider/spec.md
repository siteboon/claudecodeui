## Purpose

把 Pi coding agent 作为一个完整 provider 接入本工程，使其与现有 4 个 provider 一样，通过统一的 provider 契约提供 live chat、模型目录、安装/认证状态、session 历史与磁盘同步、skills 发现与权限模式，并在不支持的能力上以明确的「不支持」而非空成功来表达。

## ADDED Requirements

### Requirement: Pi provider 注册与能力表达

The system SHALL 将 `pi` 作为受支持的 provider 注册，使其可被 provider registry 解析，并向前端暴露其能力描述（权限模式、是否支持 effort、token usage、MCP、skills、abort、images、files）。

The system SHALL NOT 把「不支持某能力」表达为空成功结果；对 Pi 不支持的能力，调用方 SHALL 收到明确的不支持错误或能力描述中的 `false`。

#### Scenario: 解析 Pi provider
- **WHEN** 调用方以 `pi` 请求 provider registry
- **THEN** 系统返回 Pi provider 实例及其能力描述

#### Scenario: 未注册 provider
- **WHEN** 调用方以一个未注册的 provider id 请求
- **THEN** 系统以 `ERR-UNSUPPORTED-PROVIDER` 拒绝，且不产生任何副作用

#### Scenario: 已知 provider 但能力不支持
- **WHEN** 调用方对 Pi 请求其不支持的 MCP 能力
- **THEN** 系统以 `ERR-PROVIDER-CAPABILITY-UNSUPPORTED` 拒绝，而不是返回空的成功结果

### Requirement: Pi live chat runtime

The system SHALL 通过 Pi 官方 RPC 模式（`pi --mode rpc`）执行一次对话运行，将 Pi 的非终态事件（文本、思考、工具开始/结束、状态、错误）转换为应用归一化事件流式输出，并以 Pi 的 `agent_settled` 事件作为该次运行成功完成的唯一权威终态。

The system SHALL NOT 把 `agent_end`、`turn_end` 或进程 exit code 0 单独当作成功终态；在 `agent_settled` 之前发生的进程关闭 SHALL 产生失败结果。

#### Scenario: 正常流式对话
- **WHEN** 用户在一个 Pi session 发送 prompt
- **THEN** 系统流式返回归一化的文本与思考事件，并在收到 `agent_settled` 后产生一次成功完成

#### Scenario: 进程在 settle 前关闭
- **WHEN** Pi 进程在发出 `agent_settled` 之前退出
- **THEN** 系统以 `ERR-PI-RUN-FAILED` 产生失败完成，且不谎报成功

#### Scenario: 已知事件携带非法 payload
- **WHEN** Pi 发来一个已知类型但 payload 非法的事件
- **THEN** 系统以 `ERR-PI-RPC-PROTOCOL` 产生失败，而不是把它当作成功数据

#### Scenario: 未知事件
- **WHEN** Pi 发来一个未知类型的事件
- **THEN** 系统记录调试信息后忽略该事件，不影响本次运行

### Requirement: app/native session 身份绑定

The system SHALL 在 Pi runtime 产生第一条 live 事件之前，用 `get_state` 返回的精确 session id 与 session 文件完成 app session 与 provider-native session 的绑定并持久化。

The system SHALL NOT 依赖时间启发式（如「最近一个 pending session」）来推断 Pi 的 native session；Pi 已能提供确定性 session id。

#### Scenario: 首轮建立绑定
- **WHEN** 一个新 Pi session 首次运行并成功获得 `get_state`
- **THEN** 系统在第一条 live 事件之前持久化 app/native session 映射

#### Scenario: 第二轮复用同一 app session
- **WHEN** 用户在同一 app session 发起第二轮对话
- **THEN** 系统复用已持久化的映射，不创建重复 native 绑定

### Requirement: Pi 运行中止

The system SHALL 支持针对当前运行的中止：向 Pi RPC 发出中止指令，在有上限的优雅关闭窗口内等待 `agent_settled`，超时后终止该运行的进程，并产生一次「已中止」完成。

The system SHALL NOT 让中止误伤同一 session 的其他运行；进程归属 SHALL 按运行标识管理，而非仅按 session id。

#### Scenario: 正常中止
- **WHEN** 用户中止一个正在流式输出的 Pi 运行
- **THEN** 系统停止该运行并产生一次「已中止」完成

#### Scenario: 优雅窗口超时
- **WHEN** Pi 在优雅关闭窗口内未响应中止
- **THEN** 系统强制终止该运行的进程并仍产生一次「已中止」完成

### Requirement: Pi 模型目录

The system SHALL 通过 Pi RPC `get_available_models` 提供模型目录，默认模型取自 `get_state`，仅对具备推理能力的模型暴露 thinking effort，并使用 `<upstream-provider>/<model-id>` 作为 canonical 模型值。

#### Scenario: 列出模型
- **WHEN** 前端请求 Pi 的模型目录
- **THEN** 系统返回 canonical 格式的可用模型列表与默认模型

#### Scenario: Pi 未认证时取模型
- **WHEN** 在 Pi 未认证的情况下请求模型目录
- **THEN** 系统以 `ERR-PI-NOT-AUTHENTICATED` 表达，而不是返回空目录冒充成功

### Requirement: Pi 安装与认证状态

The system SHALL 报告 Pi 的安装状态（配置的 Pi 可执行文件能否成功执行 `--version`）与认证状态（用与 runtime 相同配置启动 RPC probe 并成功获得至少一个当前可用模型）。

The system SHALL NOT 为「未安装」或「未认证」这类正常状态抛出异常；这些属于正常返回值，仅协议损坏、spawn 权限错误等异常与之区分。

#### Scenario: 已安装且已认证
- **WHEN** 查询 Pi 状态且可执行文件可用、probe 返回至少一个模型
- **THEN** 系统报告已安装且已认证

#### Scenario: 未安装
- **WHEN** 配置的 Pi 可执行文件无法执行 `--version`
- **THEN** 系统报告未安装，且不抛异常

#### Scenario: 已安装但未认证
- **WHEN** Pi 可执行但 probe 无法获得任何可用模型
- **THEN** 系统报告已安装但未认证，且不抛异常

### Requirement: Pi session 历史读取

The system SHALL 从 Pi 的 session JSONL 文件解析历史：按行解析、只转换 active branch、并将其转换为归一化 message；系统对文件末尾的半行（并发写入）SHALL 忽略而非报错。

The system SHALL NOT 静默误读不支持的未来 session 版本，也 SHALL NOT 因中间行损坏而返回部分错误数据。

#### Scenario: 读取有效历史
- **WHEN** 请求一个有效 Pi session 的历史
- **THEN** 系统返回 active branch 上的归一化 message 序列

#### Scenario: 尾部半行
- **WHEN** session 文件末尾存在一个未写完的半行
- **THEN** 系统忽略该半行并正常返回其余历史

#### Scenario: 中间行损坏
- **WHEN** session 文件中间存在损坏行
- **THEN** 系统以 `ERR-PI-SESSION-CORRUPT` 报错并包含行号，不返回部分数据

#### Scenario: 不支持的 session 版本
- **WHEN** session 文件头声明一个不受支持的版本
- **THEN** 系统以 `ERR-PI-SESSION-VERSION-UNSUPPORTED` 报错，而不是按旧格式误读

### Requirement: Pi session 磁盘同步

The system SHALL 扫描 Pi 的 session 根目录，将发现的 session metadata（provider=`pi`、native session id、项目路径、artifact 路径、当前模型、创建/更新时间）upsert 到数据库；各 provider 的同步 SHALL 独立执行，Pi 同步失败不中断其他 provider 在同一次扫描中的 upsert。

#### Scenario: 同步发现新 session
- **WHEN** Pi session 根目录出现一个新 session 文件
- **THEN** 系统 upsert 其 metadata，且下游以 app session id 呈现

#### Scenario: Pi 同步失败不中断其他 provider
- **WHEN** Pi 同步过程抛错
- **THEN** 系统仍完成其他 provider 在本次扫描中发现的 session upsert，仅记录 Pi 失败

### Requirement: Pi skills 发现

The system SHALL 通过 Pi RPC `get_commands` 并过滤 `source === 'skill'` 发现 skills，且以 `/skill:<name>` 作为其调用格式展示。

#### Scenario: 列出 Pi skills
- **WHEN** 请求 Pi 的 skills 列表
- **THEN** 系统返回过滤后的 skill，并以 `/skill:<name>` 格式呈现调用语法

### Requirement: Pi 权限模式

The system SHALL 仅为 Pi 暴露两个行为不同的权限模式：`plan`（只读工具子集）与 `bypassPermissions`（Pi 默认完整工具集），默认 `bypassPermissions`，并声明不支持逐工具确认请求。

The system SHALL NOT 为 Pi 暴露 `default`/`acceptEdits` 等在 Pi 上行为无差异的模式，也 SHALL NOT 把工具 allowlist 描述为操作系统级安全隔离。

#### Scenario: 暴露 Pi 权限模式
- **WHEN** 前端读取 Pi 的能力描述
- **THEN** 系统仅返回 `plan` 与 `bypassPermissions` 两个模式，默认 `bypassPermissions`

#### Scenario: 切换到 Pi 时权限模式不兼容
- **WHEN** 用户从其他 provider 切到 Pi，而当前模式不在 Pi 的模式列表中
- **THEN** 前端回退到 Pi 的默认模式

### Requirement: Pi token usage

The system SHALL 从 Pi session 快照中取 active branch 上最后一个满足「无 error 停止原因、未中止、usage 字段完整」的 assistant usage 作为该 session 的 token usage。

The system SHALL NOT 在 Pi 缺少可用 usage 时回退到其他 provider 的默认统计口径。

#### Scenario: 读取 Pi usage
- **WHEN** 请求一个含有效 usage 的 Pi session 的 token usage
- **THEN** 系统返回 active branch 上最后一个有效 assistant usage

#### Scenario: 无有效 usage
- **WHEN** Pi session 不存在满足条件的 usage
- **THEN** 系统返回「无 usage」而非套用其他 provider 的默认值
