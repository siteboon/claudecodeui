# Antigravity 集成修复计划 (Antigravity Integration Fix Plan)

本文档基于 2026-08-18 对 [`antigravity-integration-plan.md`](./antigravity-integration-plan.md) 已实施代码的审核结论，给出各项问题的修复方案。审核方式为代码走查 + 真机实测（`agy` 1.1.13：两轮 `-p --output-format stream-json` 对话、一轮带工具调用的对话、`agy models` 输出、`conversation_summaries.db` schema、三个真实 `transcript.jsonl` 结构分析）。

**已实测确认正确的部分不再列入修复范围**：stream-json 事件归一化（init / step_update / result 与实现完全吻合）、CLI 参数构造、模型列表解析、DB 同步器、注册链路、前端适配、15/15 单测与 tsc / eslint 全绿。

---

## 0. 问题总览

| 编号 | 严重度 | 问题 | 位置 |
| :--- | :--- | :--- | :--- |
| P0-1 | 高 | 权限模式端到端断链：runtime 读 `options.mode`，所有调用方传 `permissionMode`；且值大小写不匹配；`bypassPermissions` 未映射到 `--dangerously-skip-permissions` | `antigravity-runtime.provider.ts` |
| P0-2 | 高 | `fetchHistory` 与真实 transcript 结构不符：助手回复（`PLANNER_RESPONSE.content`）全部丢失；工具结果（`RUN_COMMAND` 等独立条目）全部丢失 | `antigravity-sessions.provider.ts` |
| P1-1 | 中 | abort 后通知语义错误：SIGTERM 导致 close code=null，被 `code ?? 0` 当作正常完成，发 `stopReason: 'completed'` | `antigravity-runtime.provider.ts` |
| P1-2 | 中 | 死代码：`getCurrentActiveModel` 空-if 块（白做一次 DB 查询）、`clearEnginePathCache` 无调用方 | `antigravity-models.provider.ts` / `antigravity-engine-path.ts` |
| P2-1 | 低 | init 事件 `session_created` 双发（runtime 内联 + normalizeMessage 各发一次；writer 会吞掉，无功能影响） | `antigravity-runtime.provider.ts` |
| P2-2 | 低 | 集成方案文档过时：skills 全局路径写的是 `~/.gemini/antigravity/skills`（实测不存在），实现用的 `~/.agents/skills` 才是 agy 实际读取的目录 | `docs/antigravity-integration-plan.md` |

---

## 1. P0-1 权限模式端到端断链

### 1.1 根因（三处叠加）

1. **字段名不符**：runtime 读取 `options.mode`（`antigravity-runtime.provider.ts:61`），但全部调用方传递的都是 `permissionMode`：
   - chat 链路：`chat-websocket.service.ts` 将 `clientOptions` 原样透传，前端 `useChatComposerState.ts:654` 发送 `permissionMode`；
   - headless 链路：`agent.routes.ts:994/1016/1027` 发送 `permissionMode: 'bypassPermissions'`；
   - 参照实现：`zcode-runtime.provider.ts:320` 读的正是 `options.permissionMode`。
2. **取值大小写不符**：runtime 的 allowlist 是 kebab-case `['accept-edits', 'plan']`（`antigravity-runtime.provider.ts:152`），前端 `PermissionMode` 类型是 camelCase `'acceptEdits'`（`src/components/chat/types/types.ts:10`），即使改对字段名也匹配不上。
3. **bypassPermissions 未映射**：`--dangerously-skip-permissions` 只由 `options.skipPermissions || options.toolsSettings?.skipPermissions` 触发（独立的工具设置开关），权限模式菜单选 `bypassPermissions` 不会生效。headless agent 路径因此拿不到 skip-permissions，非交互运行可能卡在权限请求上。

**后果**：权限模式菜单 4 个选项对 antigravity 全部无效，始终以 default 模式运行。

### 1.2 修复方案

改读 `options.permissionMode` 并建立显式映射（对齐 zcode 的 `PERMISSION_MODE_MAP` 模式，`zcode-runtime.provider.ts:42`）：

```ts
// antigravity-runtime.provider.ts 顶部
// CloudCLI permissionMode → agy CLI 参数。default 不加任何flag，
// 由 agy 自身默认行为兜底。
const PERMISSION_MODE_ARGS: Record<string, string[]> = {
  acceptEdits: ['--mode', 'accept-edits'],
  plan: ['--mode', 'plan'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};

// run() 内，替换现有 mode / skipPermissions 两段逻辑：
const permissionMode = readOptionalString(options.permissionMode);
if (permissionMode && PERMISSION_MODE_ARGS[permissionMode]) {
  args.push(...PERMISSION_MODE_ARGS[permissionMode]);
}
// 保留 toolsSettings.skipPermissions 作为额外语义（独立开关仍生效）：
if (skipPermissions && !args.includes('--dangerously-skip-permissions')) {
  args.push('--dangerously-skip-permissions');
}
```

同时删除 `const mode = readOptionalString(options.mode)` 及其 allowlist 分支。capabilities 已声明 4 种模式，无需改动。

### 1.3 验收标准

- 前端分别选择 `acceptEdits` / `plan` / `bypassPermissions` 发送消息，`agy` 子进程参数分别含 `--mode accept-edits` / `--mode plan` / `--dangerously-skip-permissions`；`default` 时三者均不出现。
- 单独开启工具设置的 skipPermissions 开关时，无论权限模式选什么，都带 `--dangerously-skip-permissions`。
- headless 路径（agent.routes）传 `permissionMode: 'bypassPermissions'` 时同样生效。

---

## 2. P0-2 `fetchHistory` 历史解析与真实结构不符

### 2.1 实测真实 transcript 结构（三个样本统计）

| 条目形态 | 实测数量（大样本） | 现实现的处置 | 应有处置 |
| :--- | :--- | :--- | :--- |
| `(type=USER_INPUT, source=USER_EXPLICIT)` 含 `<USER_REQUEST>` 包装 | 4 | ✅ 已正确清洗并输出 user 消息 | 保持 |
| `(type=PLANNER_RESPONSE, source=MODEL)` 含 `tool_calls: [{name, args}]` | 部分行 | ✅ 已输出 tool_use | 保持 |
| `(type=PLANNER_RESPONSE, source=MODEL)` 仅含 `content`（助手正文） | 119 行（vs GENERIC 仅 1 行） | ❌ 丢弃（只认 `type === 'GENERIC'`） | 输出 assistant text |
| `(type=RUN_COMMAND / VIEW_FILE / CODE_ACTION / LIST_DIRECTORY / GREP_SEARCH, source=MODEL)` 含 `content` / `status` / `exit_code`（工具结果） | 115 行 | ❌ 丢弃 | 挂接到最近的待配对 tool_use 作为 toolResult |
| `(type=GENERIC, source=MODEL)`（后台任务状态输出） | 1 行 | 挂接到上一个 tool_use | 并入工具结果统一规则（见下） |
| `(type=CHECKPOINT / SYSTEM_MESSAGE / CONVERSATION_HISTORY / ERROR_MESSAGE, source=SYSTEM)` | 若干 | ✅ 忽略 | 保持 |

**后果**：历史视图只能看到用户提问和工具调用卡片（无结果），几乎全部助手回复缺失。

### 2.2 修复方案（`antigravity-sessions.provider.ts` fetchHistory）

调整 `source === 'MODEL'` 分支的判定顺序：

1. `type === 'PLANNER_RESPONSE'`：
   - 有 `tool_calls` → 照旧生成 tool_use（`tool_${stepIndex}_${t}`）；
   - 无 `tool_calls` 且 `content` 非空 → 生成 `kind: 'text', role: 'assistant'` 消息（新增，解决 P0-2 主项）。
2. 其余 `source === 'MODEL'` 且 `content` 非空的条目（`RUN_COMMAND` 等工具结果 + `GENERIC` 后台任务输出）→ **顺序配对**挂接到最近一个尚无 `toolResult` 的 tool_use：
   - `toolResult = { content, isError: entry.status === 'ERROR' || (typeof entry.exit_code === 'number' && entry.exit_code !== 0) }`；
   - 若找不到待配对的 tool_use（如会话以工具结果开头），降级为 assistant text 输出，不丢弃内容；
   - 同一 `PLANNER_RESPONSE` 含多个 `tool_calls` 时，结果条目按出现顺序依次配对（transcript 中结果条目与调用顺序一致，实测样本验证）。
3. 删除现有 `type === 'GENERIC'` 专判（并入规则 2）与末尾 `filter(kind !== 'tool_result')`（修复后不再产生独立 tool_result 消息；如保留防御性过滤需加注释）。

现状的 `status: 'ERROR'` 判定依据：实测样本所有条目 `status` 均为 `DONE` 且无失败样例，错误态以 `status === 'ERROR'` 表达与 live 流的 `state: 'ERROR'` 对齐；`exit_code !== 0` 作为防御性补充。

### 2.3 验收标准

- 新增 fixture 单测（构造含 user / assistant text / tool_calls / RUN_COMMAND 结果 / CHECKPOINT 的 transcript），断言：assistant 正文出现、tool_use 的 `toolResult.content` 与 `isError` 正确、SYSTEM 条目不出现在结果中、分页 `sliceTailPage` 行为不变。
- 手动：打开一个终端 `agy` 产生过的真实会话，能看到助手回复与工具卡片结果。

---

## 3. P1-1 abort 通知语义

### 3.1 根因

`abort()` 对子进程发 SIGTERM 后，close 事件 `code` 为 `null`；`antigravity-runtime.provider.ts:272` 的 `notifyTerminalState({ code: code ?? 0 })` 把 null 折算成 0 → 走 `notifyRunStopped({ stopReason: 'completed' })`。参照 `claude-runtime.provider.js:693`：abort 应发 `stopReason: 'aborted'`。界面不受影响（chat run registry 会去重 complete），错的是系统通知语义。

### 3.2 修复方案

在 runtime 内维护 `abortedProcessKeys: Set<string>`（模块级，与 `activeProcesses` 并列）：

- `abort()` 成功 kill 前将 processKey 加入集合；
- close 回调中先 `const wasAborted = abortedProcessKeys.delete(processKey)`，`wasAborted` 时跳过 `notifyTerminalState` 的正常分支，改发 `notifyRunStopped({ stopReason: 'aborted' })`；
- 非 abort 导致的 signal 退出（如 OOM kill，code 同为 null）保持 failed 语义：将 `code === 0 && !error` 的判断改为 `code === 0 && !error && !wasAborted`，signal 死亡（code === null 且非 abort）计入 failed 分支，不再被 `?? 0` 吞掉。

### 3.3 验收标准

- 流式输出中点击「停止」：系统通知为「已停止」而非「已完成」；UI 会话状态恢复正常（现有行为不变）。
- 单测：用 stub 脚本 trap SIGTERM 不退出时 `abort` 返回 true（可选，视测试成本）。

---

## 4. P1-2 死代码清理（backend standards 合规）

1. `antigravity-models.provider.ts:221-235`：`getCurrentActiveModel` 中查询 `sessionsDb.getSessionById(sessionId)` 后是空 if 块（注释 "Check if there is a known model association"），既无功能又白做一次 DB 查询。**处理**：删除整个 `if (sessionId?.trim())` 块；若后续需要会话级模型记忆，走 `providerModelsService.setSessionModel` 已有链路（chat-websocket 已在写入，`resolveResumeModel` 会读），不在 models provider 里另起炉灶。
2. `antigravity-engine-path.ts:127-130`：`clearEnginePathCache` 标注 "primarily for tests" 但无任何调用方。**处理**：删除；若新增的 runtime 参数单测需要隔离缓存，届时再随测试一起加回（有真实消费者）。

---

## 5. P2 小项

### 5.1 init 双发 session_created

实测 init 事件同时含平铺 `conversation_id` 与嵌套 `init` 对象，runtime 内联分支（`antigravity-runtime.provider.ts:173-191`）与 `normalizeMessage` 的 init 分支会各发一次 `session_created`。writer 会吞掉该类消息（`chat-session-writer.service.ts:83`），无功能影响。**处理**：`processLine` 处理完 init 事件后直接 `return`，与 result 事件的处理方式对齐，消除重复路径。

### 5.2 集成方案文档回改（`antigravity-integration-plan.md`）

- §2 与 §4.1.6：全局技能目录由 `~/.gemini/antigravity/skills` 修正为 `~/.agents/skills`（实测前者不存在；实测 agy 能发现并执行 `~/.agents/skills` 下的 `/checkpoint` 技能；实现代码即按此生效，属文档过时而非代码缺陷）。**2026-09-01 修订**：经 agy 1.1.16 二进制内嵌字符串确认，agy 真正读取的全局技能目录是 `~/.gemini/config/skills`，`~/.agents/skills` 实为兼容源，代码已随本次修正。
- §4.1.6：补记 skills provider 实际列出三个源（workspace `.agents/skills`、全局 `~/.gemini/config/skills`、`~/.agents/skills` 兼容源），全局写入目标为 `~/.gemini/config/skills`。
- §6.2 验收清单：补一条「权限模式四档分别生效」的验收项；该清单此前无权限模式条目，而 P0-1 恰在此处断链，属验收覆盖缺口。

### 5.3 明确不改动项

- **skills 数据源与写入路径**：实现偏离 plan 但实测正确（见 5.2），改文档不改代码。
- **MCP project scope 的额外候选路径**（workspace 根 `mcp_config.json`、`.antigravity/mcp_config.json`）：超出 plan 但无害，保留。
- **`fetchModelsFromCli` 跳过 "Fetching" 前缀行**：实测 `agy models` 无此类输出，属多余防御，无害保留。
- **registry 深导入 `antigravity.provider.js` 而非 barrel**：与全部 sibling provider 一致的既有约定，不在本次修复范围。

---

## 6. 测试计划

| 测试 | 文件 | 内容 |
| :--- | :--- | :--- |
| 权限模式参数构造 | `server/modules/providers/tests/antigravity.test.ts`（或新增 `antigravity-runtime.test.ts`） | 利用 `CLOUDCLI_ANTIGRAVITY_PATH` 指向 stub 脚本（落盘收到的 argv），分别以 `permissionMode: acceptEdits / plan / bypassPermissions / default` + `toolsSettings.skipPermissions` 调 `runtime.run`，断言 argv 映射（参照 `opencode-runtime.provider.test.js` 的 argsCapturePath 手法） |
| 历史解析 | 同上 | fixture transcript（临时目录写入 `brain/<id>/.system_generated/logs/transcript.jsonl`，注意 `findTranscriptPath` 现为 homedir 绝对路径，需将路径解析抽出可注入或通过环境变量覆盖——若改动成本高，可将 `findTranscriptPath` 的根目录改为可被测试注入的参数，属本次修复允许的小重构） |
| abort 通知 | 可选 | stub 脚本长睡眠，`run` 后调 `abort`，断言收到 `stopReason: 'aborted'` 的通知（需 mock notifications 模块或通过 writer 断言 complete 语义） |
| 回归 | 现有 | `antigravity.test.ts` / `mcp.test.ts` / `provider-runtime.service.test.ts` 保持全绿 |

## 7. 验证清单

> 实施状态（2026-08-18）：P0-1 / P0-2 / P1-1 / P1-2 / P2-1 / P2-2 已全部实施；自动化项全绿（43/43 测试、tsc 0 错误、eslint 0 告警、`npm run build` 通过）。手动项待 UI 回归。

- [x] `npx tsc --noEmit -p server/tsconfig.json` 0 错误
- [x] `npx eslint server/modules/providers/list/antigravity/**/*.ts` 0 错误 0 告警
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/antigravity.test.ts server/modules/providers/tests/antigravity-runtime.test.ts server/modules/providers/tests/mcp.test.ts server/modules/providers/tests/provider-runtime.service.test.ts` 全绿（新增 `antigravity-runtime.test.ts`：permissionMode 映射 / skipPermissions 去重 / 流式归一化 / abort 静默解析；`antigravity.test.ts` 新增 fetchHistory fixture 与空会话用例）
- [x] `npm run build` 成功
- [ ] 手动：权限模式四档参数生效（P0-1；映射逻辑已由 stub 单测覆盖，待 UI 手动回归）
- [ ] 手动：真实历史会话可见助手回复与工具结果（P0-2；fixture 单测已覆盖，待真实会话回归）
- [ ] 手动：停止运行后通知为「已停止」（P1-1）
- [x] 文档：integration plan §2 / §4.1.6 / §6.2 已回改（P2-2）

## 8. 实施顺序与规模预估

1. P0-1（runtime 一个映射表 + 参数构造，约 20 行）
2. P0-2（sessions fetchHistory 分支重排，约 40 行 + fixture 测试）
3. P1-1（abort 通知，约 15 行）
4. P1-2 / P2-1（删死代码 + init return，约 -25 行）
5. P2-2（纯文档）

全部为局部改动，不涉及接口签名与数据结构变更，可一次提交或按上述顺序分两到三次提交（P0 一次，P1/P2 一次）。
