# 02 — Survivability under Workflow load

**Status:** OPEN · **Depends on:** nothing · **Independent of `01`**
**Findings:** O8–O11 · **Upstream:** entirely unclaimed

The only item whose failure mode is *the whole process dies and takes every
other session with it*. Take this first if stability matters more than features.

## The defects

**O8 — no process-level crash guards.** Grep for `uncaughtException`,
`unhandledRejection`, `--max-old-space-size` across `server/`, `package.json`,
`scripts/`, `docker/`: **zero hits.** Any unhandled throw or heap exhaustion
kills the single Node process, and with it every session on the box.

**O10 — the event buffer is capped by count, not bytes.**
`MAX_BUFFERED_EVENTS_PER_RUN = 5000` (`chat-run-registry.service.ts:51`,
splice at `:112`), retaining full `toolInput`/`content`. `Workflow` tool inputs
are entire scripts. At ~100 KB average that is ~500 MB resident *per session* —
which is how O8 gets triggered in practice.

**O9 — the 500-cap severs tool pairs.** `MAX_REALTIME_MESSAGES = 500`
(`useSessionStore.ts:547`) applied as `slice(-500)` (`:776-777`) drops
`tool_use` rows while their later `tool_result` rows survive. The orphans then
hit `if (msg.toolId) break;` (`useChatMessages.ts:370`) and are silently
discarded — so **tool calls visibly evaporate mid-run**. Experienced as a UI
bug; fixed in the store.

**O11 — silent replay gap.** The client sends `lastSeq` on subscribe
(`ChatInterface.tsx:271`) and tracks it (`useChatRealtimeHandlers.ts:105-107`),
but never compares it against the server's ack to notice the buffer truncated
past its position. There is a comment in the registry saying "the client should
refresh over REST" — that is not implemented.

## Approach

1. **Crash guards first** — `unhandledRejection` / `uncaughtException` handlers
   that log with enough context to identify the session, plus an explicit
   `--max-old-space-size`. Cheapest possible insurance; independent of
   everything else here.
2. **Byte budget on the buffer.** Truncate the *buffered* copies only — the
   forwarded copy must stay intact, or the live UI loses content that the
   transcript then can't recover.
3. **Fix the 500-cap** so it cannot sever a `tool_use`/`tool_result` pair:
   either slice at a pair boundary, or keep orphaned results attachable instead
   of discarding them at `useChatMessages.ts:370`.
4. **Close the replay gap** — read the ack's `lastSeq`, and force
   `requestLatestMessages` when it exceeds the local `lastSeqRef`. A few lines,
   in `useChatRealtimeHandlers.ts:126`.

## Verification

- Run a real `Workflow` with several parallel subagents and watch server RSS,
  browser CPU/memory, and whether tool cards survive past 500 events.
- Force a buffer truncation and confirm the client notices and refreshes rather
  than silently missing events.
- Confirm the byte budget truncates buffered copies only, not forwarded ones.

## Note

`453da96` (rAF coalescing) already removed the render storm that made this
visible fastest — hundreds of full-transcript rebuilds per second. That was the
symptom; these are the causes underneath it.
