# Tool Rendering System

## Overview

This folder contains a **config-driven architecture** for rendering tool executions in the chat interface. Instead of scattered conditional logic, all tool rendering is centralized through configurations and reusable display components.

---

## Architecture

```
tools/
├── components/          # Reusable display components
│   ├── OneLineDisplay.tsx          # Simple one-line tool displays
│   ├── CollapsibleDisplay.tsx      # Expandable tool displays
│   ├── ContentRenderers/           # Content-specific renderers
│   │   ├── DiffViewer.tsx         # File diff viewer
│   │   ├── MarkdownContent.tsx    # Markdown renderer
│   │   ├── FileListContent.tsx    # File list for search results
│   │   ├── TodoListContent.tsx    # Todo list renderer
│   │   └── TextContent.tsx        # Plain text/JSON/code
│   ├── FilePathButton.tsx         # Clickable file paths
│   └── CollapsibleSection.tsx     # Collapsible wrapper
├── configs/            # Tool configurations
│   ├── types.ts                   # TypeScript interfaces
│   └── toolConfigs.ts             # All tool configs (10 tools)
├── ToolRenderer.tsx    # Main router component
└── README.md           # This file
```

---

## Core Concepts

### 1. Display Components

All tools use one of two base display patterns:

#### **OneLineDisplay** - For simple tools
Used by: Bash, Read, Grep, Glob, TodoRead

```tsx
<OneLineDisplay
  icon="$"              // Optional icon
  label="Read"          // Optional label
  value="command text"  // Main value to display
  secondary="(desc)"    // Optional secondary text
  action="copy"         // Action type: copy | open-file | jump-to-results | none
  onAction={() => ...}  // Action callback
  colorScheme={{        // Optional color customization
    primary: "text-...",
    secondary: "text-..."
  }}
/>
```

#### **CollapsibleDisplay** - For complex tools
Used by: Edit, Write, Plan, TodoWrite, Grep/Glob results

```tsx
<CollapsibleDisplay
  title="View edit diff"     // Section title
  defaultOpen={false}         // Expand by default?
  action={<FilePathButton />} // Optional action button
  contentType="diff"          // Type of content to render
  contentProps={{...}}        // Props for content renderer
  showRawParameters={true}    // Show raw JSON?
  rawContent="..."            // Raw JSON content
/>
```

### 2. Content Renderers

Different content types are handled by specialized renderers:

- **diff** → `DiffViewer` - Shows before/after file changes
- **markdown** → `MarkdownContent` - Renders markdown with styling
- **file-list** → `FileListContent` - Clickable file list
- **todo-list** → `TodoListContent` - Todo items with status
- **text** → `TextContent` - Plain text, JSON, or code

### 3. Configuration-Driven

Every tool is defined by a config object. No code changes needed to add/modify tools!

---

## How to Add a New Tool

### Example: Adding a "Format" tool

**Step 1:** Add config to `configs/toolConfigs.ts`

```typescript
Format: {
  input: {
    type: 'one-line',              // or 'collapsible'
    label: 'Format',
    getValue: (input) => input.file_path,
    action: 'open-file',
    colorScheme: {
      primary: 'text-purple-600 dark:text-purple-400'
    }
  },
  result: {
    hideOnSuccess: true            // Hide successful results
  }
}
```

**Step 2:** That's it! No other files to touch.

The ToolRenderer automatically:
- Parses the tool input
- Selects the right display component
- Passes the correct props
- Handles callbacks (file opening, copy, etc.)

---

## Configuration Reference

### Input Configuration

```typescript
input: {
  // Display type (required)
  type: 'one-line' | 'collapsible' | 'hidden'

  // One-line specific
  icon?: string                    // Icon to display (e.g., "$", "✓")
  label?: string                   // Text label (e.g., "Read", "Grep")
  getValue?: (input) => string     // Extract main value from input
  getSecondary?: (input) => string // Extract secondary text (description)
  action?: 'copy' | 'open-file' | 'jump-to-results' | 'none'
  colorScheme?: {
    primary?: string               // Tailwind classes for main text
    secondary?: string             // Tailwind classes for secondary text
  }

  // Collapsible specific
  title?: string | ((input) => string)  // Section title
  defaultOpen?: boolean                 // Auto-expand?
  contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text'
  getContentProps?: (input, helpers) => any  // Extract props for content renderer
  actionButton?: 'file-button' | 'none'      // Show file path button?
}
```

### Result Configuration

```typescript
result?: {
  hidden?: boolean                 // Never show results
  hideOnSuccess?: boolean          // Only show errors
  type?: 'one-line' | 'collapsible' | 'special'
  contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message'
  getMessage?: (result) => string  // For success messages
  getContentProps?: (result) => any  // Extract content props
}
```

---

## Real-World Examples

### Simple One-Line Tool (Bash)

```typescript
Bash: {
  input: {
    type: 'one-line',
    icon: '$',
    getValue: (input) => input.command,
    getSecondary: (input) => input.description,
    action: 'copy'
  },
  result: {
    hideOnSuccess: true
  }
}
```

**Renders:**
```
$ npm install (Install dependencies) [Copy Button]
```

### Collapsible Diff Tool (Edit)

```typescript
Edit: {
  input: {
    type: 'collapsible',
    title: 'View edit diff for',
    contentType: 'diff',
    actionButton: 'file-button',
    getContentProps: (input) => ({
      oldContent: input.old_string,
      newContent: input.new_string,
      filePath: input.file_path
    })
  },
  result: {
    hideOnSuccess: true
  }
}
```

**Renders:**
```
▶ View edit diff for [file.ts]
  ┌─────────────────────────┐
  │ - old line             │
  │ + new line             │
  └─────────────────────────┘
```

### Search Results (Grep)

```typescript
Grep: {
  input: {
    type: 'one-line',
    label: 'Grep',
    getValue: (input) => input.pattern,
    getSecondary: (input) => input.path ? `in ${input.path}` : undefined,
    action: 'jump-to-results'
  },
  result: {
    type: 'collapsible',
    contentType: 'file-list',
    getContentProps: (result) => ({
      files: result.toolUseResult?.filenames || [],
      title: `Found ${count} files`
    })
  }
}
```

**Renders:**
```
Input:  Grep "TODO" in src/  [Search results ↓]

Result: Found 5 files
        📄 app.ts (src/)
        📄 utils.ts (src/utils/)
        ...
```

---

## Advanced Features

### Dynamic Content Props with Helpers

For tools that need API calls or complex logic:

```typescript
getContentProps: (input, helpers) => {
  const { selectedProject, createDiff, onFileOpen } = helpers;

  // Use helpers for complex operations
  return {
    filePath: input.file_path,
    onFileClick: () => onFileOpen(input.file_path)
  };
}
```

### File Opening Logic

The ToolRenderer handles file opening automatically for Edit/Write tools:

1. Fetches current file via API
2. Reverse-applies edits (for Edit)
3. Opens file in diff view
4. Falls back gracefully on errors

No config needed - handled by `actionButton: 'file-button'`.

### Custom Color Schemes

Override default colors per tool:

```typescript
colorScheme: {
  primary: 'text-purple-600 dark:text-purple-400',
  secondary: 'text-purple-400 dark:text-purple-500'
}
```

---

## Component Props Reference

### ToolRenderer (Main Entry Point)

```typescript
<ToolRenderer
  toolName="Bash"           // Tool identifier
  toolInput={...}           // Tool input (string or object)
  toolResult={...}          // Tool result (for mode='result')
  mode="input" | "result"   // Rendering mode
  // Callbacks
  onFileOpen={(path, diff) => ...}
  createDiff={(old, new) => [...]}
  // Context
  selectedProject={...}
  // Display options
  autoExpandTools={false}
  showRawParameters={false}
  rawToolInput="..."
/>
```

### OneLineDisplay

```typescript
interface OneLineDisplayProps {
  icon?: string;
  label?: string;
  value: string;                      // Required
  secondary?: string;
  action?: ActionType;
  onAction?: () => void;
  colorScheme?: { primary, secondary };
  resultId?: string;                  // For jump-to-results
}
```

### CollapsibleDisplay

```typescript
interface CollapsibleDisplayProps {
  title: string;                      // Required
  defaultOpen?: boolean;
  action?: React.ReactNode;
  contentType: ContentType;           // Required
  contentProps: any;                  // Required
  showRawParameters?: boolean;
  rawContent?: string;
  className?: string;
}
```

---

## Testing Your Tool

### 1. Add Config
Add your tool to `toolConfigs.ts`

### 2. Test Input Rendering
Trigger the tool and verify:
- ✅ Correct display component used (one-line vs collapsible)
- ✅ Values extracted correctly from input
- ✅ Actions work (copy, file open, jump)
- ✅ Colors and styling correct

### 3. Test Result Rendering
Check tool results:
- ✅ Results hidden when appropriate
- ✅ Error results always shown
- ✅ Content rendered correctly
- ✅ Interactive elements work

### 4. Test Edge Cases
- Empty inputs
- Missing fields
- Parse errors
- API failures

---



## Performance Notes

### Config Loading
- Configs are loaded once at module import
- No runtime overhead for config lookups
- Tree-shaking removes unused configs in production

### Component Rendering
- Display components are memoized where appropriate
- Content renderers only render when props change
- Collapsible sections lazy-load content

### API Calls
- File opening uses async/await with error handling
- Failures gracefully fall back to simple file open
- API module dynamically imported to reduce bundle size

---

## Future Enhancements

### Planned Features
- [ ] Result rendering migration (currently partial)
- [ ] Icon component system (replace emoji with SVG)
- [ ] Interactive prompt renderer
- [ ] Streaming tool output support
- [ ] Tool output caching
- [ ] Custom theme support per tool category

### Extensibility
The architecture supports:
- Custom display components
- New content types
- Plugin-style tool additions
- Theme overrides
- Internationalization (i18n)

---


## Quick Reference

### All Configured Tools

| Tool | Type | Display | Action | Result |
|------|------|---------|--------|--------|
| Bash | one-line | $ command | copy | hide success |
| Read | one-line | Read file.ts | open-file | hidden |
| Edit | collapsible | diff viewer | file-button | hide success |
| Write | collapsible | diff viewer | file-button | hide success |
| ApplyPatch | collapsible | diff viewer | file-button | hide success |
| Grep | one-line | pattern | jump | file-list |
| Glob | one-line | pattern | jump | file-list |
| TodoWrite | collapsible | todo-list | none | success msg |
| TodoRead | one-line | Read todo | none | todo-list |
| exit_plan_mode | collapsible | markdown | none | markdown |
| Default | collapsible | text/code | none | text |

