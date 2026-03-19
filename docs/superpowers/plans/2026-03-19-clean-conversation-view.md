# Clean Conversation View Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clean/raw view toggle to the chat session viewer that collapses noise (skill definitions, system reminders, read-only tools) while preserving code-change tool visibility.

**Architecture:** The feature threads a `cleanView` boolean through the existing preference system (`useUiPreferences`). Noise stripping and skill detection happen at the **view layer** (in `ChatMessagesPane`), not at the data transform layer — this preserves raw data for raw mode. A grouping layer in `ChatMessagesPane` collapses consecutive read-only tools. Two small new components render the collapsed group and skill chip.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-18-clean-conversation-view-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/hooks/useUiPreferences.ts` | Modify | Add `cleanView` preference (default: `true`) |
| `src/components/chat/types/types.ts` | Modify | Add `isSkillLoad`, `skillName` to `ChatMessage` |
| `src/components/chat/utils/messageTransforms.ts` | Modify | Skill detection (always, lightweight — sets `isSkillLoad` flag) |
| `src/components/chat/utils/cleanViewGrouping.ts` | Create | Group consecutive read-only tools for clean view |
| `src/components/chat/view/subcomponents/SkillLoadChip.tsx` | Create | Compact skill indicator chip |
| `src/components/chat/view/subcomponents/CollapsedToolGroup.tsx` | Create | Expandable summary for grouped read-only tools |
| `src/components/chat/utils/cleanViewFilters.ts` | Create | Noise stripping functions (applied at view layer) |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` | Modify | Wire `cleanView` prop, apply noise stripping + grouping, render groups |
| `src/components/chat/view/ChatInterface.tsx` | Modify | Pass `cleanView` through |
| `src/components/main-content/view/MainContent.tsx` | Modify | Extract `cleanView` from preferences, pass to ChatInterface |
| `src/components/quick-settings-panel/constants.ts` | Modify | Add toggle entry for `cleanView` |
| `src/components/quick-settings-panel/types.ts` | Modify | Add `cleanView` to preference key union |
| `src/i18n/locales/en/settings.json` | Modify | Add `cleanView` label string |

---

### Task 1: Add `cleanView` preference to the UI preferences system

**Files:**
- Modify: `src/hooks/useUiPreferences.ts:3-9` (UiPreferences type), `:35-42` (DEFAULTS)
- Modify: `src/components/quick-settings-panel/types.ts:5-9`
- Modify: `src/components/quick-settings-panel/constants.ts:34-50`
- Modify: `src/i18n/locales/en/settings.json`

- [ ] **Step 1: Add `cleanView` to UiPreferences type and defaults**

In `src/hooks/useUiPreferences.ts`, add `cleanView: boolean` to the `UiPreferences` type and set default to `true`:

```typescript
type UiPreferences = {
  autoExpandTools: boolean;
  showRawParameters: boolean;
  showThinking: boolean;
  autoScrollToBottom: boolean;
  sendByCtrlEnter: boolean;
  sidebarVisible: boolean;
  cleanView: boolean;          // <-- add
};

const DEFAULTS: UiPreferences = {
  autoExpandTools: false,
  showRawParameters: false,
  showThinking: true,
  autoScrollToBottom: true,
  sendByCtrlEnter: false,
  sidebarVisible: true,
  cleanView: true,             // <-- add (default: clean mode on)
};
```

- [ ] **Step 2: Add `cleanView` to quick settings panel type**

In `src/components/quick-settings-panel/types.ts`, add `'cleanView'` to the preference key union type:

```typescript
export type PreferenceToggleKey =
  | 'autoExpandTools'
  | 'showRawParameters'
  | 'showThinking'
  | 'autoScrollToBottom'
  | 'sendByCtrlEnter'
  | 'cleanView';               // <-- add
```

- [ ] **Step 3: Add toggle to quick settings constants**

In `src/components/quick-settings-panel/constants.ts`, add to the `TOOL_DISPLAY_TOGGLES` array (import `Sparkles` is already imported):

```typescript
export const TOOL_DISPLAY_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'autoExpandTools',
    labelKey: 'quickSettings.autoExpandTools',
    icon: Maximize2,
  },
  {
    key: 'showRawParameters',
    labelKey: 'quickSettings.showRawParameters',
    icon: Eye,
  },
  {
    key: 'showThinking',
    labelKey: 'quickSettings.showThinking',
    icon: Brain,
  },
  {
    key: 'cleanView',
    labelKey: 'quickSettings.cleanView',
    icon: Sparkles,
  },
];
```

- [ ] **Step 4: Add i18n label**

In `src/i18n/locales/en/settings.json`, add inside the `quickSettings` object:

```json
"cleanView": "Clean view (hide noise)"
```

- [ ] **Step 5: Verify build passes**

Run: `cd /home/ubuntu/projects/claudecodeui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /home/ubuntu/projects/claudecodeui
git add src/hooks/useUiPreferences.ts src/components/quick-settings-panel/types.ts src/components/quick-settings-panel/constants.ts src/i18n/locales/en/settings.json
git commit -m "feat: add cleanView preference to UI settings"
```

---

### Task 2: Add `isSkillLoad` and `skillName` to ChatMessage type

**Files:**
- Modify: `src/components/chat/types/types.ts:28-49`

- [ ] **Step 1: Add fields to ChatMessage interface**

In `src/components/chat/types/types.ts`, add two optional fields before the index signature:

```typescript
export interface ChatMessage {
  type: string;
  content?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  reasoning?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  isSkillLoad?: boolean;
  skillName?: string;
  [key: string]: unknown;
}
```

- [ ] **Step 2: Verify build passes**

Run: `cd /home/ubuntu/projects/claudecodeui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/projects/claudecodeui
git add src/components/chat/types/types.ts
git commit -m "feat: add isSkillLoad and skillName to ChatMessage type"
```

---

### Task 3: Add skill detection to messageTransforms (data layer — always active)

**Files:**
- Modify: `src/components/chat/utils/messageTransforms.ts:353-549` (the `convertSessionMessages` function)

**Note:** Noise stripping (system-reminder, command tags) is NOT done here. It is done at the view layer (Task 3b) so that raw mode preserves original content. Only skill detection is added here because it needs to set the `isSkillLoad` flag on the ChatMessage data — a lightweight operation that doesn't destroy data (the original content is not needed since skill definitions are never useful to display).

- [ ] **Step 1: Add skill detection helper**

Add this function above `convertSessionMessages` (around line 353):

```typescript
/**
 * Detect if a user message is a skill definition load.
 * Returns the skill name if detected, null otherwise.
 */
const detectSkillLoad = (text: string): string | null => {
  if (!text.startsWith('Base directory for this skill:')) {
    return null;
  }
  // Extract skill name from path like ".../skills/server-debugging/..."
  const pathMatch = text.match(/skills\/([^/\n]+)/);
  return pathMatch ? pathMatch[1] : 'unknown';
};
```

- [ ] **Step 2: Add skill detection to user message processing**

In `convertSessionMessages`, find the user message block (around lines 378-427). After the content is assembled (after the `} else {` at line 392), add skill detection BEFORE the existing `shouldSkip` check. Insert this block right after `content = decodeHtmlEntities(String(message.message.content));` (line 392) and before the `const shouldSkip =` line (line 394):

```typescript
      // Detect skill definitions — flag them so the view layer can render as chips
      const skillName = detectSkillLoad(content);
      if (skillName) {
        converted.push({
          type: 'user',
          content,
          timestamp: message.timestamp || new Date().toISOString(),
          isSkillLoad: true,
          skillName,
        });
        return;
      }
```

**Important:** Keep the existing `shouldSkip` checks unchanged — they handle raw mode filtering. Do NOT add `stripNoiseTags` here.

- [ ] **Step 3: Verify build passes**

Run: `cd /home/ubuntu/projects/claudecodeui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/ubuntu/projects/claudecodeui
git add src/components/chat/utils/messageTransforms.ts
git commit -m "feat: add skill detection to message transforms"
```

---

### Task 3b: Create view-layer noise stripping utility

**Files:**
- Create: `src/components/chat/utils/cleanViewFilters.ts`

**Note:** These functions are applied at the view layer (in ChatMessagesPane) only when cleanView is enabled. Raw mode gets unmodified messages.

- [ ] **Step 1: Create the utility**

Create `src/components/chat/utils/cleanViewFilters.ts`:

```typescript
import type { ChatMessage } from '../types/types';

/**
 * Strip noise tags from user message text that the terminal hides.
 * Only applied in clean view mode — raw mode preserves original content.
 */
export const stripNoiseTags = (text: string): string => {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .trim();
};

/**
 * Apply clean view filters to a list of messages.
 * - Strips noise tags from user messages
 * - Removes messages that become empty after stripping
 * Returns a new array (does not mutate input).
 */
export const applyCleanViewFilters = (messages: ChatMessage[]): ChatMessage[] => {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    // Only strip noise from user messages (assistant/tool messages don't have these tags)
    if (msg.type === 'user' && !msg.isSkillLoad && msg.content) {
      const cleaned = stripNoiseTags(msg.content);
      if (!cleaned) {
        // Message was entirely noise tags — skip it
        continue;
      }
      if (cleaned !== msg.content) {
        // Content changed — create a new message object with cleaned content
        result.push({ ...msg, content: cleaned });
        continue;
      }
    }
    result.push(msg);
  }

  return result;
};
```

- [ ] **Step 2: Verify build passes**

Run: `cd /home/ubuntu/projects/claudecodeui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/projects/claudecodeui
git add src/components/chat/utils/cleanViewFilters.ts
git commit -m "feat: add view-layer noise stripping for clean view"
```

---

### Task 4: Create the clean view grouping utility

**Files:**
- Create: `src/components/chat/utils/cleanViewGrouping.ts`

- [ ] **Step 1: Create the grouping utility**

Create `src/components/chat/utils/cleanViewGrouping.ts`:

```typescript
import type { ChatMessage } from '../types/types';

/**
 * Tools classified as "read-only" — collapsed in clean view.
 * Code-change tools (Edit, Write, Bash, NotebookEdit, ApplyPatch) stay visible.
 */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'WebSearch',
  'WebFetch',
  'Skill',
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'ToolSearch',
  'Agent',
  'LSP',
  'TodoRead',
]);

export const isReadOnlyTool = (toolName: string): boolean =>
  READ_ONLY_TOOLS.has(toolName);

export type CleanViewItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'group'; tools: ChatMessage[] };

/**
 * Groups consecutive read-only tool-use messages into collapsed groups.
 * Non-tool messages and code-change tools break the group.
 *
 * Only active when cleanView is true; otherwise returns all messages as-is.
 */
export const groupMessagesForCleanView = (
  messages: ChatMessage[],
  cleanView: boolean,
): CleanViewItem[] => {
  if (!cleanView) {
    return messages.map((message) => ({ kind: 'message', message }));
  }

  const items: CleanViewItem[] = [];
  let currentGroup: ChatMessage[] = [];

  const flushGroup = () => {
    if (currentGroup.length > 0) {
      items.push({ kind: 'group', tools: currentGroup });
      currentGroup = [];
    }
  };

  for (const message of messages) {
    // Skill loads pass through as individual messages (rendered as chips)
    if (message.isSkillLoad) {
      flushGroup();
      items.push({ kind: 'message', message });
      continue;
    }

    // Read-only tool-use messages get grouped
    if (message.isToolUse && message.toolName && isReadOnlyTool(message.toolName)) {
      currentGroup.push(message);
      continue;
    }

    // Everything else (text, code-change tools, user messages) breaks the group
    flushGroup();
    items.push({ kind: 'message', message });
  }

  flushGroup();
  return items;
};

/**
 * Build a human-readable summary of grouped tools.
 * e.g. "Read 3 files, Grep 2 patterns, Glob 1 search"
 */
export const summarizeToolGroup = (tools: ChatMessage[]): string => {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const name = tool.toolName || 'Unknown';
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  const labels: Record<string, string> = {
    Read: 'file read',
    Grep: 'search',
    Glob: 'file search',
    WebSearch: 'web search',
    WebFetch: 'web fetch',
    Agent: 'subagent',
    LSP: 'LSP query',
    TodoRead: 'todo read',
  };

  const parts: string[] = [];
  for (const [name, count] of counts) {
    const label = labels[name] || name.toLowerCase();
    const plural = count > 1 ? `${label}${label.endsWith('s') ? '' : 'es'}` : label;
    parts.push(`${count} ${count > 1 ? plural : label}`);
  }

  return parts.join(', ');
};
```

- [ ] **Step 2: Verify build passes**

Run: `cd /home/ubuntu/projects/claudecodeui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/projects/claudecodeui
git add src/components/chat/utils/cleanViewGrouping.ts
git commit -m "feat: add clean view grouping utility for read-only tools"
```

---

### Task 5: Create SkillLoadChip component

**Files:**
- Create: `src/components/chat/view/subcomponents/SkillLoadChip.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/chat/view/subcomponents/SkillLoadChip.tsx`:

```typescript
import { useMemo } from 'react';
import { Zap } from 'lucide-react';

interface SkillLoadChipProps {
  skillName: string;
  timestamp: string | number | Date;
}

export default function SkillLoadChip({ skillName, timestamp }: SkillLoadChipProps) {
  const formattedTime = useMemo(
    () => new Date(timestamp).toLocaleTimeString(),
    [timestamp],
  );

  return (
    <div className="flex items-center gap-2 px-3 py-1 sm:px-0">
      <div className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        <Zap className="h-3 w-3" />
        <span>Loaded skill: <span className="font-medium">{skillName}</span></span>
        <span className="text-gray-400 dark:text-gray-500">{formattedTime}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `cd /home/ubuntu/projects/claudecodeui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/projects/claudecodeui
git add src/components/chat/view/subcomponents/SkillLoadChip.tsx
git commit -m "feat: add SkillLoadChip component for clean view"
```

---

### Task 6: Create CollapsedToolGroup component

**Files:**
- Create: `src/components/chat/view/subcomponents/CollapsedToolGroup.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/chat/view/subcomponents/CollapsedToolGroup.tsx`:

```typescript
import { useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import type { ChatMessage } from '../../types/types';
import type { Project } from '../../../../types/app';
import { summarizeToolGroup } from '../../utils/cleanViewGrouping';
import MessageComponent from './MessageComponent';

interface CollapsedToolGroupProps {
  tools: ChatMessage[];
  createDiff: (oldStr: string, newStr: string) => any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: string;
}

export default function CollapsedToolGroup({
  tools,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  autoExpandTools,
  showRawParameters,
  showThinking,
  selectedProject,
  provider,
}: CollapsedToolGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const summary = summarizeToolGroup(tools);

  return (
    <div className="px-3 sm:px-0">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-xs text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800"
      >
        <ChevronRight
          className={`h-3 w-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
        <Search className="h-3 w-3 flex-shrink-0 text-gray-400 dark:text-gray-500" />
        <span>
          Research: {summary}
        </span>
        <span className="ml-auto text-gray-400 dark:text-gray-500">
          {tools.length} {tools.length === 1 ? 'call' : 'calls'}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-1 space-y-1 border-l-2 border-gray-200 pl-3 dark:border-gray-700">
          {tools.map((tool, index) => (
            <MessageComponent
              key={tool.toolId || `group-tool-${index}`}
              message={tool}
              prevMessage={index > 0 ? tools[index - 1] : null}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              onGrantToolPermission={onGrantToolPermission}
              autoExpandTools={autoExpandTools}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              selectedProject={selectedProject}
              provider={provider}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `cd /home/ubuntu/projects/claudecodeui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/projects/claudecodeui
git add src/components/chat/view/subcomponents/CollapsedToolGroup.tsx
git commit -m "feat: add CollapsedToolGroup component for clean view"
```

---

### Task 7: Wire clean view into ChatMessagesPane

**Files:**
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`

- [ ] **Step 1: Add `cleanView` prop and imports**

Add imports at top of file:

```typescript
import { useMemo } from 'react';
import { groupMessagesForCleanView } from '../../utils/cleanViewGrouping';
import { applyCleanViewFilters } from '../../utils/cleanViewFilters';
import SkillLoadChip from './SkillLoadChip';
import CollapsedToolGroup from './CollapsedToolGroup';
```

Update the existing `import { useCallback, useRef } from 'react';` to include `useMemo`:
```typescript
import { useCallback, useMemo, useRef } from 'react';
```

Add `cleanView?: boolean;` to the `ChatMessagesPaneProps` interface (after `showThinking?: boolean;` at line 52).

Add `cleanView,` to the destructured props (after `showThinking,` at line 98).

- [ ] **Step 2: Add memoized clean view pipeline**

Inside the component function, before the `return` statement (around line 131), add:

```typescript
  // Clean view pipeline: strip noise → group read-only tools (memoized)
  const cleanViewItems = useMemo(() => {
    const isClean = cleanView ?? true;
    const filtered = isClean ? applyCleanViewFilters(visibleMessages) : visibleMessages;
    return groupMessagesForCleanView(filtered, isClean);
  }, [visibleMessages, cleanView]);
```

- [ ] **Step 3: Replace the message rendering loop**

Replace the `visibleMessages.map(...)` block (lines 243-261) with grouped rendering:

```typescript
          {cleanViewItems.map((item, index) => {
              if (item.kind === 'group') {
                return (
                  <CollapsedToolGroup
                    key={`group-${item.tools[0]?.toolId || index}`}
                    tools={item.tools}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
                    onShowSettings={onShowSettings}
                    onGrantToolPermission={onGrantToolPermission}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    selectedProject={selectedProject}
                    provider={provider}
                  />
                );
              }

              const message = item.message;

              // Render skill loads as chips in clean view
              if (message.isSkillLoad && (cleanView ?? true)) {
                return (
                  <SkillLoadChip
                    key={getMessageKey(message)}
                    skillName={message.skillName || 'unknown'}
                    timestamp={message.timestamp}
                  />
                );
              }

              // Find previous non-group message for grouping logic
              let prevMessage: ChatMessage | null = null;
              for (let i = index - 1; i >= 0; i--) {
                const prev = items[i];
                if (prev.kind === 'message') {
                  prevMessage = prev.message;
                  break;
                }
              }

              return (
                <MessageComponent
                  key={getMessageKey(message)}
                  message={message}
                  prevMessage={prevMessage}
                  createDiff={createDiff}
                  onFileOpen={onFileOpen}
                  onShowSettings={onShowSettings}
                  onGrantToolPermission={onGrantToolPermission}
                  autoExpandTools={autoExpandTools}
                  showRawParameters={showRawParameters}
                  showThinking={showThinking}
                  selectedProject={selectedProject}
                  provider={provider}
                />
              );
            })}
```

- [ ] **Step 3: Verify build passes**

Run: `cd /home/ubuntu/projects/claudecodeui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/ubuntu/projects/claudecodeui
git add src/components/chat/view/subcomponents/ChatMessagesPane.tsx
git commit -m "feat: wire clean view grouping into ChatMessagesPane"
```

---

### Task 8: Thread `cleanView` prop through ChatInterface and MainContent

**Files:**
- Modify: `src/components/chat/types/types.ts:94-118` (ChatInterfaceProps)
- Modify: `src/components/chat/view/ChatInterface.tsx:37,318`
- Modify: `src/components/main-content/view/MainContent.tsx:53,132`

- [ ] **Step 1: Add to ChatInterface**

In `src/components/chat/view/ChatInterface.tsx`:

Find where `showThinking` is destructured from props (line 37) and add `cleanView` next to it:

```typescript
  showThinking,
  cleanView,
```

Find where `showThinking={showThinking}` is passed to `ChatMessagesPane` (line 318) and add:

```typescript
                showThinking={showThinking}
                cleanView={cleanView}
```

Also add `cleanView?: boolean;` to the `ChatInterfaceProps` in `src/components/chat/types/types.ts` (around line 113, after `showThinking`):

```typescript
  showThinking?: boolean;
  cleanView?: boolean;
```

- [ ] **Step 2: Add to MainContent**

In `src/components/main-content/view/MainContent.tsx`:

Find where preferences are destructured (line 53) and add `cleanView`:

```typescript
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter, cleanView } = preferences;
```

Find where `showThinking` is passed to ChatInterface (line 132) and add:

```typescript
                showThinking={showThinking}
                cleanView={cleanView}
```

- [ ] **Step 3: Verify build passes**

Run: `cd /home/ubuntu/projects/claudecodeui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/ubuntu/projects/claudecodeui
git add src/components/chat/view/ChatInterface.tsx src/components/main-content/view/MainContent.tsx src/components/chat/types/types.ts
git commit -m "feat: thread cleanView prop through ChatInterface and MainContent"
```

---

### Task 9: Manual integration test

**Files:** None (verification only)

- [ ] **Step 1: Build the project**

Run: `cd /home/ubuntu/projects/claudecodeui && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Restart the service**

Run: `sudo systemctl restart claudecodeui` (or whatever the service name is — check with `systemctl list-units | grep claude`)

- [ ] **Step 3: Test in browser**

Open the UI and navigate to the session `3cc9ab2a-4437-4685-aee9-3249e6908e18` in the spend-tracker project. Verify:

1. Skill definitions show as compact chips (e.g., "Loaded skill: server-debugging")
2. System reminders are stripped from user messages
3. Consecutive Read/Grep/Glob calls are collapsed into summary lines
4. Edit/Write/Bash tools remain fully visible with diffs
5. Clicking a collapsed group expands to show individual tools
6. The clean/raw toggle in quick settings works
7. Toggling to raw mode shows everything as before

- [ ] **Step 4: Final commit if any fixes needed**

```bash
cd /home/ubuntu/projects/claudecodeui
git add -A
git commit -m "fix: integration test fixes for clean view"
```
