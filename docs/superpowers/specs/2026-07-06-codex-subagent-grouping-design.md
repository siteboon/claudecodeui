# Codex Subagent Grouping Design

Date: 2026-07-06

## Goal

Keep Codex subagent transcripts out of the top-level session tree and show them inside their parent chat session.

## Decision

Use Codex transcript metadata as the source of truth:

- Parent sessions stay as normal sidebar sessions.
- Transcripts with `payload.thread_source === "subagent"` are internal child sessions.
- Child transcripts link to the parent through `payload.parent_thread_id` or `payload.source.subagent.thread_spawn.parent_thread_id`.

## UI

Show each subagent inside the parent chat as a collapsed agent block, reusing the existing subagent/tool rendering where possible.

The block should expose:

- agent nickname or role when present
- final agent answer when present
- child tools when available
- todo snapshots through the existing todo list summary/rendering path

Do not add a new sidebar section, drawer, or dashboard.

## Sidebar Behavior

The Codex session synchronizer must not create top-level session rows for subagent transcripts.

Existing polluted rows can be cleaned separately. The first implementation only prevents new pollution.

## Data Flow

1. Codex synchronizer scans `~/.codex/sessions/**/*.jsonl`.
2. It skips transcripts whose first `session_meta` payload marks `thread_source` as `subagent`.
3. Codex history loading for a parent session finds child transcripts whose parent id matches the parent provider session id.
4. Child transcript events are converted into the existing `subagentTools` shape already consumed by the chat UI.
5. The frontend continues deriving todo summaries from normal tool and subagent tool messages.

## Scope

Included:

- Codex subagent transcript detection
- Codex sidebar indexing filter
- Parent-chat grouping for Codex subagents
- Minimal tests for filtering and grouping

Excluded:

- Grouping normal resumed sessions
- New sidebar nesting UI
- New persistence schema
- Global subagent dashboard
- Bulk cleanup of old polluted rows

## Testing

Add focused tests:

- Codex synchronizer skips `thread_source: "subagent"` transcripts.
- Codex parent history attaches matching child transcript tools.
- Existing todo summary tests continue to pass.
