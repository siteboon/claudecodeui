# Agent Todo Status Strip Design

Date: 2026-07-06

## Goal

Show the current todo state of the active agent group inside the CloudCLI chat UI, close to the existing run status.

## Decision

Use a compact status strip directly above the chat composer, in the same area as `Working` / `Thinking`.

This is v1. It is not a dashboard.

## Sources

Reuse existing todo events:

- Claude-compatible `TodoWrite`
- Claude-compatible `TodoRead`
- Codex-compatible `todo_list`

No new task system, persistence layer, or event protocol.

## Scope

The strip shows only the currently opened chat session, including subagents when their todo events are already present in the session messages.

## UI

Each visible agent gets one compact item:

- agent label
- current `in_progress` todo text
- counts for completed and pending todos
- last updated age

Clicking an item expands the current todo list inline, reusing the existing todo-list rendering where possible.

## Empty State

Show nothing when the session has no todo data.

## Excluded From v1

- todo history
- global dashboard
- persistence across sessions beyond existing chat data
- external sharing
- new artifact or mockup mechanism
- new server API

## Testing

Add the smallest useful tests around the todo-summary extraction logic:

- Claude `TodoWrite` shape
- Codex `todo_list` shape
- latest snapshot wins

