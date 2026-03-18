# Clean Conversation View Mode

## Problem

When viewing Claude Code session history in the UI, the conversation is cluttered with content that the terminal hides: skill definitions (2-11KB each) rendered as full user messages, `<system-reminder>` blocks embedded in user text, and consecutive read-only tool calls that obscure the actual conversation flow. This makes auditing sessions significantly harder than reading them in the terminal.

## Solution

Add a **clean/raw view toggle** (clean as default) that filters noise and collapses read-only tool operations while preserving code-change visibility.

## View Modes

### Clean Mode (default)

1. **Skill definitions** shown as a compact chip: `Loaded skill: server-debugging`
2. **System reminders** stripped from user message text (regex removal of `<system-reminder>...</system-reminder>` blocks)
3. **Read-only tools** (Read, Grep, Glob, WebSearch, WebFetch, Skill, TaskCreate, TaskUpdate, TaskGet, TaskList, TaskOutput, ToolSearch, Agent, LSP) collapsed into a summary line per consecutive group, expandable on click
4. **Code-change tools** (Edit, Write, Bash, NotebookEdit, ApplyPatch) remain fully visible with diffs/output
5. **Thinking blocks** hidden by default (existing toggle still works)
6. **`<local-command-caveat>`, `<local-command-stdout>`, `<command-name>`, `<command-args>`** stripped from user text

### Raw Mode

Current behavior unchanged. All content visible including skill text, system reminders, all tool details.

## Detection Rules

### Skill Definition Detection

User messages where text content starts with `"Base directory for this skill:"` are skill loads. Extract skill name from the path (last segment before any filename). Convert to a `ChatMessage` with `isSkillLoad: true` and `skillName: string`.

### System Reminder Stripping

Regex: `/<system-reminder>[\s\S]*?<\/system-reminder>/g`

Applied to user message text parts. If after stripping all reminders the text is empty, skip the message entirely.

### Embedded Noise Tag Stripping

Also strip these patterns from user text:
- `<local-command-caveat>[\s\S]*?<\/local-command-caveat>`
- `<local-command-stdout>[\s\S]*?<\/local-command-stdout>`

### Read-Only Tool Grouping

Consecutive tool-use messages where `toolName` is in the read-only set get grouped. The group breaks when:
- A text message (user or assistant) appears
- A code-change tool appears
- A non-tool message appears

Group display: `"Research: Read 3 files, Grep 2 patterns, Glob 1 search"` — clicking expands to show individual tool calls with their existing rendering.

## Data Model Changes

### ChatMessage type additions

```typescript
interface ChatMessage {
  // ... existing fields
  isSkillLoad?: boolean;
  skillName?: string;
}
```

### New component props

```typescript
interface CollapsedToolGroupProps {
  tools: ChatMessage[];
  isExpanded: boolean;
  onToggle: () => void;
}

interface SkillLoadChipProps {
  skillName: string;
  timestamp: string;
}
```

## View Mode State

- State: `viewMode: 'clean' | 'raw'`
- Stored in `localStorage` key `ccui-view-mode`
- Default: `'clean'`
- Toggle: button in chat toolbar area (eye icon or similar)
- The toggle controls which messages are visible and how they render; the underlying message data is unchanged

## Files to Modify

| File | Change |
|------|--------|
| `src/components/chat/utils/messageTransforms.ts` | Skill detection, system-reminder/noise stripping |
| `src/components/chat/types/types.ts` | `isSkillLoad`, `skillName` fields |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` | viewMode state, grouping logic, toggle UI |
| `src/components/chat/view/subcomponents/MessageComponent.tsx` | Skill chip rendering, respect viewMode |
| New: `src/components/chat/view/subcomponents/CollapsedToolGroup.tsx` | Summary line with expand/collapse |
| New: `src/components/chat/view/subcomponents/SkillLoadChip.tsx` | Compact skill indicator |

## Files NOT Modified

- `server/projects.js` — server-side parsing unchanged
- `src/components/chat/tools/configs/toolConfigs.ts` — tool configs unchanged
- `src/components/chat/tools/ToolRenderer.tsx` — tool rendering unchanged (used when expanded)

## Edge Cases

- User message contains both real text AND a system-reminder: strip reminder, keep text
- User message is ONLY a system-reminder after stripping: skip entirely
- Skill definition is the only content in a user message: replace with chip
- Multiple skill loads in sequence: each gets its own chip
- A Bash tool that only reads (e.g., `ls`, `cat`) vs one that writes: we classify ALL Bash as code-change since we can't reliably distinguish. This is intentional — Bash commands are worth seeing.
- Agent tool calls: classified as read-only (collapsed) since they spawn subagents whose results appear separately
