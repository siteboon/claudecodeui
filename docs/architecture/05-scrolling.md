# Scrolling

*Where the transcript sits, who is allowed to move it, and the rules that stop the app from
fighting the user. Paging and row mounting are covered in
[the message store and lazy loading](./04-message-store-and-lazy-loading.md).*

## In one paragraph

The transcript is one scrolling `div`, and five separate pieces of code write its
`scrollTop`. There is no scroll controller and no state machine: the writers are
coordinated by a handful of refs that each one checks before acting. The shared truth is
`isUserScrolledUp` — `false` means "the user is parked at the bottom, keep them there",
`true` means "the user is reading, do not move them" — and it is recomputed only from
`scroll`, `wheel` and `touchmove`, never from a height change. Every deferred automatic
scroll re-reads that intent through `isUserScrolledUpRef` at the moment it fires, because
the value it was armed with may be seconds stale. Everything else — the settle after
opening a session, the position restore after older history is prepended, the jump to a
search hit — stakes a temporary claim in a ref that tells the other writers to stand down
until it is finished. The test file says it plainly: *"The transcript's scroll position is
written from five places coordinated by refs and timers rather than by one owner"*
(`src/modules/chat/tests/transcriptScrollOwnership.test.tsx`).

## Mental model

1. **One element owns the transcript position.** The `div.chat-messages-pane` rendered by
   `src/modules/chat/transcript/ChatMessagesPane.tsx`. A few rows contain their own capped
   scrollers (bash output, file lists, question panels) — those never move the transcript,
   and their native `scroll` events do not bubble, so they never reach `handleScroll`.
2. **The pane component holds no scroll state.** It takes `scrollContainerRef`, `onWheel`
   and `onTouchMove` as props. Every write to `scrollTop`, every threshold and every claim
   ref lives in `src/modules/chat/hooks/useChatSessionState.ts`. If you are reading
   `ChatMessagesPane.tsx` looking for scroll logic, you are in the wrong file.
3. **`isUserScrolledUp` is the only shared decision, and it has exactly three readers.**
   The append-follow effect, the tab-reactivation branch of the `useLayoutEffect`, and the
   jump-to-bottom button in `ChatInterface.tsx`. Predict from it: if the flag is `true`,
   no automatic scroll happens, and the round arrow button is on screen.
4. **The flag is only recomputed from an input event.** `handleScroll` runs on `scroll`,
   `wheel` and `touchmove`, and applies one test — `scrollHeight - scrollTop - clientHeight
   < 50`. Content that grows *below* the fold does not move `scrollTop`, emits no event, and
   therefore leaves the flag stale.
5. **A deferred scroll must re-read intent at fire time.** `isUserScrolledUpRef` mirrors
   the state so a timer armed 50 ms or 200 ms ago can ask whether the user has scrolled
   away since. Adding a timed scroll without that check reintroduces the bug
   `transcriptScrollOwnership.test.tsx` exists to catch.
6. **The follow effect re-runs on three things, not one.** Its deps are
   `chatMessages.length`, `isUserScrolledUp` and `isLoadingMoreMessages`. So a new *row*
   re-follows; a streamed rewrite of an existing row does not; and the flag flipping back
   to `false` also arms a scroll, which is what snaps you the last few pixels when you
   scroll back down.
7. **A claim ref suppresses the other writers.** `pendingInitialScrollRef`,
   `pendingScrollRestoreRef`, `searchScrollActiveRef`, plus two latches at the top of the
   list, `topLoadLockRef` and `wasNearTopRef`. A session change clears or re-arms all five
   in one effect.
8. **Row geometry does not change behind the user's back.** Lazy rows keep their measured
   height when their content unmounts, React keys are derived from intrinsic message fields
   rather than object identity, and `contain-intrinsic-size: auto` lets the browser
   remember each row's last rendered size.

## The pieces

| File | Role |
| --- | --- |
| `src/modules/chat/hooks/useChatSessionState.ts` | Owns the scroll position. All five writers, `isNearBottom`, `handleScroll`, every claim ref, the search jump. |
| `src/modules/chat/transcript/ChatMessagesPane.tsx` | Renders the one scrolling element, binds the ref and the wheel/touch handlers it is handed, mounts the newest `INITIAL_MOUNTED_TAIL_ROWS` rows eagerly. |
| `src/modules/chat/ChatInterface.tsx` | Wires the hook to the pane, passes `handleScroll` as `onWheel`/`onTouchMove`, renders the jump-to-bottom button. |
| `src/modules/chat/hooks/useChatComposerState.ts` | `handleSubmit` clears `isUserScrolledUp` and scrolls to the bottom at +100 ms. |
| `src/modules/chat/transcript/LoadAllMessagesOverlay.tsx` | The "load all" pill that appears when the user reaches the top. |
| `src/modules/chat/transcript/LazyMessageRow.tsx` | Swaps a row's content for a placeholder of the same measured height, keeping an addressable wrapper. |
| `src/modules/chat/hooks/useLazyRowObserver.ts` | One `IntersectionObserver` per pane, rooted at the scroll container, `LAZY_ROW_VIEWPORT_MARGIN_PX = 1200`. |
| `src/modules/chat/utils/searchTargetLocator.ts` | `findSearchTargetIndex` resolves a sidebar hit against loaded data; `resolveSearchWindowSize` sizes the render window. |
| `src/modules/chat/utils/messageKeys.ts` | `getIntrinsicMessageKey` — stable render keys, so a prepend does not remount the rows below it. |
| `src/index.css` | `.chat-messages-pane` / `.chat-message` containment, mobile `touch-action`, document-level overscroll containment, `.search-highlight-flash`. |
| `src/modules/project-workspace/hooks/useVisualViewportKeyboardOffset.ts` | Publishes `--keyboard-height` so the shell shrinks above the iOS keyboard. |
| `src/shared/ui/ScrollArea.tsx` | **Not used by chat.** `FileTree.tsx` and `SidebarContent.tsx` only. |
| `src/modules/chat/tests/transcriptScrollOwnership.test.tsx` | Pins the two ownership bugs — the deferred scroll and the cross-session search jump. |
| `src/modules/chat/tests/lazyMessageRow.test.tsx` | Pins placeholder height and the hidden-tab zero-rect case. |
| `src/modules/chat/tests/searchTargetLocator.test.ts` | Pins snippet-first resolution, the timestamp fallback and the window size. |

### Who writes `scrollTop`

```mermaid
flowchart TD
  U["User wheel, touch or drag"] --> PANE["div.chat-messages-pane"]
  W1["scrollToBottom"] --> PANE
  W2["Prepend restore in useLayoutEffect"] --> PANE
  W3["Tab reactivation restore"] --> PANE
  W4["Initial settle rAF loop"] --> PANE
  W5["Search jump scrollIntoView"] --> PANE
  PANE -->|"scroll, wheel, touchmove"| HS["handleScroll"]
  HS --> FLAG["isUserScrolledUp and isUserScrolledUpRef"]
  FLAG --> W1
  FLAG --> W3
```

All five are in `useChatSessionState.ts`. A repo-wide grep for `scrollTop =`, `scrollTop +=`,
`scrollIntoView` and `scrollTo(` finds no other transcript writer — the remaining hits are
the composer's textarea highlight overlay, the command menu and the workspace tab strip.

## The single scroll container

**RULE: one element scrolls the transcript, and the component that renders it holds no
scroll state.**

`ChatMessagesPane` renders a single `div` with `ref={scrollContainerRef}`,
`onWheel={onWheel}`, `onTouchMove={onTouchMove}` and the classes
`chat-messages-pane relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden`, then a
`max-w-[54.25rem]` inner column of rows. The export menu inside it is
`sticky right-4 top-3`, which is why it stays put while the list moves. The pane is
`memo`ised, and neither it, `MessageComponent`, nor any tool view reads or writes a scroll
offset.

Three row-level scrollers do exist — `BashCommandDisplay.tsx` (`max-h-80 overflow-auto`),
`FileListContent.tsx` and `AskUserQuestionPanel.tsx` (`max-h-48 overflow-y-auto`). They are
harmless: a native `scroll` event does not bubble, so the pane's `scroll` listener never
sees them. Their `wheel` and `touchmove` events *do* bubble into `handleScroll`, which
reads the pane's own `scrollTop`/`scrollHeight` and so simply re-measures the unchanged
transcript.

`src/shared/ui/ScrollArea.tsx` is a different component with a nested inner scroller and
`touchAction: 'pan-y'`. Chat does not use it. If you are debugging chat scrolling,
`ScrollArea` is a dead end.

**Why `onWheel` and `onTouchMove` sit next to a real `scroll` listener.** They look
redundant. The comment on the `ChatMessagesPane` call site in `ChatInterface.tsx` records
why they are not: a first page is `SESSION_MESSAGES_PAGE_SIZE = 20` rows, tool results fold
into their calls, and the "load earlier" link is hidden while more pages exist — so a short
transcript is often **not scrollable at all and never emits `scroll`**. Wheel and touch are
then the only way for the user to reach the top pager or the "load all" overlay.

## Staying at the bottom

**RULE: the user is "at the bottom" when fewer than 50 px of content sit below the fold.**

`useChatSessionState.ts` → `isNearBottom` returns
`scrollHeight - scrollTop - clientHeight < 50`, and `false` when there is no container.
`handleScroll` calls it on every `scroll`, `wheel` and `touchmove` (after bailing out when
the Chat tab is inactive), writes `setIsUserScrolledUp(!nearBottom)`, and records the
current `{height, top}` into `scrollPositionRef` for the tab-reactivation restore. A
separate effect mirrors the state into `isUserScrolledUpRef` — an effect rather than an
assignment beside each setter, because `setIsUserScrolledUp` is also returned from the hook
and called by the composer.

**RULE: an append only scrolls when the user has not scrolled away, and it re-checks
before it moves.**

```mermaid
flowchart TD
  A["Follow effect runs on a change to chatMessages.length, isUserScrolledUp or isLoadingMoreMessages"] --> B{"Chat tab active and transcript non-empty"}
  B -->|"no"| Z["Do nothing"]
  B -->|"yes"| D{"Loading an older page or a restore is pending"}
  D -->|"yes"| Z
  D -->|"no"| E{"Search jump in flight"}
  E -->|"yes"| Z
  E -->|"no"| F{"isUserScrolledUp"}
  F -->|"true"| Z
  F -->|"false"| G["Arm a 50 ms timer"]
  G --> H{"isUserScrolledUpRef still false when it fires"}
  H -->|"no"| Z
  H -->|"yes"| I["Set scrollTop to scrollHeight"]
```

That is the whole auto-follow. Note what re-runs it. A new **row** re-follows; the 100 ms
streaming flushes that rewrite an existing row in place do not (see the gotchas). And
because `isUserScrolledUp` is a dependency, dropping back inside the 50 px band arms one
more scroll that finishes the trip to the bottom.

### Follow and detached

```mermaid
flowchart LR
  S["Settling — pendingInitialScrollRef is set"] -->|"height stable for 3 frames or 60 frames elapsed"| F["Following — isUserScrolledUp is false"]
  S -->|"a search target was armed for this session"| J["Jumping — searchScrollActiveRef is set"]
  F -->|"input event and the gap from the bottom is 50 px or more"| D["Detached — isUserScrolledUp is true"]
  D -->|"input event and the gap is under 50 px"| F
  D -->|"jump-to-bottom button"| F
  D -->|"user sends a message"| F
  J -->|"target row centred, then its scroll event fires"| D
  J -->|"target missing, so nothing scrolls"| F
  F -->|"session change"| S
  D -->|"session change"| S
```

`Settling` and `Jumping` are claims held in refs, not values of the flag. Note the last
`Jumping` edge: when a jump resolves to nothing, `searchScrollActiveRef` clears but the
initial settle has already been consumed, so the transcript stays wherever it rendered with
the flag still `false`.

### Scrolling up mid-stream, and getting back

**RULE: the only ways back are explicit — scroll down, press the button, or send a
message.**

While `isUserScrolledUp` is true, `ChatInterface.tsx` renders one round `ArrowDownIcon`
button floating just above the composer, gated on `isUserScrolledUp && chatMessages.length > 0`.
There is **no unread count and no new-message indicator**; the button is the whole
affordance.

Its handler is `scrollToBottomAndReset`, not `scrollToBottom`. The difference matters: when
`allMessagesLoaded` is set (the user pulled the whole transcript in), it also drops
`visibleMessageCount` back to `INITIAL_VISIBLE_MESSAGES = 100` and clears
`allMessagesLoaded`. Jumping to the bottom throws away the widened render window on
purpose — the window only existed to reach something far up.

```mermaid
sequenceDiagram
    participant U as User
    participant P as Pane
    participant H as handleScroll
    participant W as Realtime
    participant S as Store
    participant E as FollowEffect

    U->>P: drag upward
    P->>H: scroll event
    H->>H: gap is 50 px or more, set isUserScrolledUp true
    W->>S: stream_delta flush every 100 ms
    S->>E: same row rewritten, so the row count is unchanged
    E->>E: effect does not re-run
    W->>S: a tool_use row arrives
    S->>E: row count changed, effect runs
    E->>E: isUserScrolledUp is true, no timer armed
    U->>P: press jump-to-bottom
    P->>P: scrollToBottomAndReset sets scrollTop to scrollHeight
    P->>H: scroll event
    H->>H: gap is under 50 px, set isUserScrolledUp false
```

## Deferred scrolls re-check intent

**RULE: a scroll armed on a timer must re-read `isUserScrolledUpRef` before it moves
anything.**

| Where | Delay | Re-checks? |
| --- | --- | --- |
| Append follow effect (`useChatSessionState.ts`) | 50 ms | yes — `if (!isUserScrolledUpRef.current)` |
| External-update refresh (same file, the `externalMessageUpdate` effect) | 200 ms | yes — same guard, and only armed when `isNearBottom()` held before the refetch |
| Composer send (`useChatComposerState.ts` → `handleSubmit`) | 100 ms | **no** — it sets the flag false itself, then calls `scrollToBottom()` unconditionally |

The first two used to fire unconditionally. Commit `a1a42774` describes the failure:
scrolling up inside the delay was silently undone, and because a programmatic scroll itself
emits a `scroll` event, the resulting `handleScroll` reset `isUserScrolledUp` to false and
hid the jump-to-bottom button too. The user was returned to the bottom *and* lost the
control that would have explained why.

`transcriptScrollOwnership.test.tsx` pins both directions on fake timers, driving the real
hook against a hand-built container (jsdom has no layout, so `scrollHeight`/`clientHeight`
are stubbed and `scrollTop` writes are recorded):

- *"does not yank the view back down when the user scrolls up inside the delay"* — appends
  a row, flips the flag, advances 200 ms, asserts **zero** writes.
- *"still sticks to the bottom when the user has not scrolled away"* — same setup without
  the flip, asserts a write of `scrollHeight`.

The test stubs `requestAnimationFrame` to a no-op on purpose: the initial-settle loop is a
separate writer that would otherwise satisfy an assertion meant for the timer.

The composer send is deliberately unguarded — the user pressed Enter, so the intent is
fresh. The cost is that scrolling up within 100 ms of sending is undone.

## Reaching the top: the pager, the lock and the overlay

**RULE: the top 100 px is a trigger zone, and it fires at most once per visit.**

The second half of `handleScroll` computes `scrolledNearTop = container.scrollTop < 100`
and runs two independent latches off it.

```mermaid
flowchart TD
  A["handleScroll, with scrolledNearTop true"] --> B{"hasMoreMessages and not allMessagesLoaded"}
  B -->|"no"| C["Leave the overlay alone"]
  B -->|"yes"| D{"wasNearTopRef already set"}
  D -->|"yes"| C
  D -->|"no"| E["Set wasNearTopRef, show the load-all overlay, hide it again after 2500 ms"]
  A --> F{"allMessagesLoaded"}
  F -->|"yes"| G["Stop, nothing left to page"]
  F -->|"no"| H{"topLoadLockRef set"}
  H -->|"yes"| I["Release the lock once scrollTop is above 20, then stop"]
  H -->|"no"| J["await loadOlderMessages, and take the lock if a page was prepended"]
```

- **`wasNearTopRef`** debounces the overlay so it appears once when the user arrives at the
  top, not on every scroll event there. It is cleared as soon as `scrolledNearTop` goes
  false. The 2500 ms hide timer in the hook is matched by the overlay's own
  `loadAllOverlayAutoFade 2500ms` animation in `LoadAllMessagesOverlay.tsx`, so the pill
  fades out exactly as the state clears.
- **`topLoadLockRef`** stops a page load from immediately triggering the next one. After a
  successful prepend the restore leaves you near the top again, which would satisfy
  `scrolledNearTop` on the very next event. The lock is only released once
  `container.scrollTop > 20` — the user must actively move away from the very top before
  another page is fetched. Note the asymmetry: entering the zone is `< 100`, leaving the
  lock is `> 20`.

`loadAllMessages` (the overlay's button) takes a different path: it fetches the whole
transcript with `limit: null`, sets `visibleMessageCount` to `Infinity`, captures a scroll
anchor first, and shows a green "all loaded" pill for 2500 ms.

## Restoring position after a prepend

**RULE: prepending rows must not move content under the user's eyes. Position is restored
from an anchor element, not from a scroll offset.**

`loadOlderMessages` calls `captureScrollRestoreState(container)` *before* the fetch. That
records four things: `scrollHeight`, `scrollTop`, an anchor element, and that anchor's
offset from the container's top edge. The anchor is the first `.chat-message` whose
`getBoundingClientRect().bottom` is at or past the container's top edge — in plain terms,
the topmost row that is not entirely scrolled off.

After `sessionStore.fetchMore` reports `prependedCount > 0`, the captured state is parked in
`pendingScrollRestoreRef` and `visibleMessageCount` grows by `SESSION_MESSAGES_PAGE_SIZE`. A
`useLayoutEffect` — before paint — drains it:

| Case | Correction |
| --- | --- |
| Anchor still in the DOM (`anchor.isConnected`) and its offset was recorded | `scrollTop += newAnchorOffset - oldAnchorOffset` |
| No anchor, or it is gone | `scrollTop = oldTop + max(newScrollHeight - oldHeight, 0)` |

The anchor path is the accurate one; the height-delta path is the fallback. What keeps the
anchor alive across the prepend is **stable keys**: `ChatMessagesPane` builds a
`messageKeyMap` each render from `getIntrinsicMessageKey`, disambiguated by occurrence index
on collision. Its comment states the reason — a server refresh replaces source records with
equivalent new objects, so object identity is not a durable React key across pagination or
hydration. The key falls back through `id`, `messageId`, `toolId`, `toolCallId`, `blobId`,
`rowid`, `sequence`, and only then to a timestamp-plus-content-prefix string.

The same mechanism is reused by `loadAllMessages`. While `pendingScrollRestoreRef` is set,
the append-follow effect declines outright — a prepend must never be mistaken for an
append — and the restore branch of the `useLayoutEffect` returns early, so a pending restore
also beats the tab-reactivation restore in the same commit.

## Opening a session, switching, and coming back

**RULE: each programmatic scroll stakes a claim, and every other writer checks it.**

| Trigger | Mechanism | Claim ref |
| --- | --- | --- |
| Opening a session | rAF settle loop | `pendingInitialScrollRef` |
| Returning to the Chat tab | `useLayoutEffect` reactivation branch | — |
| Older page prepended | `useLayoutEffect` restore branch | `pendingScrollRestoreRef` |
| Sidebar search hit | `scrollIntoView` retry chain | `searchScrollActiveRef` |
| Expanding a tool view | nothing — pure layout change | — |

### Opening a session

A single `scrollToBottom()` at +200 ms used to be enough. It is not: markdown blocks, code
highlighting and images finish rendering after that window, `scrollHeight` grows, and
nothing re-anchors — the tab opens visually "scrolled way up" with the newest assistant
message off screen. The current effect runs a `requestAnimationFrame` loop that sets
`scrollTop = scrollHeight` **every frame**, counting frames and consecutive stable heights;
it stops at **3 consecutive stable frames or 60 frames (~1 s)**, whichever comes first, and
then clears `pendingInitialScrollRef`. The loop is cancelled by the effect's own cleanup
calling `cancelAnimationFrame`; the session-change effect *re-arms*
`pendingInitialScrollRef` to `true` rather than clearing it.

It is helped by `INITIAL_MOUNTED_TAIL_ROWS = 30` in `ChatMessagesPane.tsx`: the newest 30
rows mount with real content on the first commit, so the loop measures real heights at the
bottom rather than placeholder estimates.

The loop declines entirely if `searchScrollActiveRef` is set — a session opened from a
search hit is not supposed to land at the bottom.

### Switching sessions

The session-change effect (keyed on `selectedProject?.projectId` and `selectedSession?.id`)
clears the pending search timer, clears `searchScrollActiveRef` and `searchTarget`, nulls
`pendingScrollRestoreRef`, clears `topLoadLockRef` and `wasNearTopRef`, re-arms
`pendingInitialScrollRef`, resets `visibleMessageCount` to `INITIAL_VISIBLE_MESSAGES`, and
sets `isUserScrolledUp` to false. Its comment records that ordering is load-bearing: the
effect that reads `__searchTargetSnippet` off the newly selected session runs *after* this
one, so a session opened *from* a search result re-arms immediately.

### Returning to the Chat tab

The chat tree stays mounted behind Tailwind's `hidden` (`display: none`) when another
workspace tab is active (`WorkspaceMain.tsx`, which also passes `isActive`). An effect with
no dependency array records `{height, top}` into `scrollPositionRef` after every render
while the tab is active, and the `useLayoutEffect` reactivation branch — recognised through
`wasChatActiveRef` — restores `scrollPositionRef.current.top` when detached, or
`container.scrollHeight` when following. Hidden tabs must not reset pagination or scroll:
`handleScroll`, the restore branch and the settle loop all bail out on `!isActive`.

## Jumping to a search hit

**RULE: resolve the target in the data first; only then look for its row, and only ever by
exact timestamp until the final try.**

The sidebar (`Sidebar.tsx`, `onConversationResultClick`) puts `__searchTargetSnippet` and
`__searchTargetTimestamp` on the selected session object. The jump then:

1. Sets `searchScrollActiveRef` — the initial settle and the append-follow both stand down.
   The arming effect requires a non-empty snippet string; without one there is no jump.
2. Fetches the **entire** transcript into the store (`limit: null`) so an old hit is
   reachable, without rendering all of it.
3. Resolves the index against the loaded data, not the DOM:
   `searchTargetLocator.ts` → `findSearchTargetIndex`. The snippet is authoritative —
   normalised, ellipsis-stripped, lower-cased, `MIN_SNIPPET_LENGTH = 10`,
   `MAX_SNIPPET_LENGTH = 80`, matched against `displayText`, `content`, string `toolInput`
   and string tool-result content. **Only if the snippet misses** does the timestamp take
   over, and it returns the *nearest* message by time, not an exact match. `-1` — and
   therefore no scroll at all — happens only when the snippet misses *and* there is no
   finite timestamp. `searchTargetLocator.test.ts` pins both halves: *"a snippet that
   matches nothing reports a miss instead of guessing"* and *"the timestamp is only a
   fallback when the snippet misses"*.
4. Widens the render window with
   `resolveSearchWindowSize(count, index, SEARCH_TARGET_CONTEXT_MESSAGES = 20)`, applied as
   `Math.max(previous, required)` so the window never shrinks. `visibleMessages` is a tail
   slice, so covering index N means rendering everything after it.
5. Waits 150 ms for React to commit, then looks the row up by `data-message-timestamp` and
   calls `scrollIntoView({ block: 'center', behavior: 'smooth' })` plus a
   `search-highlight-flash` class removed after 4000 ms.

**The retry budget.** `SEARCH_SCROLL_RETRIES = 20` is the starting value of `retriesLeft`,
and there is a leading `setTimeout` before the first attempt, so the chain is **21 attempts
spaced `SEARCH_SCROLL_RETRY_DELAY_MS = 150` apart — about 3.15 s in total**. The budget is
that long because widening the window can commit thousands of rows that each run the
markdown pipeline.

**Why `allowNearest` exists.** `findRenderedMessageElement` is called with
`allowNearest = (retriesLeft === 0)`, so every attempt but the last accepts an **exact**
timestamp match only. The final attempt relaxes to nearest-by-time because a hit on the
second or later call inside a collapsed tool group has no row of its own:
`groupConsecutiveTools` stamps the group item with the **first** message's timestamp
(`toolGrouping.ts`), so the group row is the nearest match, never an exact one.

### Expanding a tool view

Nothing scrolls. There is no `scrollIntoView` anywhere under
`src/modules/chat/transcript/` or the tool renderers. Expansion is a layout change the
browser's own scroll anchoring absorbs; if the row later unmounts, `LazyMessageRow` records
the expanded height first.

## Lazy rows and height stability

**RULE: unmounting a row's content must not change the scroll geometry.**

`LazyMessageRow` wraps every transcript row in a permanent lightweight `div` carrying
`data-message-timestamp`. The expensive subtree mounts only while the row is within
`LAZY_ROW_VIEWPORT_MARGIN_PX = 1200` of the viewport, tracked by one shared
`IntersectionObserver` per pane rooted at the scroll container (`useLazyRowObserver.ts`).

Three details exist purely to protect the scroll position:

1. **Measure before unmount.** `handleNearViewportChange` reads `offsetHeight` *while the
   content is still in the DOM*, then renders the placeholder at exactly that height. A row
   you have already seen costs nothing in geometry to scroll back through.
2. **The wrapper stays addressable.** The search jump queries `[data-message-timestamp]`,
   which the wrapper carries whether or not its content is mounted. **This does not extend
   to the prepend anchor:** `captureScrollRestoreState` queries `.chat-message`, and that
   class is on `MessageComponent` / `ToolGroupContainer`, *inside* the wrapper's children —
   so the anchor scan only ever picks a currently mounted row. It works in practice because
   the rows around the viewport are exactly the mounted ones.
3. **Zero-sized rects are ignored.** A hidden Chat tab (`display: none`) reports
   `isIntersecting: false` with a `0x0` rect. Treating that as "scrolled away" would wipe
   every row's mounted state and its measured height. `lazyMessageRow.test.tsx` pins this
   as *"ignores the zero-rect non-intersections a hidden tab reports"*.

Rows never yet measured fall back to `ESTIMATED_ROW_HEIGHT_PX = 100` and rely on the
browser's own scroll anchoring while they settle.

CSS does a second pass of the same idea in `src/index.css`:

```css
.chat-messages-pane { contain: layout style paint; }
.chat-message { contain: layout style paint; content-visibility: auto; contain-intrinsic-size: auto 180px; }
.chat-message.assistant { contain-intrinsic-size: auto 240px; }
.chat-message.user, .chat-message.tool, .chat-message.error { contain-intrinsic-size: auto 96px; }
```

The `auto` keyword in `contain-intrinsic-size` makes the browser remember each row's last
rendered size, so skipping an off-screen row's rendering does not resize it.

The repo **never sets `overflow-anchor`**, so the browser default (`auto`) stays in effect
for everything the JS does not explicitly restore — which is what absorbs a tool card
expanding or a code block finishing highlighting.

## Mobile, keyboard and CSS

**RULE: the document never scrolls; only the pane does.**

| Rule | File | Why |
| --- | --- | --- |
| `html, body { overflow: hidden; overscroll-behavior-y: contain; }` | `src/index.css` | The shell is a `fixed inset-0` container, so the document never needs to scroll. Clipping it removes the phantom full-height scrollbar and disables mobile pull-to-refresh. |
| `* { touch-action: manipulation; }` under `max-width: 768px` | `src/index.css` | Kills the 300 ms tap delay — and would kill scrolling, which is why the next two rules exist. |
| `.overflow-y-auto { touch-action: pan-y; -webkit-overflow-scrolling: touch; }` | `src/index.css` | Re-asserts vertical panning and momentum for the pane. |
| `.chat-message { touch-action: pan-y; }` | `src/index.css` | Same, for the rows themselves. |
| `--keyboard-height` from `visualViewport.resize` | `useVisualViewportKeyboardOffset.ts` | `ProjectWorkspaceShell.tsx` applies it as `style={{ bottom: 'var(--keyboard-height, 0px)' }}`, so the fixed shell shrinks above the iOS keyboard instead of being covered by it. |
| `@media (prefers-reduced-motion: reduce) { scroll-behavior: auto !important; }` | `src/index.css` | The only `scroll-behavior` declaration in the repo. Nothing sets `smooth` in CSS. |

`scrollToBottom` is an instant `scrollTop = scrollHeight` assignment. The only smooth scroll
in the transcript is the search jump's explicit `behavior: 'smooth'`.

The pane's bottom padding switches between `pb-12 sm:pb-14` and `pb-3 sm:pb-4` depending on
`hasActivityIndicator` — the composer's floating activity/stop tab overlaps the pane, so the
padding reserves space for it. That toggle changes the pane's usable height without emitting
a scroll event.

## Gotchas and why the code looks like this

- **Streaming text does not re-follow, but the first flush does.** `updateStreaming` in
  `useSessionStore.ts` writes a row with the well-known id `__streaming_<sessionId>`. The
  first flush appends it, so `chatMessages.length` changes once and the follow effect runs.
  Every flush after that replaces the same array slot, so the length is unchanged and the
  effect stays quiet. Within one streamed block the pane is held by the browser, not by this
  code.
- **`stream_end` does not re-follow either.** `finalizeStreaming` rewrites the same slot in
  place, changing only the id, `kind` and `role`; both `stream_delta` and an assistant
  `text` map to exactly one row in `normalizedToChatMessages`. The length never moves, so
  the effect does not re-run. What re-follows is the *next* row — a tool call, or the next
  streamed block, which allocates a fresh `__streaming_` id.
- **`isUserScrolledUp` can be stale.** It is only recomputed from `scroll`, `wheel` and
  `touchmove`. Content growing below the fold does not move `scrollTop`, so no event fires,
  the flag stays `false`, and the jump-to-bottom button stays hidden even though the newest
  content is off screen. Same for the keyboard opening and for the activity indicator's
  padding toggle.
- **A programmatic scroll emits a `scroll` event.** Every `scrollTop` write feeds back
  through `handleScroll` and rewrites the flag. That is why the deferred writers guard
  themselves — an unguarded write both moves the user *and* erases the evidence that they
  had scrolled away.
- **The pager's two thresholds are deliberately different.** You enter the trigger zone at
  `scrollTop < 100` but only release `topLoadLockRef` at `scrollTop > 20`. If both were 100,
  the restore after a prepend — which lands you near the top by design — would immediately
  fetch the next page, and a long session would drain in one gesture.
- **`loadEarlierMessages` has no scroll restore.** It just does
  `setVisibleMessageCount(prev + 100)` on already-loaded messages, so `chatMessages.length`
  never changes and neither the follow effect nor the restore `useLayoutEffect` runs. Only
  the browser's native scroll anchoring holds the position there. `loadOlderMessages` and
  `loadAllMessages` both capture an anchor; this one does not.
- **A search jump left armed across a session change was visibly wrong twice.** The new
  session opened part-way up (the initial settle declines while a jump is pending), and then
  once the retries ran out and `allowNearest` engaged, it scrolled to an unrelated message
  in the *new* session and flashed the highlight on it.
  `transcriptScrollOwnership.test.tsx` → *"does not follow the user into the next session"*
  drives exactly that: it plants a session-B row in the container, lets the jump start
  retrying against session A, switches sessions, advances past the whole retry budget, and
  asserts zero `scrollIntoView` calls and zero `.search-highlight-flash` elements.
- **The nearest-row fallback is not laziness.** It was removed from the early attempts
  (commit `0a19ad8a`) because an uncommitted window made it scroll to an arbitrary message —
  the exact failure the rewrite was meant to remove. It survives on the final attempt only,
  because that is what maps a hit inside a collapsed tool group onto its group row.
- **The initial scroll is a loop, not a timeout.** One `scrollToBottom()` at +200 ms lost
  the race against late markdown, highlighting and image layout. The rAF loop with a
  3-stable-frame / 60-frame cap is the fix.
- **Lazy rows exist for memory, and pay for it in scroll correctness.** Commit `f537a3a9`:
  "Load all" on a long session used to commit thousands of markdown/tool subtrees at once and
  grow the tab toward a gigabyte. With the 29k-row fixture the tab now holds ~112 MB with a
  few dozen mounted rows instead of ~1 GB with seven thousand. Every geometry guarantee in
  `LazyMessageRow` — measure-before-unmount, permanent wrapper, zero-rect filter — exists to
  make that trade invisible.
- **`content-visibility: auto` is overridden for exports.**
  `src/modules/chat/export/buildTranscriptHtml.tsx` emits
  `.chat-message { content-visibility: visible !important; contain-intrinsic-size: auto !important; }`
  with the comment "off-screen skipping is a scrolling optimisation; in a printed document it
  leaves blank pages."
- **Where `IntersectionObserver` does not exist (jsdom), every row stays mounted.**
  `useLazyRowObserver` returns `null` and `LazyMessageRow` treats that as "always mounted".
  Tests that need the lazy path install a stub observer and drive it by hand.

## If you change this, check that

| If you touch | Also check |
| --- | --- |
| The 50 px threshold in `isNearBottom` | The follow effect, the tab-reactivation branch and the jump-to-bottom button all read the same flag. |
| The `< 100` top zone or the `> 20` lock release | `topLoadLockRef` must still need an explicit move away from the top, or paging runs away. |
| `chatMessages` shape or identity | The follow effect and the restore/reactivation `useLayoutEffect` are both keyed on `chatMessages.length`; in-place row rewrites are invisible to both. |
| Anything that adds a deferred scroll | It must re-read `isUserScrolledUpRef` at fire time, or `transcriptScrollOwnership.test.tsx` should fail. |
| `getIntrinsicMessageKey` or the key map in `ChatMessagesPane` | The prepend restore needs the anchor element to survive; unstable keys remount rows and drop it to the height-delta fallback. |
| `LazyMessageRow` placeholder height, the `.chat-message` class placement, or the 1200 px observer margin | Prepend anchor scan, search-jump row lookup, and `lazyMessageRow.test.tsx`. |
| `SEARCH_SCROLL_RETRIES`, the retry delay, or `findRenderedMessageElement` | The cross-session cancellation test and `searchTargetLocator.test.ts`; `allowNearest` must stay on the final attempt only. |
| `.chat-message` containment or `content-visibility` | The export override in `buildTranscriptHtml.tsx` mirrors these declarations. |
| Session load or pagination in `useChatSessionState.ts` | `pendingScrollRestoreRef`, `pendingInitialScrollRef`, `searchScrollActiveRef`, `topLoadLockRef` and `wasNearTopRef` are all handled by the session-change effect — see [the message store](./04-message-store-and-lazy-loading.md). |
| Composer send or the activity indicator | `handleSubmit` forces `isUserScrolledUp` false and scrolls unconditionally at +100 ms; the indicator changes the pane's padding without a scroll event. |
| Tool card expand/collapse | Nothing scrolls today — see [tool views](./06-tool-view.md). Adding a `scrollIntoView` there adds a sixth writer with no claim ref. |

Related: [the realtime stream](./02-realtime-stream.md) for how rows arrive.
