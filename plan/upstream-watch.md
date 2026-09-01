# Upstream watch — siteboon/claudecodeui

Last scanned: **2026-09-02**. Open PRs at scan time: **97**.

Purpose: none of our work is claimed upstream, but several of our files are
crowded. Re-run this before starting any item, and after any upstream merge.

## Re-running the scan

`gh`'s default repo in this checkout is set to the **fork**, so every command
needs an explicit `--repo`:

```bash
gh pr list --repo siteboon/claudecodeui --state open --limit 200 \
  --json number,title,author,createdAt,updatedAt,labels,isDraft

# strongest signal is which files a PR touches, not its title
gh pr view <n> --repo siteboon/claudecodeui --json title,body,files,additions,deletions

gh search prs --repo siteboon/claudecodeui --state open "background"
```

Watch these paths specifically:

```
server/modules/websocket/services/chat-run-registry.service.ts   # nobody, as of 2026-09-02
server/modules/providers/list/claude/claude-runtime.provider.js  # SIX open PRs
server/modules/providers/list/claude/claude-sessions.provider.ts
src/modules/chat/tools/configs/toolConfigs.ts
src/modules/chat/hooks/useSessionStore.ts
src/modules/chat/hooks/useChatMessages.ts
```

Layout trap when triaging: upstream migrated `src/components/**` →
`src/modules/**` around 2026-08-17. PRs older than that still target the dead
`src/components` paths and are stale against current upstream regardless of
content.

## Per-area verdict

| Our area | Upstream status |
|---|---|
| Run registry / eviction / background lifecycle (`01`) | **Unclaimed.** No open PR touches `chat-run-registry.service.ts` at all. |
| `Workflow` / `BashOutput` / `KillShell` tool configs (`04`) | **Unclaimed.** Every "workflow" search hit was `.github/workflows/*`. |
| Subagent grouping by `parentToolUseId` (`04`) | **Effectively unclaimed** — only #1158's alias rename. No PR mentions `parentToolUseId`. |
| `system` frames → `task_notification` (`03`) | **Effectively unclaimed** — only #1213, different record type. |
| Context-window default + percentage (done, `199e992`) | **Unclaimed.** #1125 declares the denominator explicitly out of scope. |
| Crash/robustness (`02`) | **Unclaimed.** `MAX_REALTIME_MESSAGES` returns *zero* search hits across all open PRs. Same for byte-capped buffers, `uncaughtException` handlers, notify coalescing, and the `formatToolResultContent` crash. |

## PRs worth reading

**#1213** — *normalize queue-operation remove records as user-role text*
(fedecia, +116/-0, updated 2026-08-25). Touches
`claude-sessions.provider.ts` + its test. **The closest thing to a direct hit in
the whole set.** It patches the same `normalizeMessage` for records it currently
drops — specifically task-notification payloads from background subagents that
complete mid-turn. But it is a *different record type* (`queue-operation` /
`remove`, not `system` SDK frames) and routes them as `kind: 'text', role:
'user'` rather than emitting the declared `task_notification` kind. → Decide
before starting `03` whether to adopt its record handling; we will conflict
with it otherwise.

**#1125** — *scope token-budget updates to the viewed session and stop
multi-call inflation* (thevinchi, +378/-69). Fixes the token **numerator**
(per-call vs aggregate, per-session scoping). Its own "Out of scope" section
says: *"`CONTEXT_WINDOW` defaults to 160,000. This fixes the numerator, not the
denominator."* → Confirms our `199e992` is complementary, not redundant. Client
files are on the old `src/stores` layout.

**#1233** — *Optionally keep one Claude process for a whole conversation*
(edgar965, +819/-23). New `claude-held-session.js` plus
`claude-runtime.provider.js`. Adjacent to `01`, but it *reuses* the existing
"a new turn supersedes any earlier held run" semantics rather than fixing them,
and says nothing about the registry, eviction, orphaned reports, or abort. →
Biggest merge-conflict risk for `01`.

**#1218** — *Log Claude run lifecycle transitions, and stop discarding the CLI's
stderr* (Wasabi81-code, +645/-3, "no behaviour change"). The one PR that engages
with the background-wait ceiling: it forwards the CLI's `Background tasks still
running after <N>s; terminating.` stderr line and adds a `run_end` record with
`reason: "superseded"`. → Would give `01` a log trail; fixes none of it.

**#1158** — *resolve the subagent tool under both Task and Agent* (mcgm51).
Adds a `Task`↔`Agent` alias map via a new `toolAliases.ts`. Stale paths
(`src/components`). Note current upstream `toolConfigs.ts` already has both
`Agent:` and `Task:` entries, so check whether this is still needed at all.

Nearby, low overlap: **#1239** (abort a busy run so a scheduled message can
send — normal active-run path only), **#1140** (per-session streaming buffers;
states Claude is unaffected), **#1167** and **#1102** (transcript perf, neither
touches message-cap slicing or notify batching), **#1192** (i18n across 77
files — textual conflict risk only).

## Conflict warning

`server/modules/providers/list/claude/claude-runtime.provider.js` is touched by
**six** open PRs: #1125, #1141 (tool-approval registry extraction, +608/-56),
#1143 (Oh My Pi provider, 76 files / +6214), #1160, #1218, #1233.

Practical consequence for `01`: **keep changes to that file as small as
possible and put the logic in `chat-run-registry.service.ts`**, which nobody is
touching. Merge order of #1143 alone will reshape any diff in the runtime
provider.
