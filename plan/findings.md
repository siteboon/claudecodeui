# Verified findings

Every row was checked against the working tree at `99ea052` + our five commits
on 2026-09-02. Line numbers are from that state — re-check them after any
upstream merge, since several of these files are actively changing upstream
(`upstream-watch.md`).

Where a claim is a **negative** ("nothing does X"), the grep that established it
is recorded, because those are the ones that silently stop being true.

## Fixed on this branch

| ID | What | Where | Commit |
|---|---|---|---|
| F1 | `JSON.stringify(undefined)` returns `undefined`, so a `tool_result` with no `content` threw on `.trim()`. Thrown inside a `useMemo` under the `ErrorBoundary`, so it replaced the chat pane — and since store state survived, the reset button re-threw. Session permanently unopenable. | `useChatMessages.ts:9` (+ call sites `:128`, `:268`, `:374`) | `32c7bd8` |
| F2 | `notify()` ticked React on every realtime event with no coalescing; each tick rebuilt the whole transcript including `JSON.stringify` of every tool input. | `useSessionStore.ts:563-580` | `453da96` |
| F3 | Context window defaulted to 160000 (Claude models are 200k), inflating every percentage ~25%. | `claude-runtime.provider.js:434`, `:528`; `cli.service.ts` | `199e992` |
| F4 | `TokenUsageSummary` rendered `used` but never `total`, so the indicator read as session length. Backend ships `total` on the same object (`buildTokenBudget`, `claude-runtime.provider.js:427`). | `TokenUsageSummary.tsx` | `199e992` |
| F5 | `handleChatAbort` required `run.status === 'running'`, but a run holding stdin open for background work already reports `completed` — so stop returned `NO_ACTIVE_RUN` while the process and its MCP servers stayed alive. | `chat-websocket.service.ts` `handleChatAbort` | `c6a12c5` |
| F6 | `BashOutput`, `KillShell`, `Workflow` had no `TOOL_CONFIGS` entries, falling through to `Default` — an anonymous "Parameters" card with a raw JSON dump, collapsing into "Parameters ×7" on repeated polls. | `toolConfigs.ts:213`, `:239`, `:260` | `c6a12c5` |

## Open — background tasks

| ID | What | Where |
|---|---|---|
| **O1** | **The two timers disagree.** The registry evicts a completed run after 5 min; the provider holds the process open for up to 30 min. That is a **25-minute window where the process is alive but the registry entry is gone.** | `COMPLETED_RUN_RETENTION_MS = 5 * 60 * 1000` at `chat-run-registry.service.ts:43` vs `BG_WAIT_CEILING_MS = 30 * 60 * 1000` at `claude-runtime.provider.js:71` |
| O2 | `complete` is emitted as soon as `result` arrives, even with `backgroundWorkPending` set — which is what starts the 5-min eviction clock. | `claude-runtime.provider.js:972` sets the flag; `evictRunLater` called at `chat-run-registry.service.ts:107` |
| O3 | After eviction, `runs.get(sessionId)` is `undefined`: `chat.subscribe` reports `isProcessing: false` and re-attach fails. After a page refresh the still-live stream writes to a dead socket and every frame is dropped at the `readyState` check. | `chat-session-writer.service.ts:168` |
| O4 | No second `complete`: `decorateAndRecordEvent` returns `null` for a `complete` when `run.status === 'completed'`. Since `requestLatestMessages` only runs off the complete/subscribe paths, **the transcript is never reconciled against disk after background work finishes.** | `chat-run-registry.service.ts:89` |
| O5 | The hold timer is re-armed on every message, so it measures *silence*, not elapsed time — a chatty background stream extends it indefinitely. | `scheduleRelease` at `claude-runtime.provider.js:741` |
| O6 | No background-task UI of any kind. Grep of `src/` for `run_in_background\|BashOutput\|backgroundTask` hits only our own `toolConfigs.ts` and a test. No ledger, no live-shell list, no indicator. | — |
| O7 | The entire display for background work completing is a 1.5px dot plus one line of `text-xs` grey text. | `MessageComponent.tsx:164` |

What already works: `notifyBackgroundWorkCompleted` fires a push notification
with code `run.background_completed`
(`notification-orchestrator.service.js:272`), and `startsBackgroundWork`
(`claude-runtime.provider.js:555`) correctly detects `Bash` with
`run_in_background: true`. So you *are* told the work finished — the UI just
never shows what it did.

## Open — survivability

| ID | What | Where |
|---|---|---|
| **O8** | **No process-level crash guards.** Grep for `uncaughtException`, `unhandledRejection`, `--max-old-space-size` across `server/`, `package.json`, `scripts/`, `docker/`: **zero hits.** Heap exhaustion takes down the process and every session on it. | — |
| O9 | `MAX_REALTIME_MESSAGES = 500` applied as `slice(-500)` drops `tool_use` rows while their later `tool_result` rows survive. Orphaned results then hit `if (msg.toolId) break;` and are silently discarded — **tool calls visibly evaporate mid-run.** | `useSessionStore.ts:547`, `:776-777`; the discard at `useChatMessages.ts:370` |
| O10 | Event buffer capped by **count, not bytes** (`MAX_BUFFERED_EVENTS_PER_RUN = 5000`), retaining full `toolInput`/`content`. `Workflow` inputs are entire scripts. | `chat-run-registry.service.ts:51`, `:112` |
| O11 | Silent replay gap. The client sends `lastSeq` on subscribe (`ChatInterface.tsx:271`) and tracks it (`useChatRealtimeHandlers.ts:105-107`), but never compares it against the server's ack to detect that the buffer truncated past its position. | `useChatRealtimeHandlers.ts:126` |

## Open — task lifecycle events

| ID | What | Where |
|---|---|---|
| O12 | Claude's `normalizeMessage` has **no `system` branch**. Branches exist only for `content_block_delta` (`:683`), `content_block_stop` (`:686`), `thinking` (`:879`), `tool_use` (`:891`), `tool_result` (`:905`), then it falls through. Everything the SDK sends as `system` is discarded before reaching the websocket. | `claude-sessions.provider.ts` |
| O13 | `task_notification` is declared in `server/shared/types.ts:193` and has a client renderer, and the **Codex** provider emits it (`codex-sessions.provider.ts:1891`) — **Claude never does.** Today it is regex-scraped out of message *text*, which breaks whenever the injected format changes. | `parseTaskNotification` at `useChatMessages.ts:51` |
| O14 | `includePartialMessages` is never set anywhere in the repo (**zero hits**), so the SDK emits no partial frames and streaming deltas are dead for Claude regardless of the `stream_event` unwrap bug. | — |

## Open — agents and workflows

| ID | What | Where |
|---|---|---|
| O15 | Subagent folding is **single-level and flat**: every row sharing a `parentToolUseId` lands in one undifferentiated activity array. A `Workflow` running dozens of agents collapses into one list with no per-agent separation. | `useChatMessages.ts:100-135` |
| O16 | `MAX_TRANSMITTED_SUBAGENT_ACTIVITIES = 200` truncates long agents' timelines. | `claude-sessions.provider.ts:35` |
| O17 | The `Workflow` card renders the script into a collapsible and nothing else — no phases, no agent tree, no progress. | `toolConfigs.ts:260` |

### Stale handover claims — do NOT re-fix

`#1206` (`99ea052`) landed a real subagent model. Two backlog items from the
original handover are now **wrong**:

- *"No nesting model"* — false. History enrichment builds `subagentsById`
  (`claude-sessions.provider.ts:439`) into `msg.subagent` + `msg.subagentTools`,
  and live folding by `parentToolUseId` exists at `useChatMessages.ts:100`.
  `isSubagentContainer` (`:262`) checks `Boolean(msg.subagent)` first and only
  falls back to a name match.
- *"History reader doesn't know the `subagents/` subdirectory"* — false, it is
  handled at `claude-sessions.provider.ts:202`.

Agent **display** is also in better shape than the handover implies:
`SubagentPanel.tsx` is a 242-line collapsible panel with real
running/completed/failed status (`STATUS_STYLES:64`, derived at `:123`). It is
the right building block to extend for the `Workflow` tree — do not start fresh.

## Open — performance

| ID | What | Where |
|---|---|---|
| O18 | `fetchHistory` reads and parses the entire session JSONL *plus every* `agent-*.jsonl`, normalizes all of it, then slices ~20 rows — on **every paginated request**. No caching: grep for `mtime\|cache` in the provider returns **zero hits**. `Workflow` transcripts are dominated by `tool_result` rows, so the skew is worst exactly there. | `claude-sessions.provider.ts` |
