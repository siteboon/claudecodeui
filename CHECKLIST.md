# 会话右侧信息面板 — 实施验收 CHECKLIST

> 每完成一项打 `[x]`；一个提交全部勾完才允许进入下一提交。
> 原则：**能用 CLI/SDK 现成能力就优先从 CLI 取**（`Query.getContextUsage()`、
> `Query.mcpServerStatus()` 等），CLI 给不了的才自己派生；跨 CLI 的数据读取
> 抽象成 provider 接口（仿 `McpProvider`/`SkillsProvider` 基类 + 各 CLI 实现），
> 前端不写 provider 分支判断，能力位走 `provider-capabilities.service.ts`。

## 架构约定（贯穿所有提交）

- [x] 新增抽象：子代理/上下文读取走 **`IProviderSessions` 与 `IProviderRuntime` 的可选方法**
      （`listSubagents`、`fetchSubagentHistory`、`contextInfo?`，仿既有可选 `rewindSession`），
      仅 Claude 实现；未实现的 CLI 由服务层降级为空数组/`null`，无需每个 CLI 建占位类。
      （比另立 `SessionInsightsProvider` 基类更贴合现有接口的可选方法惯例，前端不感知 provider。）
- [x] `ProviderCapabilities` 增加 `supportsSessionInsights: boolean`
      （claude=true，codex/opencode 一期 false，cursor=false）。
- [x] MCP 列表/技能列表**复用已有** provider 实现（`claude-mcp.provider.ts`、
      `claude-skills.provider.ts`），不另造读取路径。
      （MCP 节与来源节共用同一份 `useSessionMcpServers` 数据，来源节零额外请求；
      技能走既有 skills 端点。）
- [x] 运行中的会话：上下文节优先用 SDK `Query.getContextUsage({ detail: 'summary' })` 的
      `percentage/totalTokens/maxTokens`；拿不到运行实例时回退 `tokenBudget` 帧推算。
- [x] 全部新 UI 文案进 `src/modules/i18n/locales/{en,zh-CN}/chat.json` 的 `sessionInfoPanel.*`。

## Commit 1 — 轮次统计管道（服务器）

- [x] `claude-runtime.provider.js`：`result` 帧分支（:975 附近）在 `complete` 前转发
      `kind:'status', text:'turn_stats'`，携带 `turnStats:{ costUsd, durationMs, apiDurationMs, numTurns, usage }`。
- [x] abort 路径照常发帧（状态帧非终帧，多一条无害；complete 的防重策略不变）。
- [x] `server/shared/types.ts`：`NormalizedMessage` 增 `turnStats?: TurnStats`，导出 `TurnStats`。
- [x] 测试 `server/modules/providers/tests/claude-turn-stats.test.ts`（提取函数纯函数测试）。
      验收：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-turn-stats.test.ts` 绿。

## Commit 2 — 轮次统计（前端）+ 偏好骨架

- [x] `src/shared/types.ts` 镜像 `TurnStats`。
- [x] `useChatRealtimeHandlers.ts`：`case 'status'` 增 `turn_stats` 分支，按 `sid===activeViewSessionId` 作用域。
- [x] `useChatSessionState.ts`：新增 `turnStats` state，会话切换/新建处随 tokenBudget 一并 reset。
- [x] `src/modules/chat/utils/sessionTurnStats.ts` 纯函数：七指标口径
      （回答速度/整个请求速度/模型耗时/工具耗时/步骤/Token↑↓/缓存命中率/费用；缺帧降级 `—`；
      本轮=最后一条 user text 之后）。
- [x] `src/shared/sessionInfoPanelPrefs.ts` + `userSettings.ts` 增 `sessionInfoPanel` 槽
      （open + collapsedSections；读取器规范化掉 false 值）。
- [x] 测试：`sessionTurnStats.test.ts`(7)、`turnStatsSessionScope.test.tsx`(2)、
      `sessionInfoPanelPrefs.test.ts`(4)；`npm run typecheck` 前后端全绿。此步 UI 尚不可见。

## Commit 3 — 面板壳 + 上下文节 + 轮次统计节

- [x] `src/modules/chat/panel/`：`SessionInfoPanel.tsx`、`InfoSection.tsx`、
      `ContextRingSection.tsx`、`TurnStatsSection.tsx`。
- [x] 挂载：`ChatInterface.tsx` 内层 relative 行容器，右栏 `w-72`；`isMobile` 走抽屉+遮罩。
- [x] `WorkspaceHeader.tsx` 开关按钮（PanelRightOpen/Close），默认 open=false。
- [x] 上下文节：运行中优先 CLI `getContextUsage`（REST `GET /sessions/:id/context-info`
      → runtime `contextInfo?()`，仅 Claude 实现），回退 tokenBudget；点击开既有 token 明细 modal。
- [x] 测试 `sessionInfoPanelRender.test.tsx`（六节壳、折叠卸载、窄屏分支）。
- 验收：手动开面板可见上下文环+轮次统计且随流刷新；测试绿。

## Commit 4 — 任务节

- [x] `src/modules/chat/utils/sessionTaskList.ts`：重放 `TodoWrite` 快照与
      live `TaskCreate/TaskUpdate` 增量（移植 `message-unification.ts` ChecklistState 逻辑，互指注释）。
- [x] `TasksSection.tsx`：n/m + CircleDashed/Loader/CircleCheck 图标，in_progress 显示 activeForm。
- [x] 排除 `subagent` 行与 `parentToolUseId` 非空行。
- [x] 测试 `sessionTaskListReplay.test.ts`（与 message-unification.test.ts 同口径）。
- 验收：跑一轮带任务的会话，面板计数与 `TaskList` 实际一致。

## Commit 5 — 子代理节 + 端点 + 对话浮层

- [x] 服务器：`ClaudeSessionsProvider.listSubagents` / `fetchSubagentHistory`
      （直读 `<projectDir>/<providerSessionId>/subagents/` 与旧平铺布局；`.meta.json`
      补读 `toolUseId/spawnDepth`；roster 流式统计，>500KB 只数结构；状态三态合成：
      父 task-notification→completed/failed，无通知∧父在跑∧mtime<120s→running）。
- [x] `IProviderSessions` 可选方法挂接；`sessions.service.ts` 透传
      （`parentRunning` 取 chat-run-registry；不进 sessionHistoryCache）；
      `provider.routes.ts` 两条 GET（仿 :845 messages 路由）。
- [x] codex/opencode/cursor 不实现 = 接口可选方法缺省，服务层降级空数组/空页（无需占位文件）。
- [x] 前端 `api.ts` 两方法（`sessionSubagents`/`sessionSubagentMessages` + `subagentMessagesUrl`）；
      `sessionSubagents.ts` 提取（按 `parentToolUseId===toolUseId` 过滤+剥离+去重）+ 续聊提示词打包。
- [x] `SubagentsSection.tsx`（描述 (@agentType)+状态）+ `SubagentChatModal.tsx`
      （REST 历史分页 + 父 slot 实时合流；「交流」= createSession+草稿预填+导航开新会话）。
- [x] 测试：`claude-subagents-roster.test.ts`（6，临时目录造 jsonl/.meta.json，含 tool_result
      折叠/分页/旧布局/三态）、`sessionSubagentsExtraction.test.ts`（7）。
- 验收：面板列出子代理、点开见完整对话、交流能开新会话；服务器测试绿。✅（服务器 6/6、前端 279 全绿）

## Commit 6 — MCP 节（含开关）

- [x] `settings.service.ts`/`settings.routes.ts`：`mcpDisabledServers` GET/PUT。
      （落在既有 `user_preferences` 键值表的 `mcpDisabledServers` 键上而非新表——
      值就是一个名字数组，键值 merge-patch 形态正好合用，免一次建表迁移；
      且前端经偏好镜像零额外读取即可见，跨设备同步白拿。）
- [x] `claude-runtime.provider.js`：`loadMcpConfig` 出口过 `applyMcpDisabledFilter(servers, disabledSet)`
      （按 name 全局禁用，导出为纯函数；userId 由 queryClaudeSDK 的 `ws?.userId` 下传，
      读库失败降级为"全不禁用"，不阻断会话）。
- [x] `ProviderCapabilities.supportsMcpToggle`（claude=true，其余 false），
      面板开关按能力位启停，不写 provider 分支。
- [x] 面板 MCP 行开关：乐观更新+失败回滚（回滚走偏好镜像，其他读取方同步复原）；
      提示「开关对新会话生效」。
- [x] 列表数据走既有 `GET /api/providers/:provider/mcp/servers`，不另造
      （scopes/扁平两种响应形状统一过 `flattenMcpServers` 按 name 去重排序）。
- [x] 测试 `claude-mcp-disabled-filter.test.ts`（过滤纯函数 9 例，含仓储读写与脏数据降级）、
      `settings.service.test.ts` 往返 1 例、`mcpServersSection.test.tsx` 7 例。
- 验收：关掉一个 MCP 后新会话不再注入该服务器；测试绿。
      ✅（路由 GET/PUT 往返 + 偏好镜像可见 + 列表端点形状，10091 真实验证通过）

## Commit 7 — 上下文来源节 + i18n + 打磨

- [x] `ContextSourcesSection.tsx`：技能 n（既有 skills 端点）、MCP 服务器 n（MCP 节共用 state）。
      （取数与开关解耦：`useSessionMcpServers` 拆 `enabled`（面板打开即取列表）与
      `canToggle`（能力位才允许开关）；非 claude provider 列表只读展示，
      footer 换成 `mcpReadOnlyHint`。技能走既有 `GET /api/providers/:provider/skills`。）
- [x] `chat.json` 双语补全全部 `sessionInfoPanel.*`（新增 `sourcesSkills`/`sourcesMcp`/
      `mcpReadOnlyHint`，双语同入；面板测试里的双语键集深比较自动兜底缺 key）。
- [x] 全量测试跑通：面板相关全绿（`sessionInfoPanelRender` 7 例、`mcpServersSection` 8 例、
      `contextSourcesSection` 2 例、服务器 MCP 禁用集 12 例）；前端其余 450 例全过。
      （仓库预存失败与本提交无关：干净工作区复跑 `claude-auth` 同样 7 例失败、
      `projects.db.integration` 1 例失败；`transcriptScrollOwnership` 3 例失败源自并行
      transcript 改动的未完成引用，非面板文件。）
- 验收：六节齐全、双语无缺 key、无控制台报错。
      ✅（六节全部渲染有测试断言；双语键集一致有测试断言；面板数据路径全有 catch 降级）

## 暂缓项（不进本期）

- 拖拽调宽、面板内二次排序/搜索。
- codex/opencode 的子代理真实实现（接口位已留）。
- 缓存命中率的颜色分级打磨。
