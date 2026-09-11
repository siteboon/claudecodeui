# 会话右侧信息面板 — 实施验收 CHECKLIST

> 每完成一项打 `[x]`；一个提交全部勾完才允许进入下一提交。
> 原则：**能用 CLI/SDK 现成能力就优先从 CLI 取**（`Query.getContextUsage()`、
> `Query.mcpServerStatus()` 等），CLI 给不了的才自己派生；跨 CLI 的数据读取
> 抽象成 provider 接口（仿 `McpProvider`/`SkillsProvider` 基类 + 各 CLI 实现），
> 前端不写 provider 分支判断，能力位走 `provider-capabilities.service.ts`。

## 架构约定（贯穿所有提交）

- [ ] 新增抽象：`server/modules/providers/shared/session-insights/session-insights.provider.ts`
      定义 `SessionInsightsProvider` 基类（方法：`listSubagents`、`fetchSubagentHistory`、
      `getContextSnapshot`），各 CLI 目录各建一个实现文件；无能力的 CLI 返回空数组/`AppError`。
- [ ] `ProviderCapabilities` 增加 `supportsSessionInsights: boolean`
      （claude=true，codex/opencode 一期 false，cursor=false）。
- [ ] MCP 列表/技能列表**复用已有** provider 实现（`claude-mcp.provider.ts`、
      `claude-skills.provider.ts`），不另造读取路径。
- [ ] 运行中的会话：上下文节优先用 SDK `Query.getContextUsage({ detail: 'summary' })` 的
      `percentage/totalTokens/maxTokens`；拿不到运行实例时回退 `tokenBudget` 帧推算。
- [ ] 全部新 UI 文案进 `src/modules/i18n/locales/{en,zh-CN}/chat.json` 的 `sessionInfoPanel.*`。

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

- [ ] `src/modules/chat/panel/`：`SessionInfoPanel.tsx`、`InfoSection.tsx`、
      `ContextRingSection.tsx`、`TurnStatsSection.tsx`。
- [ ] 挂载：`ChatInterface.tsx` 内层 relative 行容器，右栏 `w-72`；`isMobile` 走抽屉+遮罩。
- [ ] `WorkspaceHeader.tsx` 开关按钮（PanelRightOpen/Close），默认 open=false。
- [ ] 上下文节：运行中优先 CLI `getContextUsage`（服务器把调用透传成 REST 或由 runtime 缓存），
      回退 tokenBudget；点击开既有 token 明细 modal。
- [ ] 测试 `sessionInfoPanelRender.test.tsx`（六节壳、折叠卸载、窄屏分支）。
- 验收：手动开面板可见上下文环+轮次统计且随流刷新；测试绿。

## Commit 4 — 任务节

- [ ] `src/modules/chat/utils/sessionTaskList.ts`：重放 `TodoWrite` 快照与
      live `TaskCreate/TaskUpdate` 增量（移植 `message-unification.ts` ChecklistState 逻辑，互指注释）。
- [ ] `TasksSection.tsx`：n/m + Target/Clock/CircleCheck 图标，in_progress 显示 activeForm。
- [ ] 排除 `subagent` 行与 `parentToolUseId` 非空行。
- [ ] 测试 `sessionTaskListReplay.test.ts`（与 message-unification.test.ts 同口径）。
- 验收：跑一轮带任务的会话，面板计数与 `TaskList` 实际一致。

## Commit 5 — 子代理节 + 端点 + 对话浮层

- [ ] 服务器：`SessionInsightsProvider` 基类 + `ClaudeSessionInsightsProvider`
      （listSubagents / fetchSubagentHistory，补读 `.meta.json` 的 `toolUseId/spawnDepth`）。
- [ ] `provider.registry.ts`/`claude.provider.ts` 挂接；`sessions.service.ts` 透传；
      `provider.routes.ts` 两条 GET（仿 :836 messages 路由）。
- [ ] codex/opencode/cursor 各建占位实现（空数组/unsupported）。
- [ ] 前端 `api.ts` 两方法；`sessionSubagents.ts` 提取+`parentToolUseId` 分组。
- [ ] `SubagentsSection.tsx`（描述 (@agentType)+状态）+ `SubagentChatModal.tsx`
      （REST 历史 + slot 剥离 parentToolUseId 实时；「交流」= createSession+chat.send 开新会话）。
- [ ] 测试：`claude-subagents-endpoint.test.ts`（临时目录造 jsonl/.meta.json）、
      `sessionSubagentsExtraction.test.ts`。
- 验收：面板列出子代理、点开见完整对话、交流能开新会话；服务器测试绿。

## Commit 6 — MCP 节（含开关）

- [ ] `settings.service.ts`/`settings.routes.ts`：`mcpDisabledServers` GET/PUT（auth.db JSON blob，仿 notification-preferences）。
- [ ] `claude-runtime.provider.js`：`loadMcpConfig` 出口过 `applyMcpDisabledFilter(servers, disabledSet)`（按 name 全局禁用）。
- [ ] 面板 MCP 行开关：乐观更新+失败回滚；提示「切换对新会话生效」。
- [ ] 列表数据走既有 `GET /api/providers/:provider/mcp/servers`（CLI provider 实现），不另造。
- [ ] 测试 `claude-mcp-disabled-filter.test.ts`。
- 验收：关掉一个 MCP 后新会话不再注入该服务器；测试绿。

## Commit 7 — 上下文来源节 + i18n + 打磨

- [ ] `ContextSourcesSection.tsx`：技能 n（既有 skills 端点）、MCP 服务器 n（MCP 节共用 state）。
- [ ] `chat.json` 双语补全全部 `sessionInfoPanel.*`。
- [ ] 全量测试跑通：`npm run test`（或项目既有测试脚本）。
- 验收：六节齐全、双语无缺 key、无控制台报错。

## 暂缓项（不进本期）

- 拖拽调宽、面板内二次排序/搜索。
- codex/opencode 的子代理真实实现（接口位已留）。
- 缓存命中率的颜色分级打磨。
