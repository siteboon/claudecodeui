# Pi Provider 实现任务

「构建什么」见 `specs/pi-provider/spec.md`，「怎么构建」见 `design.md`。design 的两个待明确问题（Pi 版本号、`plan` 模式 `--tools` 工具名）不改变 spec 与模块边界，在任务 1.1 / 3.x 中以实测确定。

## 0. 文件归属

| 任务组 | 独占文件/目录 | 禁止改动 | 共享文件处理 |
|---|---|---|---|
| 1 | `package.json`、`server/shared/types.ts` | `server/modules/providers/**` | 无 |
| 2 | `server/modules/providers/list/pi/pi-paths.provider.ts`、`pi-rpc-client.provider.ts`、`pi-session-store.provider.ts` 及其测试 | 中央 service、其他 provider | 无 |
| 3 | `server/modules/providers/list/pi/`（除任务组 2 的三个文件外的全部 facet 与 `pi.provider.ts`、`index.ts`）及其测试 | 中央 service、任务组 2 文件 | 依赖任务组 2 产物，串行在其后 |
| 4 | `provider.registry.ts`、`provider-capabilities.service.ts`、`provider-token-usage.service.ts`、`sessions-watcher.service.ts`、`agent/agent.routes.ts` | `list/pi/`、前端 | 依赖任务组 3，串行在其后 |
| 5 | `src/`（前端 provider/model/brand state 与 picker 组件） | backend | 无 |
| 6 | 无（只运行验证命令） | 全部 | 只读 |

- [x] 任意两个任务组的「独占文件」无交集。
- [x] 共享文件已指定串行顺序（3 依赖 2，4 依赖 3）。

## 1. 前置：版本锁定与类型

- [ ] 1.1 确定并锁定 Pi 稳定版本：核实包含 RPC 模式与 `agent_settled` 的稳定发布版本号，在 `package.json` 以**精确版本**（无 `^`/`~`）添加 `@earendil-works/pi-coding-agent`，`npm install` 后确认可 import 官方 rpc-client。
- [ ] 1.2 在 `server/shared/types.ts` 的 `LLMProvider` 联合中加入 `'pi'`，运行 typecheck 定位所有因新增成员而需要补分支的中央位置（作为任务组 4 的清单）。

## 2. Pi 基础模块

- [ ] 2.1 实现 `PiPaths`：解析 `PI_CLI_PATH`、`PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、`settings.json.sessionDir`、默认 `<agentDir>/sessions`，暴露 `getSessionRoots()`；所有路径 resolve/normalize。补单测覆盖各配置来源。
- [ ] 2.2 实现 `PiRpcClient`：薄封装官方 rpc-client，spawn `pi --mode rpc --no-extensions`，提供请求/响应关联、事件分发、stderr 收集、process close 时 reject 全部 pending、graceful close。补单测：单 chunk 多行、一行跨多 chunk、尾部无换行、畸形 JSON、stderr 不污染 parser、unexpected close reject pending（对应 T18/T19/T20）。
- [ ] 2.3 实现 `PiSessionStore.load()` 返回不可变 `PiSessionSnapshot`：JSONL 按行解析、尾部半行忽略、中间损坏报 `ERR-PI-SESSION-CORRUPT`（含行号）、不支持版本报 `ERR-PI-SESSION-VERSION-UNSUPPORTED`、active branch 回溯（检测 cycle/重复 id/丢失 parent）、compaction/branch summary、最后 `model_change`、最后有效 usage。补单测覆盖 T14–T17、T21、T22、T23。

## 3. Pi facets 与装配

- [ ] 3.1 实现 `pi-runtime.provider.ts`（TypeScript）：状态机 `SPAWNING→REQUESTING_STATE→BINDING_SESSION→PROMPTING→STREAMING→SETTLED`；在首条 live 事件前完成 session 绑定；事件映射为 pure function（text_delta/thinking_delta/tool_execution_*/turn_end/retry→status）；`agent_settled` 为唯一成功终态，之前 close 返回 `ERR-PI-RUN-FAILED`；已知事件非法 payload 返回 `ERR-PI-RPC-PROTOCOL`，未知事件忽略。补单测 T1–T5、T8、T28（用真实 RPC fixture）。
- [ ] 3.2 实现 abort：`request.signal` 触发写 `{type:'abort'}`，有上限优雅窗口后强杀，进程按 runId 归属，返回「已中止」outcome。补单测 T7、T9，并验证 abort 与 late event 竞争仅一个终态（T8）。
- [ ] 3.3 实现 `pi-models.provider.ts`：`get_available_models` + `get_state.model` 默认 + 仅 reasoning 模型暴露 effort + canonical `<provider>/<model>`；未认证返回 `ERR-PI-NOT-AUTHENTICATED`。补单测 T10、T11。
- [ ] 3.4 实现 `pi-auth.provider.ts`：安装=`--version` 成功；认证=RPC probe（同 runtime flags，含 `--no-extensions`）获得≥1 模型；未安装/未认证为正常返回不抛异常。补单测 T12、T13，并断言 probe 与 runtime flags 一致（T28）。
- [ ] 3.5 实现 `pi-sessions.provider.ts`：消费 `PiSessionStore` 快照，`normalizeMessage`/`fetchHistory`，稳定 message id `<entry.id>:<contentIndex>`，沿用现有 `sliceTailPage` 分页。补单测 T14、T15、T21。
- [ ] 3.6 实现 `pi-session-synchronizer.provider.ts`：从 `PiPaths.getSessionRoots()` 扫描，快照 upsert（provider=`pi`、native id、cwd、artifact、模型、时间）。补单测：发现新 session、Pi 抛错不中断其他 provider upsert。
- [ ] 3.7 实现 `pi-token-usage`（经快照）与 `pi-skills.provider.ts`（`get_commands` 过滤 `source==='skill'`，`/skill:<name>`，写 root=`agentDir/skills`，复用现有名称/路径校验）。补单测 T22、T23、T24 及路径穿越拒绝。
- [ ] 3.8 实现 `pi-mcp.provider.ts`（unsupported adapter）：读返回分组空结构，写抛 `ERR-PROVIDER-CAPABILITY-UNSUPPORTED`。补单测 T26。
- [ ] 3.9 组装 `pi.provider.ts`（继承 `AbstractProvider`，注入全部 facet）与 `index.ts`，仅导出注册所需公共定义。

## 4. 中央注册（沿用现有模式，逐点接入）

- [ ] 4.1 `provider.registry.ts`：`providers` Record 加入 `pi: new PiProvider()`；补测未注册 provider 返回 `ERR-UNSUPPORTED-PROVIDER`（T27）、`pi` 可解析。
- [ ] 4.2 `provider-capabilities.service.ts`：新增 `pi` 条目——`permissionModes:['plan','bypassPermissions']`、`defaultPermissionMode:'bypassPermissions'`、`supportsPermissionRequests:false`、`supportsMcp:false`、`supportsEffort`（按 reasoning 模型）、images/files/abort/tokenUsage 据实。补测能力描述与 facet 存在性一致（T25）。
- [ ] 4.3 `provider-token-usage.service.ts`：新增 `pi` 分支，走 Pi usage facet，命中前不落 `.claude` 默认。
- [ ] 4.4 `sessions-watcher.service.ts`：`PROVIDER_WATCH_PATHS` 加入 Pi 的 `getSessionRoots()`。
- [ ] 4.5 `agent/agent.routes.ts`：注入 `queryPi` 并加入 provider 分支（沿用现有 `if/else` 结构，不消除 `@ts-nocheck`）。

## 5. 前端

- [ ] 5.1 新增 `pi` provider type、brand metadata 与 logo。
- [ ] 5.2 model state 加入 Pi（沿用现有每-provider state 模式，不重构为 Record）；model picker 展示 canonical Pi 模型，仅 reasoning 模型展示 effort。
- [ ] 5.3 permission picker 对 Pi 仅展示 `plan`/`bypassPermissions`；切到 Pi 时若当前 mode 不兼容则回退默认；MCP 页面不显示 Pi 为可配置 provider；skills 展示 `/skill:<name>`。

## 6. 验证

- [ ] 6.1 运行窄测试：`node --import tsx --test` 覆盖任务组 2/3/4 的新测试文件，全绿。
- [ ] 6.2 运行 `npm run build`、`npm run typecheck`、`npm run lint`、`npm test`，全绿。
- [ ] 6.3 真实 Pi smoke：RPC 安装/模型 probe、新建 session 流式 text/thinking、tool start/end、第二轮 resume、abort、进程完成后立即读 history、filesystem sync 后 sidebar 用 app session id——逐项通过。
- [ ] 6.4 回归确认现有 4 个 provider 冒烟不受影响。
