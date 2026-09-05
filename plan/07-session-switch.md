# 07 — Fast session switching

**Status:** OPEN · **Depends on:** `05` (to make the background revalidate cheap)
**Findings:** O22–O26 · **Upstream:** unclaimed

Reported symptom: switching sessions in the **Shell tab** is slow. (Chat
switching was reported as acceptable in practice, but the chat findings below
are verified and stay in the inventory — they are the same class of defect and
will bite on a large enough transcript.)

## Shell tab — the reported case (O25, O26)

### O25 — one terminal, reused across sessions, never reset

`useShellRuntime.ts:131-138`: a session change calls `disconnectFromShell()`
only. The `Terminal` instance is **not** disposed — `disposeTerminal()` runs
only on project change or explicit restart (`:113-129`). So the same xterm
buffer carries the previous session's screen, and the next session's output is
written on top of it. There is no `terminal.reset()` anywhere on that path.

### O26 — reattach replays up to 5000 chunks as 5000 websocket frames

`shell-websocket.service.ts:365`:

```js
existingSession.buffer.forEach((bufferedData) => {
  ws.send(JSON.stringify({ type: 'output', data: bufferedData }));
});
```

One JSON frame per buffered chunk, up to `5000` (`:437`). Every switch means the
client parses and writes up to 5000 messages on the main thread, on top of a
buffer that was never cleared. That is the slowness, and it compounds with O20:
what is being replayed is a byte log, not screen state.

### Fix, in order of cost

1. **`terminal.reset()` on session change** — one line, stops the bleed.
2. **Batch the replay** — the server concatenates the buffer into a single
   frame; the client writes it once. Cheap, big win.
3. **One terminal + one socket per session, kept mounted and hidden** — *the
   chosen approach*. Render a `Shell` instance per open session, keep them all
   connected, show only the active one. No reconnect, no replay, no repaint; the
   session-change effect at `useShellRuntime.ts:131-138` disappears entirely.

   The server side already supports it: PTYs are keyed on
   `${projectPath}_${sessionId}` and retained across disconnects
   (`shell-websocket.service.ts:~215`), so several live sockets are the normal
   case, not a new one.

   Four things to get right:

   - **Hiding must preserve layout.** A pane hidden with `display:none` (or the
     `hidden` attribute) measures 0×0, so `FitAddon.fit()` computes a garbage
     size and pushes a bogus `resize` to the PTY — which makes the TUI repaint
     wrongly. Either keep inactive panes laid out but invisible
     (`position:absolute; visibility:hidden; pointer-events:none`), or skip
     `fit()` while hidden and re-fit on show. This is the main trap.
   - **Cap the live panes** (3–5, LRU) and dispose the rest. Each pane costs a
     WebSocket, a PTY, and an xterm buffer.
   - **WebGL contexts are limited** (browsers cap around 16). With a low cap this
     is fine; if the cap grows, drop the WebGL addon on background panes.
   - **Resize while hidden**: on show, re-fit and re-send `resize` before the
     first frame, otherwise the pane renders at the previous session's geometry.

   O25 and O26 still need fixing for first attach and page reload — this removes
   them only from the *switch* path.
4. **tmux** (see `06`) removes the replay problem entirely — attach sends a
   coherent redraw instead of a log. Second place where tmux pays for itself.

## Chat tab — verified, lower urgency


The store was designed for exactly this. `useSessionStore.ts:1-8` says:

> *"Session switch = change activeSessionId pointer. **No clearing. Old data
> stays.**"*

The hook wrapped around it throws that benefit away.

## O22 — the hydration check is single-slot

`useChatSessionState.ts:713-726` decides whether to take the fast path from
`lastLoadedSessionKeyRef`, which holds **one** key. So the
stale-while-revalidate path only fires when you return to *the same* session
(e.g. coming back from another tab). Switching to a different session always
falls through to the cold path — even though the store still holds that
session's slot with a valid `fetchedAt`.

**Fix:** decide from the target session's own slot, not from a single ref.
Replace `lastLoadedSessionKeyRef` with a set of hydrated session keys, or drop
it and test `existingSlot?.fetchedAt` directly.

## O23 — the cold path blanks the pane and resets the view

Along that path (`useChatSessionState.ts:734-760`):

- `setIsLoadingSessionMessages(true)` → the loading view replaces the
  transcript. **This is the flicker**, and it happens even when cached messages
  for that session are sitting in the store.
- `setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES)`, `messagesOffsetRef = 0`,
  `setHasMoreMessages(false)`, `setTotalMessages(0)` → pagination and scroll
  position are discarded, so returning to a session re-renders from the tail
  even if the data never left memory.

**Fix:** render the cached slot immediately and revalidate in the background;
only show a loading state when there is genuinely nothing to show.

## O24 — per-session view state lives in component state

`visibleMessageCount`, `messagesOffsetRef`, `hasMore`, `total` and scroll
position are `useState`/`useRef` on the single mounted `ChatInterface`
(`WorkspaceMain.tsx:147` — one instance, `selectedSession` passed as a prop, no
`key`, so it never remounts). They are therefore per-*component*, not
per-session, and cannot survive a switch even with O22 and O23 fixed.

**Fix:** move them onto the `SessionSlot` next to the messages, so restoring a
session restores its view. This is the piece that turns "cached data" into an
actual fast switch.

## Why `05` matters here

The background revalidate still hits `fetchHistory`, which re-reads and
re-parses the whole transcript (O18). Measured on this host:

| | |
|---|---|
| `kido-stack` main transcript | 98 MB / 6999 lines |
| read + parse only, measured | 216 ms (before normalize) |
| that session's `subagents/` directory | 869 MB across 598 `agent-*.jsonl` |
| whole project directory | 1.6 GB / 774 files |

So `05` is not the lowest-priority item its own page claims — it is the server
half of this one. Promote it.

Unrelated but worth noting: 1.6 GB of agent transcripts in a single project
directory is a housekeeping problem in its own right.

## Verification

- Switch between two large sessions repeatedly: no loading view, no flicker,
  scroll position preserved on return.
- Confirm a stale session still refreshes in the background.
- Confirm a genuinely uncached session still shows a loading state.
