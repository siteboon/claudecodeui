# The realtime stream

*One frame's journey from a provider CLI to a rendered row, and the buffer that keeps a
fast reply from re-rendering the transcript on every token. The socket itself is
[the websocket layer](./01-websocket-transport.md); which session id a frame carries is
[conversation handoff](./03-conversation-handoff.md); how a tool frame becomes a card is
[tool views](./06-tool-view.md).*

## In one paragraph

Four provider CLIs speak four dialects. Each provider's runtime translates its output
into one shape — `NormalizedMessage`, discriminated by a `kind` field — and hands it to a
gateway writer that rewrites the session id, stamps a per-run `seq`, buffers it for
replay, and fans it out to every socket watching that run. On the client there is exactly
one listener for all of it: `useChatRealtimeHandlers` switches on `kind` and, for almost
every kind, appends the frame to the viewed session's slot in `useSessionStore`. The one
exception is `stream_delta`. Deltas do not reach the store directly; they pile up in a
ref and a 100 ms timer publishes the whole accumulated string into a single synthetic row
with a well-known id, so a reply that streams for thirty seconds is one row whose content
grows rather than a thousand rows. Everything a newcomer finds confusing here comes from
that one exception and from the fact that **only two of the four providers ever send a
`stream_delta` at all.**

## Mental model

Eight rules. If you can apply these, you can predict what the code does without reading
it.

1. **Every server-to-client frame carries a `kind`, and one function reads it.**
   `src/modules/chat/hooks/useChatRealtimeHandlers.ts` is the only place in chat that
   touches a raw frame. It does not branch on provider, does not navigate, and does not
   translate session ids — the backend has already done all three. A frame with no `kind`
   is dropped on the first line, which is what makes Task Master's `type`-keyed
   broadcasts invisible to chat.
2. **The default action is "append to the store".** Read the switch as a filter, not a
   dispatcher: gateway kinds and the two streaming kinds are handled specially, five
   kinds are control events that are deliberately *not* stored, and everything else —
   `text`, `tool_use`, `tool_result`, `thinking`, `error`, `task_notification` — just
   becomes a row.
3. **A streaming reply is one row, not many.** `updateStreaming` writes a row with the id
   `__streaming_<sessionId>` and replaces it in place on every flush. The transcript's
   row count stays flat while the text grows. `finalizeStreaming` rewrites that same array
   slot — new id, `kind: 'text'`, `role: 'assistant'` — so React reconciles instead of
   remounting.
4. **Whether you see deltas at all depends on the provider.** Cursor and OpenCode stream;
   Claude and Codex do not. Claude's live prose arrives as complete `text` rows, one per
   assistant message. Code that assumes "assistant reply implies `stream_delta`" is wrong
   for half the providers, and the half it is wrong for is the default one.
5. **`complete` is the only terminal event. `error` is just a row.** Providers emit
   `error` for mid-run stderr and keep running. Clearing the busy state on `error` leaves
   a live run writing into a UI that believes it is idle.
6. **Busy state is not derived from messages.** It lives in a separate per-session map in
   `src/shared/hooks/useSessionProtection.ts`. The spinner, the abort button and the
   status text all read that map; the transcript reads the store. The two are only
   coupled by the handler writing to both.
7. **Live rows and persisted rows never mix in storage, only in projection.** The store
   keeps `realtimeMessages` and `serverMessages` in separate arrays and computes `merged`
   from them. `complete` triggers a REST refresh of the persisted tail; the live copy of
   the reply survives until the persisted copy demonstrably supersedes it. Details in
   [the message store](./04-message-store-and-lazy-loading.md).
8. **The delta buffer belongs to the chat pane, not to a session.** There is one
   `accumulatedStreamRef` and one `streamTimerRef` for the whole `ChatInterface`. Two
   sessions streaming at once share them. This is a real limitation, not a subtlety —
   see [Cross-session behaviour](#cross-session-behaviour).

## The pieces

| File | Role |
| --- | --- |
| `src/shared/context/WebSocketContext.tsx` | The one socket. Parses each frame and calls every registered listener synchronously. Synthesises the client-only `websocket_reconnected` frame on a re-open, and retries a dropped socket after 3 s. |
| `src/modules/chat/hooks/useChatRealtimeHandlers.ts` | The whole client-side protocol. One switch on `kind`; the streaming buffer; the `seq` bookkeeping. |
| `src/modules/chat/ChatInterface.tsx` | Owns the four refs the handler mutates — `accumulatedStreamRef`, `streamTimerRef`, `lastSeqRef`, `statusCheckSentAtRef` — and clears the first two on unmount. |
| `src/modules/chat/hooks/useSessionStore.ts` | Per-session slots. `appendRealtime`, `updateStreaming`, `finalizeStreaming`, `truncateAt`, and the merge of live and persisted rows. |
| `src/modules/chat/hooks/useChatMessages.ts` | `normalizedToChatMessages` — the projection from store records to UI objects. Pairs `tool_use` with `tool_result`, folds subagent rows into their container, and memoises through a `WeakMap`. |
| `src/modules/chat/hooks/useChatSessionState.ts` | Sends `chat.subscribe` on session open and on reconnect, owns `requestLatestMessages` and `resetStreamingState`, and memoises `chatMessages`. |
| `src/modules/chat/hooks/useChatComposerState.ts` | The outbound side: `chat.send`, `chat.edit-send`, `chat.abort`, `chat.permission-response`, plus the optimistic user echo. |
| `src/shared/hooks/useSessionProtection.ts` | The per-session activity map that the indicator and the abort button derive from. |
| `src/modules/chat/transcript/StreamingMarkdown.tsx` | Renders an assistant reply, streaming or finished, as a settled half plus a pending half. |
| `src/modules/chat/utils/streamingMarkdown.ts` | `splitStreamingMarkdown` — where it is safe to cut a partially-written markdown document in two. |
| `src/shared/types.ts` | `ServerEvent` at `:204`, the client's view of a frame. Every field the handler reads is optional here. |
| `server/modules/websocket/services/chat-websocket.service.ts` | Handles `chat.send`, `chat.edit-send`, `chat.abort`, `chat.subscribe`, `chat.permission-response`. Registers the run, then hands the turn to the provider runtime. |
| `server/modules/websocket/services/chat-run-registry.service.ts` | One entry per app session. `decorateAndRecordEvent` at `:84` is the choke point: session-id rewrite, `seq` assignment, replay buffering, terminal-`complete` de-duplication. |
| `server/modules/websocket/services/chat-session-writer.service.ts` | The object provider runtimes think is their socket. Swallows `session_created`; `forward` at `:160` fans out to every watching connection and collects dead ones. |
| `server/shared/utils.ts` | `createNormalizedMessage` at `:348` and `createCompleteMessage` — the envelope every provider event is built with. **Not** `message-unification.ts`; that file exports only `prepareTranscriptMessages`, which runs on REST history reads and never on the live path. |
| `server/shared/types.ts` | `MessageKind` at `:178` — the fifteen kinds a provider can emit. `GatewayEventKind` at `:204` — the four the gateway adds. |
| `server/modules/providers/list/*/` | Per provider, a `*-runtime.provider.js` that drives the CLI or SDK and a `*-sessions.provider.ts` whose `normalizeMessage` converts one raw event into `NormalizedMessage[]`. |

Tests worth knowing about: `streamingMarkdown.test.ts` and
`streamingMarkdownRenderEquivalence.test.tsx` pin the split; `messageStreamEnd.test.tsx`
pins the DOM-identity rule; `tokenBudgetSessionScope.test.tsx` pins the token-counter
scoping; `liveSubagentGrouping.test.ts` pins the subagent fold;
`sessionStoreTruncate.test.tsx` pins `truncateAt`. All in `src/modules/chat/tests/`.

## One run, end to end

```mermaid
sequenceDiagram
    participant UI as Composer and transcript
    participant WSC as WebSocketContext
    participant GW as chat-websocket.service
    participant REG as chatRunRegistry and its writer
    participant CLI as Provider runtime

    UI->>WSC: chat.send with sessionId, content and options
    WSC->>GW: one frame on the shared socket
    GW->>GW: look up the session row for provider and project path
    GW->>REG: startRun keyed by the app session id
    GW->>CLI: runtime.run with the app session id
    CLI-->>REG: session_created announcing the provider-native id
    Note over REG: swallowed and recorded, never forwarded
    CLI-->>REG: text rows for Claude and Codex, stream_delta for Cursor and OpenCode
    REG-->>WSC: sessionId rewritten to the app id, seq stamped, buffered
    WSC-->>UI: dispatched to every listener
    CLI-->>REG: tool_use carrying a toolId
    REG-->>WSC: tool_use, next seq
    WSC-->>UI: card renders in its running state
    CLI-->>REG: tool_result carrying the same toolId
    REG-->>WSC: tool_result, next seq
    WSC-->>UI: the client pairs the two by toolId
    CLI-->>REG: complete
    REG-->>REG: run marked completed, evicted after five minutes
    REG-->>WSC: complete, seq stamped
    WSC-->>UI: flush and finalize, clear busy, refresh persisted tail
```

Three things in that picture are easy to get backwards:

- **The client never sees the provider's session id.** `session_created` is consumed by
  the writer, turned into a database mapping, and dropped. Every other frame has its
  `sessionId` overwritten with the app id.
- **`tool_use` and `tool_result` are paired on the client, not the server.** Claude's
  runtime emits them as separate frames, often far apart. OpenCode is the exception: it
  can attach a result inline on the `tool_use` frame, so the projection checks
  `msg.toolResult` first and only then consults its map of `toolId` to result row.
- **The run outlives the socket.** It is keyed by app session id in the registry, keeps
  its last 5000 events for replay, and stays available for five minutes after finishing.
  A reconnecting client sends `lastSeq` and gets only what it missed — and only if the
  run is still running, because a completed run is already on disk and served over REST.

## What each provider actually emits

The unified `kind` vocabulary is a superset. No provider emits all of it, and the
differences are the single biggest source of "but it works on Claude" confusion. This
table is about **what arrives over the socket during a run** — a provider marked "history
only" produces that kind when its transcript is read back over REST, which is why a
reload can make the transcript look completely different from what streamed.

| Kind | Claude | Codex | Cursor | OpenCode |
| --- | --- | --- | --- | --- |
| `text` | yes, whole assistant messages | yes | history only | history only |
| `stream_delta` | **no** | **no** | yes, one per assistant chunk | yes, from `text` parts |
| `stream_end` | **no** | **no** | **never** | yes, from `step_finish` |
| `thinking` | yes | yes | history only | yes, from `reasoning` parts |
| `tool_use` | yes | yes | history only | yes |
| `tool_result` | yes, a separate frame | yes, a separate frame | history only | **never** — attached to the `tool_use` frame instead |
| `error` | yes | yes | yes, from stderr and spawn failures | yes |
| `status` with `text: 'token_budget'` | yes | yes | no | yes, once at process exit |
| `permission_request` / `permission_resolved` / `permission_cancelled` | yes, the only provider | no | no | no |
| `complete` | yes, exactly one | yes | yes | yes |

Two entries deserve the emphasis:

**Claude does not stream deltas today.** `claude-sessions.provider.ts:684` does contain a
branch that turns `content_block_delta` into a `stream_delta`, which is why the opposite
is widely believed. That branch is unreachable: `mapCliOptionsToSDK` in
`claude-runtime.provider.js` builds its options object from scratch and never sets
`includePartialMessages`, which the SDK defaults to false — and even with it enabled the
SDK wraps partial events as `{ type: 'stream_event', event: … }`, a shape the branch does
not match. What arrives live is one complete `text` row per assistant message, so a long
Claude reply appears in whole paragraphs, not character by character.

**Cursor emits `stream_delta` and never `stream_end`.** There is no `stream_end` anywhere
under `list/cursor/`. On Cursor the streaming placeholder is only ever finalised by the
defensive flush inside the `complete` branch. That is not a bug, but it means any change
that makes finalisation depend on `stream_end` breaks Cursor silently.

`task_notification` is in the kind union but has no live producer. It reaches the
transcript two other ways: `codex-sessions.provider.ts` builds it when reading history,
and the client synthesises it locally in `useChatSessionState.ts` when converting a UI
message back into a store record.

## The client reducer

```mermaid
flowchart TD
    F["Frame arrives from WebSocketContext"]
    K{"Does it have a kind"}
    DROP["Return. Task Master frames key on type"]
    SEQ["Advance lastSeq for this session id"]
    G{"Is it a gateway or client-only kind"}
    RC["websocket_reconnected. Refresh the tail then resubscribe"]
    HT["history_truncated. truncateAt the anchor id"]
    CS["chat_subscribed. Authoritative busy state and pending permissions"]
    PE["protocol_error. Clear busy and append an error row"]
    IG["session_upserted and loading_progress. Owned by useProjectsState"]
    S{"Is it a streaming kind"}
    SD["stream_delta. Append to the ref and arm the 100 ms timer"]
    SE["stream_end. Flush the ref then finalizeStreaming"]
    P{"Is it a control kind"}
    CTRL["complete, status, permission_request, permission_resolved, permission_cancelled"]
    ST["Never stored. Side effects only"]
    APP["appendRealtime into the session slot"]

    F --> K
    K -- no --> DROP
    K -- yes --> SEQ
    SEQ --> G
    G -- websocket_reconnected --> RC
    G -- history_truncated --> HT
    G -- chat_subscribed --> CS
    G -- protocol_error --> PE
    G -- sidebar kinds --> IG
    G -- no --> S
    S -- stream_delta --> SD
    S -- stream_end --> SE
    S -- no --> P
    P -- yes --> CTRL
    P -- no --> APP
    CTRL --> ST
```

The `shouldPersist` test is literally five inequalities, and the list is worth memorising
because looking for these kinds in the transcript array is futile: **`complete`,
`status`, `permission_request`, `permission_resolved` and `permission_cancelled` are
never stored.** They exist to move the busy map, the token counter and the permission
list.

`lastSeqRef` is advanced for every frame that carries a numeric `seq`, and only ever
forward. It is read when a `chat.subscribe` is sent — on session open and on reconnect —
so the server replays exactly the gap. There is no reordering buffer: frames are applied
in arrival order, which is safe because one TCP connection preserves order and replay is
emitted in buffer order.

## Text streaming

A provider that streams emits deltas far faster than a transcript can usefully re-render.
The handler's answer is a leading-edge-armed, trailing-edge-fired timer:

- The **first** delta appends to `accumulatedStreamRef` and arms a 100 ms `setTimeout`.
- Every delta inside that window only appends to the ref. The timer is not re-armed and
  not extended.
- When it fires, it clears itself and calls `updateStreaming(sid, wholeAccumulatedText)`.
  The next delta arms a fresh timer.

So the store is written at most ten times a second, and each write carries the entire
reply so far — not the increment. That is the detail that makes the rest of the design
make sense: the row is idempotent, so a missed flush costs nothing, and
`finalizeStreaming` has nothing to concatenate.

Two flushes are defensive rather than routine. `stream_end` clears the timer, flushes if
the ref is non-empty, finalises and resets the ref. The `complete` branch does the same
thing again, which is what carries Cursor — where `stream_end` never arrives — and any
provider whose run dies mid-reply.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Buffering: first stream_delta arms the timer
    Buffering --> Published: timer fires and updateStreaming writes the row
    Published --> Buffering: another delta arrives and re-arms the timer
    Buffering --> Finalized: stream_end or complete flushes then finalizes
    Published --> Finalized: stream_end or complete flushes then finalizes
    Finalized --> Reconciled: the REST tail refresh returns the persisted reply
    Reconciled --> [*]
```

`Finalized` and `Reconciled` are different rows in the same array position at different
times. Finalising swaps the synthetic `__streaming_` id for a unique
`text_<timestamp>_<random>` one and flips `kind` to `text`; the persisted reply that
arrives moments later has yet another id. The store collapses the pair —
`pruneRealtimeSupersededByServer` drops the live row when the same assistant text is
already in the persisted turn, and `dedupeAdjacentAssistantEchoes` catches whatever slips
past into `merged`. Without both, every completed reply would briefly appear twice.

## Incremental markdown rendering

Republishing the whole reply ten times a second means re-parsing the whole reply ten
times a second — O(length) per tick, O(length²) over a reply. `StreamingMarkdown` fixes
that by cutting the text into a **settled** prefix and a **pending** tail at a safe block
boundary and rendering them as two memoised `<MarkdownBody>` siblings. The settled half's
props change only when a block completes, so a tick re-parses one block.

The whole thing rests on one property, and the source states it precisely:

> Correctness rests on markdown blocks being independent across a blank line: rendering
> `settled` and `pending` as two documents must equal rendering their concatenation. That
> does NOT hold inside a fenced code block, a display-math block, a list, a blockquote, a
> table, an indented code block, or across a link-reference/footnote definition and its
> usage — the boundary search skips all of them.
> — `src/modules/chat/utils/streamingMarkdown.ts:12-17`

`splitStreamingMarkdown` walks the lines tracking the open code fence and `$$` math
state, and considers only blank lines that are outside both. A blank line is rejected as
a boundary if the nearest non-blank line on **either** side matches
`CONTEXT_SENSITIVE_LINE` — a list item, an indented continuation, a blockquote, a table
row, or a link-reference definition. The **last** surviving candidate wins, so the
settled half is as long as it can safely be.

Three surprises, all of them intended:

- **Settled blocks can un-settle.** The boundary is recomputed from scratch each tick, so
  a paragraph that was settled goes back to pending as soon as a list or a table starts
  after it. `streamingMarkdown.test.ts` has a monotonicity test, but it uses
  paragraphs-only content; monotonicity is not a general guarantee, and retraction is
  what keeps the two halves equal to the unsplit document. Measured at about a third of
  realistic replies, once each.
- **A block that crosses the boundary loses transient in-block state.** It changes parent,
  so its DOM is recreated: a code block's "Copied" tick and any text selection inside it
  are gone. Do not park state in a streamed block.
- **The same component renders finished replies**, with `isStreaming: false` and no split.
  That is deliberate. `MessageComponent` used to swap `<StreamingMarkdown>` for
  `<Markdown>` at that position, and React treats a different element type in the same
  position as a different component — so every reply threw away its DOM the moment it
  completed, destroying a selection the user had started. `messageStreamEnd.test.tsx`
  asserts on node identity, not HTML, because identity is what the browser keys a
  selection to.

## Run lifecycle and busy state

The activity indicator, the abort button and the status text all derive from one
`Map<sessionId, SessionActivity>` in `useSessionProtection`. Nothing in the transcript
feeds it. It is written in exactly four places:

| Event | Effect on the map |
| --- | --- |
| The composer sends | `markSessionProcessing(sessionId, { statusText: null, canInterrupt: true })`, before the frame goes out |
| `chat_subscribed` with `isProcessing` | Marks processing — this is the authoritative answer after a reload |
| `chat_subscribed` idle | Deletes the entry, **unless** a newer local request started after the subscribe was sent. That guard is `ifStartedBefore`, compared against `startedAt` |
| `complete` or `protocol_error` | Deletes the entry |

The `complete` branch runs in a fixed order: flush and finalise streaming text, delete the
busy entry, clear pending permissions for the viewed session, then branch on outcome.

| Outcome | Signal | What the client does |
| --- | --- | --- |
| Aborted | `msg.aborted` | Nothing further. Clearing the entry was the whole job |
| Failed | `msg.success === false` | No sound, no title indicator |
| Succeeded | neither | Title indicator plus completion sound |

Then, **for the viewed session only**, `requestLatestMessages` re-reads the persisted
tail. A background session that finishes keeps its live rows until it is opened.

Abort is a server-side transaction. `chat.abort` requires a run in `running` status —
otherwise the server answers `protocol_error` with code `NO_ACTIVE_RUN` — then kills the
runtime and calls `completeRun` with `aborted: true`. The killed process usually emits its
own `complete` a moment later; `decorateAndRecordEvent` drops it, because a run already
marked completed cannot complete twice. The partial reply that streamed before the abort
stays in the transcript as an ordinary assistant row.

`error` is not part of any of this:

> 'error' is an informational message row, not a terminal event — providers emit it for
> mid-run stderr output too. Run teardown is always signalled by the unified 'complete'
> that follows.
> — `useChatRealtimeHandlers.ts:281-283`

The token counter deserves one line here because it travels as a `status` frame:
`status` with `text === 'token_budget'` sets the counter, **but only when the frame's
session is the one on screen** — otherwise a second session running in the background
would overwrite the number the user is looking at. `tokenBudgetSessionScope.test.tsx`
pins both directions. The counter shows context-window occupancy, not the turn's bill;
feeding it a summed `result.usage` is what made it bounce before commit `ab13376d`.

The other arm of the `status` branch — the one that writes `statusText` and `canInterrupt`
into the activity map — **has no producer today.** All three `status` emitters
(`claude-runtime.provider.js:968`, `codex-runtime.provider.js:406`,
`opencode-runtime.provider.js:338`) send `text: 'token_budget'`. The arm is live code
kept for a provider that reports progress text; do not delete it expecting nothing to
change, and do not assume the status text you see in the UI came from it.

## Permission requests

Claude is the only provider with interactive tool approvals. Its runtime's `canUseTool`
callback emits `permission_request` with a `requestId` and blocks until the client answers
with `chat.permission-response`. When an answer arrives it emits `permission_resolved`
with the same id; if the run ends or the request times out it emits `permission_cancelled`
instead. The distinction matters because the answer itself travels only on the inbound
socket: without the outbound `permission_resolved`, the `permission_request` sitting in
the replay buffer had nothing to retract it, so a mid-run page refresh resurrected an
already-answered prompt — and a second tab kept it forever. `permissionPromptReplay.test.tsx`
pins the replayed request-then-resolution netting out to nothing.

The client keeps the pending list in `ChatInterface` state, not in the store — permission
kinds are among the five that are never persisted as rows. The rules:

- A request plays a notification sound, **except** for `ExitPlanMode` / `exit_plan_mode`,
  which are not actionable prompts.
- The list is only maintained for the **viewed** session. A request for a background
  session still marks that session processing and still plays the sound, but does not
  enter the list.
- Duplicate `requestId`s are ignored, because `chat_subscribed` also carries the full
  pending set and can race with a live `permission_request`.
- `permission_resolved` and `permission_cancelled` remove their `requestId` from the
  list, whichever tab or replay delivered the request.
- `chat_subscribed` replaces the list wholesale, and plays the sound only on the
  transition from "no actionable requests" to "some".
- `complete` empties the list for the viewed session.

## Cross-session behaviour

The store is session-keyed and correct for any number of sessions. The streaming buffer is
not, and this is the sharpest edge in the subsystem.

`accumulatedStreamRef` and `streamTimerRef` are single refs on `ChatInterface`. When a
delta arrives:

- It is appended to that one ref, **whatever session it belongs to.**
- The timer, if not already armed, is armed with a closure over *that* frame's session id.
  The flush writes the ref's entire contents to *that* session.
- Additionally, if the frame's session is **not** the one on screen, the raw delta is
  appended to that session's slot as its own row.

So two sessions streaming at once share one buffer, and the background session's prose can
be published into the foreground session's placeholder. Nothing repairs this except a
session switch, which calls `resetStreamingState` and clears both refs. The background
session, meanwhile, accumulates one store row per delta rather than one coalesced row;
those rows only disappear on a server refresh whose persisted assistant text matches them
exactly, and they count against the 500-row realtime cap.

Everything else is per-session and behaves: `lastSeqRef` and `statusCheckSentAtRef` are
`Map`s keyed by session id, the busy map is keyed by session id, the token counter is
scoped to the viewed session, and `appendRealtime` targets the frame's own slot regardless
of what is on screen.

The multi-*client* story is the opposite — deliberately shared. A run's writer holds every
subscribed connection, so a second tab or a phone gets the same live stream, and
`history_truncated` reaches all of them so an edit made in one tab does not leave the
question rendered twice in another.

## Gotchas and why the code looks like this

- **`createNormalizedMessage` lives in `server/shared/utils.ts`, not
  `message-unification.ts`.** That filename is the most misleading in the subsystem:
  `message-unification.ts` exports exactly one function, `prepareTranscriptMessages`, and
  it runs on REST history reads for Claude and Codex only. No live frame passes through
  it.
- **`__streaming_<sessionId>` is a real id that appears in the store.** It is matched by
  name in `pruneRealtimeSupersededByServer`. Code that assumes every row id came from a
  provider will trip over it.
- **`finalizeStreaming` mutates the array slot in place.** It does not remove and append.
  The id changes underneath the same position, on purpose, so React reconciles the
  existing DOM and a text selection survives the end of the reply.
- **A streaming reply does not re-trigger auto-scroll.** The follow effect depends on
  `chatMessages.length`, and an in-place rewrite does not change it. Within one streamed
  block the browser pins the pane; the next row that arrives re-follows. See
  [scrolling](./05-scrolling.md).
- **The 100 ms flush publishes the whole reply, not the delta.** Anyone optimising this
  into an incremental append has to also handle the case where a flush is skipped, which
  is exactly what the current design makes impossible to get wrong.
- **`error` does not end a run and does not clear the spinner. `protocol_error` does
  both.** A protocol error means the frame was rejected before a run existed —
  `SESSION_NOT_FOUND`, `UNSUPPORTED_PROVIDER`, `RUN_IN_PROGRESS`, `NO_ACTIVE_RUN` — so no
  `complete` will follow and nothing else would ever clear the busy state.
- **Only `protocol_error` synthesises a message row on the client.** Every other row
  originates from a provider or from the local optimistic echo.
- **Realtime rows are capped at 500 per session** (`MAX_REALTIME_MESSAGES`), oldest
  dropped. A tool-heavy run can exceed that; the persisted transcript is the fallback.
- **The server's replay buffer is 5000 events per run, retained 5 minutes after
  completion**, and completed runs are deliberately *not* replayed on subscribe — they
  are already served by the history endpoint, and replaying them would duplicate rows.
- **Subagent rows must be skipped in the second projection pass.** They are folded into
  their `Task` container in the first pass by `parentToolUseId`; dropping the
  `if (msg.parentToolUseId) continue` guard renders every subagent tool twice.
- **A `tool_result` whose `tool_use` is not in the loaded window renders nothing.** That
  is intentional: it is almost always a pair split across a pagination boundary, and
  rendering the raw content produced an unstyled dump that "fixed itself" on the next
  page load.
- **The projection cache is keyed on more than the source record.** A `tool_use` record is
  unchanged when its result arrives, and unchanged when its subagent timeline grows, so
  `CachedMessageProjection` stores `toolResultSource` and `subagentActivitySource`
  alongside the projected messages and requires both to match for a cache hit.
- **When a mid-run refresh attaches a partial server subagent timeline, the longer of the
  two lists wins.** Otherwise a refresh mid-run would visibly shorten a panel.
- **Never split streaming markdown inside a fence, list, table, blockquote or math
  block.** Extend `CONTEXT_SENSITIVE_LINE`; do not relax it. The equivalence property is
  the only thing making the two-half render legal.
- **`stream_end` from a background session is close to a no-op.** `finalizeStreaming`
  looks for `__streaming_<sid>` in that session's slot, and nothing put one there.
- **Frames without `kind` are dropped before anything else happens.** If events are
  clearly arriving and nothing renders, check that first.

## If you change this, check that

| If you touch | Also check |
| --- | --- |
| The 100 ms flush interval or the timer arming | `StreamingMarkdown`'s whole reason for existing is that interval. Slower means fewer re-parses but visibly chunkier text; faster means the split has to earn more. |
| `updateStreaming` or the `__streaming_` id | `pruneRealtimeSupersededByServer` matches that id by name, and `dedupeAdjacentAssistantEchoes` special-cases a `stream_delta` row followed by an identical assistant `text` row. |
| `finalizeStreaming` | It must keep the array position and must not append. `messageStreamEnd.test.tsx` covers the DOM-identity half; the duplicate-bubble half is covered by the store's dedupe. |
| The `shouldPersist` filter | Adding a kind to it makes that kind renderable, which means `normalizedToChatMessages` needs a case for it or it silently disappears. |
| Anything in `splitStreamingMarkdown` | `streamingMarkdown.test.ts` for the boundary rules and `streamingMarkdownRenderEquivalence.test.tsx` for split-equals-unsplit on every prefix. Both must pass on the fenced and list fixtures. |
| A provider's `normalizeMessage` | The kind table above. Adding `stream_delta` to a provider that had none makes the shared buffer and the missing `stream_end` suddenly matter for it. |
| `decorateAndRecordEvent` or `seq` assignment | Reconnect replay is `seq > lastSeq` with no gap detection, and `lastSeqRef` only moves forward. Any non-monotonic `seq` silently loses events. |
| The `status` branch | Both arms. The `token_budget` arm is scoped to the viewed session on purpose, and the other arm currently has no producer — a new producer will start writing status text into the activity map for the first time. |
| Session-switch cleanup in `useChatSessionState` | `resetStreamingState` is the only thing that unwinds a shared buffer mid-stream. Removing that call re-introduces cross-session text bleed. |

Related: [the websocket layer](./01-websocket-transport.md) for the transport and the replay
contract, [the message store](./04-message-store-and-lazy-loading.md) for what happens to
a row after `appendRealtime`, [tool views](./06-tool-view.md) for how a paired
`tool_use` becomes a card, and [the index](./README.md) for the rest of the set.
