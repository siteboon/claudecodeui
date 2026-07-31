# pi Agent 接入方案

将 [earendil-works/pi](https://github.com/earendil-works/pi) 作为第 5 个 provider 接入本项目（现有：claude / codex / cursor / opencode）。

## 决策（已确认）

- **取舍 1 — 权限模式：方案 A。** `plan` → `--tools read,grep,find,ls`（只读工具集）；其余三态全工具开。代价：`acceptEdits` 与 `bypassPermissions` 在 pi 下行为相同，`default` 无「逐条确认」能力（语义降级）。
- **取舍 2 — 模型目录：方案 A。** 运行时读 `~/.pi/agent/models.json` 动态生成，覆盖 pi 挂载的全部 LLM。
- **取舍 3 — session id：方案 A。** 用 `--session-id <appSessionId>` 直接以 app 自身 session id 建/续 pi 会话，绕开 provider id 映射往返。

## 第一性原理

provider 抽象把「一个 AI CLI」拆成 7 个正交 facet（`IProvider`）。接入 = 为 7 个 facet 各写一个 pi 实现，再在 3 处 union + runner wiring 登记。opencode 是最新范本，pi 照抄结构。

## 已核实事实（方案据此成立）

- pi 本地已装：`/opt/homebrew/bin/pi`。
- headless：`pi -p --mode json`，输出 **NDJSON** 事件流（逐行 JSON）。
- 事件类型：`session` / `agent_start` / `turn_start` / `message_start` / `message_update`(含 `assistantMessageEvent`：`thinking_start|text_start|text_end` 等 delta) / `message_end` / `turn_end`(含 `usage`) / `agent_end` / `agent_settled`。
- 会话续接：`--session-id <id>`（不存在即创建）/ `--continue` / `--resume` / `--fork` / `--session-dir`。
- effort：`--thinking off|minimal|low|medium|high|xhigh|max`，与 UI effort 直接对应。
- 模型：`--provider <name> --model <pat>`；目录来源 `~/.pi/agent/models.json`（`providers.<name>.models[]`，字段含 `id/name/reasoning/contextWindow/maxTokens`）。
- 会话磁盘格式：`~/.pi/agent/sessions/<cwd-slug>/<ts>_<uuid>.jsonl`，每行一个事件，`type:"message"` 行含 `message.role/content[]`、assistant 行含 `usage`。
- config 目录：`PI_CODING_AGENT_DIR`（默认 `~/.pi/agent`）；session 目录：`PI_CODING_AGENT_SESSION_DIR` 或 `--session-dir`。
- 落差：无内置权限系统（仅工具白/黑名单）；MCP 非标准（走 extensions 机制）。

## 落差与对策

| 契约 | pi 对应 | 对策 |
|---|---|---|
| 权限模式 | 无权限系统，仅工具开关 | 取舍 1A：plan=只读工具集，其余全开 |
| MCP | 非标准（extensions） | `pi-mcp` 空实现，返回空列表、写操作报不支持 |
| 模型目录 | 多 LLM 前端 | 取舍 2A：读 models.json 动态生成 |

## 实现清单

### 新增 `server/modules/providers/list/pi/`（照 opencode 结构）

- `pi.provider.ts` — 组装 7 facet，`super('pi')`（~30 行）。
- `pi-runtime.provider.js` — **核心**。spawn `pi -p --mode json --session-id <appSessionId> --session-dir <项目slug> [--provider/--model/--thinking/--tools]`，用 cross-spawn；按行解析 NDJSON：
  - `message_update.assistantMessageEvent` 的 thinking/text delta → `writer.send` stream delta；
  - `turn_end.usage` → token 用量；
  - `agent_end` / 进程退出 → complete；进程失败 → `notifyRunFailed`，abort → `notifyRunStopped`。
  - 维护 `activePiProcesses: Map<sessionId, ChildProcess>`，`abort` 发 SIGTERM。
  - 权限：由 `options.permissionMode` 经 `resolvePiPermissionOptions()` 映射为 `--tools` 参数（取舍 1A）。
  - 导出 `{ run, abort }` 作为 `piRuntime`。（对标 opencode ~350 行）
- `pi-sessions.provider.ts` — `normalizeMessage(raw, sessionId)`（NDJSON 事件 → `NormalizedMessage[]`）+ `fetchHistory(sessionId, opts)`（读对应 `.jsonl`，projectPath→cwd-slug 定位目录）。
- `pi-session-synchronizer.provider.ts` — `synchronize(since)` 扫描 `~/.pi/agent/sessions/**/*.jsonl` upsert 入库；`synchronizeFile(path)` 单文件增量。
- `pi-models.provider.ts` — 读 `models.json`，`getSupportedModels()` 生成目录（含 `--thinking` 档位作为 effort），`getCurrentActiveModel()` 读会话首行 `model_change` 事件，缺省回落目录默认。
- `pi-auth.provider.ts` — `getStatus()`：`pi` 在 PATH（`which pi` / claude-cli-path 同款探测）+ `~/.pi/agent/auth.json` 或 provider apiKey 存在 → `{ installed, authenticated }`，不抛异常。
- `pi-skills.provider.ts` — 读/写 `~/.pi/agent/skills`（照 opencode skills，~78 行）。
- `pi-mcp.provider.ts` — 空实现：`listServers`→`[]`，`upsert/remove`→抛「pi 不支持 MCP」。

### 权限映射函数（写在 pi-runtime，导出供测试）

```
plan              → { args: ['--tools', 'read,grep,find,ls'] }
acceptEdits       → { args: [] }   // 全工具开
bypassPermissions → { args: [] }   // 同上（语义降级，取舍 1A）
default           → { args: [] }
```

### 登记（后端，各约 1 行）

- `server/shared/types.ts:69` — `LLMProvider` union 加 `'pi'`。
- `server/modules/providers/provider.registry.ts` — import `PiProvider` + `pi: new PiProvider()`。
- `server/index.ts` — `const queryPi = providerRuntimeService.getRunner('pi');` 并传入 `createAgentModule({ ..., queryPi })`。
- `createAgentModule` 签名（`server/modules/agent/agent.module.ts`）增加 `queryPi` 形参并接线。
- 确认 sessions-watcher（`services/sessions-watcher.service.ts`）监听 `~/.pi/agent/sessions`。

### 前端（各约 1 行 + 1 图标）

- `src/types/app.ts:1` — `LLMProvider` union 加 `'pi'`。
- `src/components/settings/constants/constants.ts:42` — `AGENT_PROVIDERS` 加 `'pi'`。
- 新增 `src/components/llm-logo-provider/PiLogo.tsx`，并在 `SessionProviderLogo.tsx` 映射 `pi → PiLogo`。
- 权限降级提示：在权限模式选择处，当 provider==='pi' 时对 `default` 加提示「pi 无逐条确认，等同自动放行」，`acceptEdits`/`bypassPermissions` 说明行为一致（可选，UI 打磨项）。

## 工作量

核心风险与工时集中在 `pi-runtime`（NDJSON 归一化 + 权限映射）、`pi-sessions`、`pi-session-synchronizer`、`pi-models` 四个文件（对标 opencode 约 1200 行）；其余为模板与登记。

## 验证

1. `pi-auth` 未装/未登录返回正确状态，不抛异常。
2. headless 一问一答：NDJSON delta 正确流式到前端。
3. `--session-id` 续接：第二轮命中同一会话文件。
4. `plan` 模式下 pi 无法写文件（只读工具集生效）。
5. synchronizer 扫描后 DB 出现 pi 历史会话，可在 UI 打开。
6. `abort` 能杀掉进程并发 stopped 通知。
7. `npm run typecheck` + `npm run lint` + `npm test` 通过。

## 未决 / 后续

- pi extensions ↔ 本项目 MCP/skills 的更深映射（本期空实现）。
- 多 LLM provider 的 apiKey 管理是否纳入 provider-auth UI（本期仅探测存在性）。
