# CloudCLI — agents, background tasks and workflows

Working plan for making this fork properly support the three things it is
currently weakest at: **subagents**, **background tasks**, and the **`Workflow`
tool**.

Fork context: `origin` is `pirvu/claudecodeui`; upstream is
`siteboon/claudecodeui`. Everything here stays on fork branches — see
`upstream-watch.md` before starting any item, because upstream is active and
some of these files are crowded.

## Files

| File | What it is |
|---|---|
| `findings.md` | Verified defect inventory. Every claim carries a `file:line`. The monitoring surface — re-verify against this after any upstream merge. |
| `upstream-watch.md` | Open upstream PRs that touch our areas, and the commands to re-run the scan. |
| `01-background-lifecycle.md` | Run registry vs. held process. The one that makes background tasks actually work. |
| `02-survivability.md` | Stop a big `Workflow` run from taking down the whole host. |
| `03-task-notifications.md` | `system` SDK frames → the declared `task_notification` kind. |
| `04-agents-and-workflow-ui.md` | Per-agent grouping and the `Workflow` container UI. |
| `05-history-performance.md` | `fetchHistory` re-parsing everything on every page. |

## Status legend

- **DONE** — on the branch, tested.
- **OPEN** — verified, not started.
- **BLOCKED** — waiting on another item.

## Dependency order

```
01 background lifecycle ──┬─→ 03 task notifications ──→ 04 agents + workflow UI
                          │
02 survivability ─────────┘        05 history perf (independent)
```

`02` is independent of `01` and can go first if stability is the priority — it
is the only item where the failure mode is "the whole process dies and takes
every other session with it".

## Already on this branch

Five commits, all verified (`npm run typecheck`, `npm test` 394/0,
`npm run test:client` 376/0, `npm run build`):

| Commit | What |
|---|---|
| `32c7bd8` | `tool_result` with no content no longer unmounts the chat pane |
| `453da96` | store re-renders coalesced to one `requestAnimationFrame` |
| `199e992` | context-window default 160k→200k, `TokenUsageSummary` shows `used/total` + % |
| `c6a12c5` | held (background) runs are killable; `BashOutput`/`KillShell`/`Workflow` tool cards |
| `8f3f670` | regression test for `tool_result` with no content |

These stop things crashing and make them legible. They do **not** add support —
that is what the numbered items are for.

## Deployment reminder

Nothing here is live. The running CloudCLI is the **global npm package**
`@cloudcli-ai/cloudcli` under pm2 app `cloudcli` (port 40000, config
`~/.cloudcli/ecosystem.config.js`) — not this checkout. `pm2 restart cloudcli`
kills whatever Claude session is talking through it, so cutover is always
user-triggered.

Two cutover gotchas, both verified:

- The checkout's `main` runs ahead of the published npm version, so a cutover
  ships more than our commits.
- The in-app Update button reverts local changes either way: `installMode` is
  inferred from whether `.git` exists at the app root
  (`server/index.ts:63`), so a checkout deploy makes Update run
  `git checkout main && git pull`, and a global install makes it run
  `npm install -g @cloudcli-ai/cloudcli@latest`.
