# 03 — Task lifecycle events (`system` frames → `task_notification`)

**Status:** OPEN · **Depends on:** `01` (for the events to be worth showing)
**Findings:** O12–O14 · **Upstream:** effectively unclaimed — but read #1213 first

Small change, high value: the client side already exists. This replaces
regex-scraping with real events.

## The defect

**O12 — `system` frames are dropped wholesale.** Claude's `normalizeMessage`
has branches for `content_block_delta` (`:683`), `content_block_stop` (`:686`),
`thinking` (`:879`), `tool_use` (`:891`) and `tool_result` (`:905`), then falls
through to an empty return. There is **no `system` branch**, so everything the
SDK sends that way is discarded before reaching the websocket. This is where
task lifecycle events would arrive.

**O13 — the target kind already exists and is already rendered.**
`task_notification` is declared at `server/shared/types.ts:193`, has a client
renderer, and the **Codex** provider emits it
(`codex-sessions.provider.ts:1891`). Claude never does. What works today is
`parseTaskNotification` (`useChatMessages.ts:51`) regex-scraping an XML blob out
of message *text* — which breaks whenever that injected format changes.

So the wiring is: server emits nothing → client scrapes text as a fallback.
Both ends of the real path are built; only the middle is missing.

**O14 — streaming is separately dead.** `includePartialMessages` is never set
anywhere in the repo (**zero hits**), so the SDK emits no partial frames at all.
Fixing the known `stream_event` unwrap bug alone would change nothing. Out of
scope here, but worth recording so nobody debugs the unwrap in isolation.

## Approach

1. Add a `system` branch to `normalizeMessage` that maps task lifecycle frames
   onto the existing `task_notification` kind.
2. Delete or demote `parseTaskNotification` to a fallback once real events flow —
   do not remove it until verified against a live transcript, since older
   sessions on disk only have the text form.
3. Upgrade the renderer (see `04` / `01`): today it is a 1.5px dot and one line
   of grey text (`MessageComponent.tsx:164`).

### Read #1213 before starting

Upstream PR #1213 patches this exact function for records it currently drops —
specifically task-notification payloads from background subagents completing
mid-turn. It handles `queue-operation`/`remove` records, **not** `system` SDK
frames, and routes them as `kind: 'text', role: 'user'` rather than the declared
`task_notification` kind.

Decide up front: adopt its record handling and build on top, or diverge
deliberately. We will conflict with it either way.

## Verification

Needs a real transcript. Capture the raw SDK stream for a session that runs a
background task and confirm which frames actually arrive as `system` — the
branch list above is what the code handles, not necessarily what the SDK sends.
Do this before writing the branch.
