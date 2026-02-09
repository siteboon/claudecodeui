# Tool Rendering System

## Overview

Config-driven architecture for rendering tool executions in chat. All tool display behavior is defined in `toolConfigs.ts` — no scattered conditionals. Two base display patterns: **OneLineDisplay** for compact tools, **CollapsibleDisplay** for tools with expandable content.

Non-error tool results route through `ToolRenderer` with `mode="result"` (single source of truth). Error results are handled inline in `MessageComponent` with a red error box.

---

## Architecture

```
tools/
├── components/
│   ├── OneLineDisplay.tsx          # Compact one-line tool display
│   ├── CollapsibleDisplay.tsx      # Expandable tool display (uses children pattern)
│   ├── CollapsibleSection.tsx      # <details>/<summary> wrapper
│   ├── ContentRenderers/
│   │   ├── DiffViewer.tsx          # File diff viewer (memoized)
│   │   ├── MarkdownContent.tsx     # Markdown renderer
│   │   ├── FileListContent.tsx     # Comma-separated clickable file list
│   │   ├── TodoListContent.tsx     # Todo items with status badges
│   │   ├── TaskListContent.tsx     # Task tracker with progress bar
│   │   └── TextContent.tsx         # Plain text / JSON / code
├── configs/
│   └── toolConfigs.ts              # All tool configs + ToolDisplayConfig type
├── ToolRenderer.tsx                # Main router (React.memo wrapped)
└── README.md
```

---

## Display Patterns

### OneLineDisplay

Used by: Bash, Read, Grep, Glob, TodoRead, TaskCreate, TaskUpdate, TaskGet

Renders as a single line with `border-l-2` accent. Supports multiple rendering modes based on `action`:

- **terminal** (`style: 'terminal'`) — Dark pill around command text, green `$` prompt
- **open-file** — Shows filename only (truncated from full path), clickable to open
- **jump-to-results** — Shows pattern with anchor link to result section
- **copy** — Shows value with hover copy button
- **none** — Plain display

```tsx
<OneLineDisplay
  toolName="Read"
  icon="terminal"           // Optional icon or style keyword
  label="Read"              // Tool label
  value="/path/to/file.ts"  // Main display value
  secondary="description"   // Optional secondary text (italic)
  action="open-file"        // Action type
  onAction={() => ...}      // Click handler
  colorScheme={{             // Per-tool colors
    primary: 'text-...',
    border: 'border-...',
    icon: 'text-...'
  }}
  resultId="tool-result-x"  // For jump-to-results anchor
  toolResult={...}          // For conditional jump arrow
  toolId="x"                // Tool use ID
/>
```

### CollapsibleDisplay

Used by: Edit, Write, ApplyPatch, Grep/Glob results, TodoWrite, TaskList/TaskGet results, ExitPlanMode, Default

Wraps `CollapsibleSection` (`<details>`/`<summary>`) with a `border-l-2` accent colored by tool category. Accepts **children** directly (not contentProps).

```tsx
<CollapsibleDisplay
  toolName="Edit"
  toolId="123"
  title="filename.ts"           // Section title (can be clickable)
  defaultOpen={false}
  onTitleClick={() => ...}      // Makes title a clickable link (for edit tools)
  showRawParameters={true}      // Show raw JSON toggle
  rawContent="..."              // Raw JSON string
  toolCategory="edit"           // Drives border color
>
  <DiffViewer {...} />          // Content as children
</CollapsibleDisplay>
```

**Tool category colors** (via `border-l-2`):
| Category | Tools | Color |
|----------|-------|-------|
| `edit` | Edit, Write, ApplyPatch | amber |
| `bash` | Bash | green |
| `search` | Grep, Glob | gray |
| `todo` | TodoWrite, TodoRead | violet |
| `task` | TaskCreate/Update/List/Get | violet |
| `plan` | ExitPlanMode | indigo |
| `default` | everything else | neutral gray |

---

## Content Renderers

Specialized components for different content types, rendered as children of `CollapsibleDisplay`:

| contentType | Component | Used by |
|---|---|---|
| `diff` | `DiffViewer` | Edit, Write, ApplyPatch |
| `markdown` | `MarkdownContent` | ExitPlanMode |
| `file-list` | `FileListContent` | Grep/Glob results |
| `todo-list` | `TodoListContent` | TodoWrite, TodoRead |
| `task` | `TaskListContent` | TaskList, TaskGet results |
| `text` | `TextContent` | Default fallback |
| `success-message` | inline SVG | TodoWrite result |

---

## Adding a New Tool

**Step 1:** Add config to `configs/toolConfigs.ts`

```typescript
MyTool: {
  input: {
    type: 'one-line',              // or 'collapsible'
    label: 'MyTool',
    getValue: (input) => input.some_field,
    action: 'open-file',
    colorScheme: {
      primary: 'text-purple-600 dark:text-purple-400',
      border: 'border-purple-400 dark:border-purple-500'
    }
  },
  result: {
    hideOnSuccess: true            // Only show errors
  }
}
```

**Step 2:** If the tool needs a category color, add it to `getToolCategory()` in `ToolRenderer.tsx`.

**That's it.** The ToolRenderer auto-routes based on config.

---

## Configuration Reference

### ToolDisplayConfig

```typescript
interface ToolDisplayConfig {
  input: {
    type: 'one-line' | 'collapsible' | 'hidden';

    // One-line
    icon?: string;
    label?: string;
    getValue?: (input) => string;
    getSecondary?: (input) => string | undefined;
    action?: 'copy' | 'open-file' | 'jump-to-results' | 'none';
    style?: string;                              // 'terminal' for Bash
    wrapText?: boolean;
    colorScheme?: {
      primary?: string;
      secondary?: string;
      background?: string;
      border?: string;
      icon?: string;
    };

    // Collapsible
    title?: string | ((input) => string);
    defaultOpen?: boolean;
    contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text' | 'task';
    getContentProps?: (input, helpers?) => any;
    actionButton?: 'none';
  };

  result?: {
    hidden?: boolean;                            // Never show
    hideOnSuccess?: boolean;                     // Only show errors
    type?: 'one-line' | 'collapsible' | 'special';
    title?: string | ((result) => string);
    defaultOpen?: boolean;
    contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message' | 'task';
    getMessage?: (result) => string;
    getContentProps?: (result) => any;
  };
}
```

---

## All Configured Tools

| Tool | Input | Result | Notes |
|------|-------|--------|-------|
| Bash | terminal one-line | hide success | Dark command pill, green accent |
| Read | one-line (open-file) | hidden | Shows filename, clicks to open |
| Edit | collapsible (diff) | hide success | Amber border, clickable filename |
| Write | collapsible (diff) | hide success | "New" badge on diff |
| ApplyPatch | collapsible (diff) | hide success | "Patch" badge on diff |
| Grep | one-line (jump) | collapsible file-list | Collapsed by default |
| Glob | one-line (jump) | collapsible file-list | Collapsed by default |
| TodoWrite | collapsible (todo-list) | success message | |
| TodoRead | one-line | collapsible todo-list | |
| TaskCreate | one-line | hide success | Shows task subject |
| TaskUpdate | one-line | hide success | Shows `#id → status` |
| TaskList | one-line | collapsible task | Progress bar, status icons |
| TaskGet | one-line | collapsible task | Task details with status |
| ExitPlanMode | collapsible (markdown) | collapsible markdown | Also registered as `exit_plan_mode` |
| Default | collapsible (code) | collapsible text | Fallback for unknown tools |

---

## Performance

- **ToolRenderer** is wrapped with `React.memo` — skips re-render when props haven't changed
- **parsedData** is memoized with `useMemo` — JSON parsing only runs when input changes
- **DiffViewer** memoizes `createDiff()` — expensive diff computation cached
- **MessageComponent** caches `localStorage` reads and timestamp formatting via `useMemo`
- Tool results route through `ToolRenderer` (no duplicate rendering paths)
- `CollapsibleDisplay` uses children pattern (no wasteful contentProps indirection)
- Configs are static module-level objects — zero runtime overhead for lookups
