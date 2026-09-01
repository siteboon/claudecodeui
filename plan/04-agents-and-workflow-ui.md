# 04 — Agent grouping and the Workflow container UI

**Status:** OPEN · **Depends on:** `03` (lifecycle events), `02` (events surviving)
**Findings:** O15–O17 · **Upstream:** unclaimed

## Start from what already exists

`#1206` landed a real subagent model. Do **not** rebuild it:

- History enrichment builds `subagentsById` (`claude-sessions.provider.ts:439`)
  into `msg.subagent` + `msg.subagentTools`, and already knows the newer
  `subagents/agent-*.jsonl` layout (`:202`).
- Live folding by `parentToolUseId` exists (`useChatMessages.ts:100-135`).
- `isSubagentContainer` (`:262`) checks `Boolean(msg.subagent)` first, falling
  back to a `Task`/`Agent` name match.
- `SubagentPanel.tsx` is a 242-line collapsible panel with real
  running/completed/failed status (`STATUS_STYLES:64`, derived at `:123`).

Agent display is the one goal already in decent shape. `SubagentPanel` is the
building block to extend — not to replace.

## The defects

**O15 — folding is single-level and flat.** Every row sharing a
`parentToolUseId` lands in one undifferentiated activity array
(`liveSubagentActivity.get(parentId)`). A `Workflow` running dozens of agents
collapses into **one flat list with no per-agent separation**. This is the core
reason `Workflow` runs are unreadable.

**O16 — long agents get truncated.** `MAX_TRANSMITTED_SUBAGENT_ACTIVITIES = 200`
(`claude-sessions.provider.ts:35`). Defensible for one agent; wrong for a
`Workflow` container aggregating many.

**O17 — the `Workflow` card is a script dump.** `toolConfigs.ts:260` renders the
script into a collapsible and nothing else — no phases, no agent tree, no
progress.

## Approach

1. **Key by agent, not just parent.** Live folding needs a second level:
   `parentToolUseId` → agent id → that agent's activity. The history side
   already has per-agent identity in `subagentsById`; live folding throws it
   away. Establishing where the live agent id comes from is the first
   investigation step — it may require `03`.
2. **A `Workflow` container that composes `SubagentPanel`s**, ideally grouped by
   the workflow's own phases (`phase()` / `meta.phases`) when those are
   available, falling back to a flat agent list.
3. **Revisit the 200-cap** for containers — likely per-agent rather than
   per-container.

### Open questions

- Does the SDK stamp `parent_tool_use_id` on a `Workflow`'s agents pointing at
  the `Workflow` tool call, or at an intermediate? Unverified. Everything above
  depends on the answer — **check this against a real transcript first.**
- Are workflow phase names reachable from the stream at all, or only from the
  script we already have in the tool input?

## Verification

Run a real `Workflow` with several parallel subagents. Check: agents appear
separately rather than as one flat list; nothing evaporates past 500 events
(`02`/O9); the container stays readable at a few dozen agents.
