# 08 — Background work ownership

**Status:** OPEN · **Depends on:** nothing · **Unblocks:** `plan/local/T21`, `plan/local/T22`
**Findings:** measured 2026-09-17/19 · **Upstream:** unclaimed

Design, not a patch. `01` treats the registry's half of this as a timer
disagreement; this is the question underneath it — **what owns a piece of
background work, and for how long.**

## The defect

Background work has no record of its own. Its lifetime is *derived* from a
process's lifetime, which is derived from turn activity. Nothing is responsible
for it, so nothing notices when it ends.

Seven things can stop a running `Workflow` today. None of them knows what work
is running, and none leaves a trace of what it stopped:

| What ends it | Where |
|---|---|
| 30 minutes of **silence on the stream**, not of the work | `BG_IDLE_RELEASE_MS`, `claude-runtime.provider.js:90` |
| The 2-hour total ceiling | `BG_TOTAL_HOLD_MS`, `:91` |
| The next message, when `keepSessionAlive` is off | `:1350` → `releaseInput()` |
| The next message, when the process fingerprint differs | `:1603`; the comment at `:1611` says the old process is closed |
| A turn that starts no background work of its own → `release` → `heldSession.close()`, which never consults `outstandingWork` | `:1860-1868` |
| A SIGINT or a pm2 restart | observed 2026-09-18 16:57:03 |
| Registry eviction 5 minutes after `complete`, while the process lives | `COMPLETED_RUN_RETENTION_MS`, `chat-run-registry.service.ts:43` — this is `01` |

There is no row in the database for a running workflow, nothing to resume, and
nothing that can say it died. Establishing whether one was alive on 2026-09-18
required reading pm2 logs, a process tree, `mtime`s under `/tmp`, a sqlite
query and a JSONL parse.

### Why this is structural, not sloppiness

In Claude Code the process **is** the session, owned by the terminal; the only
thing that ends it is the user closing it. Here the process is a derived
resource shared by a web UI with reconnects, several devices and a pm2 that
restarts. What was implicit became something that has to be modelled, and it
was not.

The hold is in effect a **lease** — a time-bounded claim that should be renewed
by whoever owns the work. It is renewed by incidental SDK traffic instead, which
is why thirty minutes of quiet agents is indistinguishable from "finished".

## What it costs

Six reports of "the session is stuck" in `plan/local`. **Two** were real loss of
work (T5, T2 — both fixed). **Four** were the interface failing to represent a
healthy backend: T6, T7, T18, and the 2026-09-18 case on session `9b0977e3`,
where the workflow had produced 692 KB of output and a turn was running while
the pane looked frozen.

The recurring cost is not the defects. It is that every instance of the question
"is it stuck?" takes an investigation, using data the server already holds.

## What is already in place

The raw material arrived with `plan/local/T19`. The SDK reports a background
run's lifecycle on frames that now normalize rather than being dropped:

| Frame | Carries |
|---|---|
| `task_started` | `workflow_name` (the script's own `meta.name`), `description`, `task_id` |
| `task_progress` | `usage {total_tokens, tool_uses, duration_ms}`, `last_tool_name`, `summary` |
| `task_updated` | `patch.status`: pending / running / completed / failed / killed / paused |
| `task_notification` | `status`, `summary`, `output_file`, `usage` |

Those are exactly the columns a job record needs. What is missing is somewhere
to put them.

## Approach

Invert the direction of ownership. Today lifetime flows *turn → process → work*,
so anything that touches the process touches the work. It should flow
*work → job record → process*: the process is held because a job is alive, not
the other way round.

1. **A `background_jobs` table.** Session, task id, tool-use id, workflow name,
   started at, last heartbeat, status, output file. Written from the frames
   above, which already arrive.

2. **The hold reads the record.** A process is held while a `running` job exists
   for the session, and the idle ceiling measures time since the job's last
   heartbeat rather than since the last frame on the stream. This is what makes
   `plan/local/T22` unnecessary as a separate fix: a live job forces process
   reuse regardless of the `keepSessionAlive` setting.

3. **One source for the UI.** The pinned indicator (`plan/local/T21`) and the
   `Workflow` card (`T19`, `T20`) read the same record instead of each deriving
   state from something different.

4. **Reconcile at boot.** Any job still `running` after a restart becomes
   `interrupted` and says so. The first time a dead workflow reports its own
   death.

Steps 1 and 2 are the design; 3 and 4 are what make it visible. `plan/local/T24`
(a per-session diagnostic) is the read-only version of the same data and can
ship first — it needs no schema and answers the question that costs the time.

### None of the seven paths disappears

Processes still die. The difference is that each becomes a state transition on
a record that survives, instead of a silent disappearance. Three do close
(`keepSessionAlive`, the `close()` that ignores `outstandingWork`, and the
registry eviction from `01`); the rest keep working and start leaving a trace.

## Open questions — decide before writing code

- **One job or a tree?** A `Workflow` is one job but contains eight agents, each
  with its own task id. One row is honest and simple; a tree shows real progress
  and costs three times the code.
- **Who deletes?** A record that is never cleaned grows with the conversation.
  Time-based retention, or deletion when the session closes?
- **Is a job resumable?** An `interrupted` job with its output file on disk holds
  enough to be restarted. Worth it, or is reporting enough?
- **Work that emits no frames.** `Bash(run_in_background)` sends no
  `task_progress`. Either it joins the model with a derived heartbeat, or it
  stays on today's mechanism — and then there are two.

## What this does not fix

An owner reports correctly *that* work stopped, not *why*. In the 2026-09-18
incident, whatever silenced the agents at 18:35 stays unexplained after this
lands. The difference is seeing it at 18:36 instead of 20:40.

## Verification

1. Start a `Workflow`, send another message immediately: the job record stays
   `running` and the process is reused, whatever `keepSessionAlive` says.
2. Restart pm2 mid-run: the job reads `interrupted` in the UI rather than
   vanishing.
3. A session with no background work behaves exactly as it does today.
4. Re-run the 2026-09-18 investigation against the record instead of `ps` and
   `/tmp` — it should be one query.
