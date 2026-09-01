# 01 — Background run lifecycle

**Status:** OPEN · **Depends on:** nothing · **Unblocks:** `03`, `04`
**Findings:** O1–O7 · **Upstream:** unclaimed (see conflict warning)

Recommended starting point. This is the vertical slice that makes background
tasks actually work rather than merely killable — backend fix plus the UI that
finally shows the result.

## The defect

Two timers disagree:

| Constant | Value | Where |
|---|---|---|
| `COMPLETED_RUN_RETENTION_MS` | 5 min | `chat-run-registry.service.ts:43` |
| `BG_WAIT_CEILING_MS` | 30 min | `claude-runtime.provider.js:71` |

The provider sends `complete` as soon as `result` arrives — even with
`backgroundWorkPending` set (`claude-runtime.provider.js:972`) — and *then*
holds stdin open. That `complete` starts the 5-minute eviction clock
(`evictRunLater`, called at `chat-run-registry.service.ts:107`).

So for up to **25 minutes the provider process is alive while the registry
entry is gone.** Consequences, in order of how they bite:

1. `runs.get(sessionId)` is `undefined`, so `chat.subscribe` reports
   `isProcessing: false` and re-attach fails.
2. After a page refresh the still-live stream writes to a dead socket and every
   frame is silently dropped at the `readyState` check
   (`chat-session-writer.service.ts:168`). The user sees nothing, forever.
3. No second `complete` is possible — `decorateAndRecordEvent` returns `null`
   for a `complete` when `run.status === 'completed'`
   (`chat-run-registry.service.ts:89`). Since `requestLatestMessages` only runs
   off the complete/subscribe paths, the transcript is **never reconciled
   against disk** after background work finishes.

Aggravating: the hold timer is re-armed on every message
(`scheduleRelease`, `claude-runtime.provider.js:741`), so it measures *silence*,
not elapsed time. A chatty background stream extends it indefinitely — the real
window is unbounded, not 30 minutes.

## Approach

Keep the change in `chat-run-registry.service.ts` wherever possible — six open
upstream PRs touch `claude-runtime.provider.js` and only a handful of lines
there are genuinely needed.

1. **Distinguish "turn complete" from "run finished."** A run whose process is
   still held is not a candidate for eviction. Either add a `heldForBackgroundWork`
   flag on `ChatRun` that `evictRunLater` refuses to evict on, or defer arming
   the eviction timer until the process actually detaches. The provider already
   tracks the state (`heldForBackgroundWork`, `claude-runtime.provider.js:1003`) —
   it just never tells the registry.

2. **Allow a terminal event after the turn's `complete`.** Options, in
   preference order:
   - a distinct event kind (`background_complete`) that bypasses the
     `:89` duplicate-drop entirely — cleanest, no risk to the exactly-one-complete
     contract;
   - or relax `:89` to permit one further `complete` when the run is flagged held.

   Whichever we pick, the client must call `requestLatestMessages` on it so the
   transcript reconciles.

3. **Make `isProcessing` honest.** `chat.subscribe` should report a held run as
   still processing, so re-attach works and the UI can show it.

### Open questions

- Is a held run's socket re-attachable at all after a refresh, or does the
  writer need to re-bind to the new connection? `chat-session-writer.service.ts:168`
  suggests the latter — needs checking before writing code.
- Should the 30-min ceiling become elapsed-time rather than idle-time? Changing
  `scheduleRelease` is a behaviour change with its own risk; it may be better to
  leave it and just stop the registry from lying.

## UI

Currently nothing exists (O6): a grep of `src/` for
`run_in_background|BashOutput|backgroundTask` hits only our own `toolConfigs.ts`
and a test. Two pieces:

- **A live background-shell ledger** — what is still running for this session
  (id, command, status, elapsed), visible *after* the turn reports complete.
  This is the piece that is impossible today because the registry has already
  evicted the run; it only becomes buildable once step 1 lands.
- **A real completion card.** Today the entire display for background work
  finishing is a 1.5px dot plus one line of `text-xs` grey text
  (`MessageComponent.tsx:164`). It should be a card with the summary and an
  expandable result. Fed properly by `03`; until then it stays regex-scraped.

Already working, reuse it: `notifyBackgroundWorkCompleted` fires a push
notification with code `run.background_completed`
(`notification-orchestrator.service.js:272`).

## Verification

1. `Bash(run_in_background: true)` with work that takes **> 5 minutes** to
   report back — the whole point is crossing the eviction boundary. Confirm the
   follow-up reaches the transcript.
2. Same, but refresh the page mid-wait. Confirm re-attach works and frames are
   not dropped.
3. Hit stop during the hold. Confirm the process dies (`ps` — no orphaned
   `claude`), which `c6a12c5` already fixed and this must not regress.
4. Confirm exactly one terminal event per turn still holds for ordinary runs —
   there are existing registry tests, extend them.

## Risks

- The exactly-one-complete contract at `:89` exists to dedupe an aborted run's
  racing `complete`. Do not weaken that path without a test covering abort.
- **#1233** (hold one process per conversation) is the biggest merge-conflict
  risk here — it reuses the supersede semantics rather than fixing them.
