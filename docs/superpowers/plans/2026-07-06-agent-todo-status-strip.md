# Agent Todo Status Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the latest todo snapshot for the active chat session directly above the composer beside the existing run status.

**Architecture:** Derive todo summaries from the already loaded `ChatMessage[]`; no server API, store, or persistence change. Render a small composer status strip that reuses the existing todo list renderer for the expanded view.

**Tech Stack:** React, TypeScript, existing chat message/tool types, `node --import tsx --test`, `npm run typecheck`.

---

### Task 1: Todo Summary Extraction

**Files:**
- Create: `src/components/chat/utils/agentTodoSummary.ts`
- Test: `src/components/chat/utils/agentTodoSummary.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage } from '../types/types';
import { deriveAgentTodoSummaries } from './agentTodoSummary';

test('derives latest Claude TodoWrite snapshot', () => {
  const messages: ChatMessage[] = [
    {
      type: 'assistant',
      timestamp: '2026-07-06T10:00:00Z',
      isToolUse: true,
      toolName: 'TodoWrite',
      toolInput: { todos: [{ content: 'old task', status: 'pending' }] },
    },
    {
      type: 'assistant',
      timestamp: '2026-07-06T10:01:00Z',
      isToolUse: true,
      toolName: 'TodoWrite',
      toolInput: {
        todos: [
          { content: 'ship strip', status: 'in_progress' },
          { content: 'write tests', status: 'completed' },
        ],
      },
    },
  ];

  const [summary] = deriveAgentTodoSummaries(messages);

  assert.equal(summary.label, 'Agent');
  assert.equal(summary.activeTodo, 'ship strip');
  assert.equal(summary.inProgressCount, 1);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.pendingCount, 0);
  assert.deepEqual(summary.todos.map((todo) => todo.content), ['ship strip', 'write tests']);
});

test('parses Claude TodoRead result content', () => {
  const [summary] = deriveAgentTodoSummaries([
    {
      type: 'assistant',
      timestamp: 1000,
      isToolUse: true,
      toolName: 'TodoRead',
      toolResult: {
        content: JSON.stringify([{ content: 'read snapshot', status: 'pending' }]),
      },
    },
  ]);

  assert.equal(summary.activeTodo, 'read snapshot');
  assert.equal(summary.pendingCount, 1);
});

test('parses Codex todo_list shape normalized as TodoList', () => {
  const [summary] = deriveAgentTodoSummaries([
    {
      type: 'assistant',
      timestamp: 1000,
      isToolUse: true,
      toolName: 'TodoList',
      toolInput: {
        items: [
          { text: 'codex task', status: 'in_progress' },
          { text: 'codex done', completed: true },
        ],
      },
    },
  ]);

  assert.equal(summary.activeTodo, 'codex task');
  assert.equal(summary.completedCount, 1);
});
```

- [ ] **Step 2: Run test verify fails**

Run:

```bash
node --import tsx --test src/components/chat/utils/agentTodoSummary.test.ts
```

Expected: FAIL because `agentTodoSummary.ts` does not exist.

- [ ] **Step 3: Implement minimal extraction**

```ts
import type { ChatMessage, SubagentChildTool, ToolResult } from '../types/types';
import type { TodoItem } from '../tools/components/ContentRenderers/TodoList';

export type AgentTodoSummary = {
  id: string;
  label: string;
  todos: TodoItem[];
  activeTodo: string;
  completedCount: number;
  pendingCount: number;
  inProgressCount: number;
  updatedAt: Date;
};

type TodoTool = {
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  timestamp?: string | number | Date;
};

const TODO_TOOL_NAMES = new Set(['TodoWrite', 'TodoRead', 'TodoList']);

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const getRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;

const normalizeStatus = (value: unknown): string => {
  if (value === 'completed' || value === true) return 'completed';
  if (value === 'in_progress') return 'in_progress';
  return 'pending';
};

const coerceTodo = (value: unknown): TodoItem | null => {
  const item = getRecord(value);
  if (!item) return null;

  const content = item.content ?? item.text ?? item.title;
  if (typeof content !== 'string' || !content.trim()) return null;

  return {
    id: typeof item.id === 'string' ? item.id : undefined,
    content,
    status: normalizeStatus(item.status ?? item.completed),
    priority: typeof item.priority === 'string' ? item.priority : undefined,
  };
};

const coerceTodos = (value: unknown): TodoItem[] => {
  if (!Array.isArray(value)) return [];
  return value.map(coerceTodo).filter((todo): todo is TodoItem => Boolean(todo));
};

const todosFromTool = (tool: TodoTool): TodoItem[] => {
  if (!tool.toolName || !TODO_TOOL_NAMES.has(tool.toolName)) return [];

  const input = parseJson(tool.toolInput);
  const inputRecord = getRecord(input);

  if (tool.toolName === 'TodoWrite') {
    return coerceTodos(inputRecord?.todos);
  }

  if (tool.toolName === 'TodoList') {
    return coerceTodos(inputRecord?.items ?? inputRecord?.todos);
  }

  const result = parseJson(tool.toolResult?.content);
  return coerceTodos(result);
};

const makeSummary = (id: string, label: string, todos: TodoItem[], timestamp: TodoTool['timestamp']): AgentTodoSummary => {
  const active = todos.find((todo) => todo.status === 'in_progress') ?? todos.find((todo) => todo.status !== 'completed');

  return {
    id,
    label,
    todos,
    activeTodo: active?.content ?? '',
    completedCount: todos.filter((todo) => todo.status === 'completed').length,
    pendingCount: todos.filter((todo) => todo.status === 'pending').length,
    inProgressCount: todos.filter((todo) => todo.status === 'in_progress').length,
    updatedAt: timestamp ? new Date(timestamp) : new Date(),
  };
};

const getTaskLabel = (message: ChatMessage): string => {
  const input = getRecord(parseJson(message.toolInput));
  const label = input?.subagent_type ?? input?.description;
  return typeof label === 'string' && label.trim() ? label : 'Subagent';
};

export function deriveAgentTodoSummaries(messages: ChatMessage[]): AgentTodoSummary[] {
  const summaries = new Map<string, AgentTodoSummary>();

  messages.forEach((message, index) => {
    const todos = todosFromTool(message);
    if (todos.length > 0) {
      summaries.set('agent', makeSummary('agent', 'Agent', todos, message.timestamp));
    }

    const childTools = message.subagentState?.childTools ?? [];
    childTools.forEach((tool: SubagentChildTool) => {
      const childTodos = todosFromTool(tool);
      if (childTodos.length === 0) return;

      const id = `subagent-${message.toolId ?? index}`;
      summaries.set(id, makeSummary(id, getTaskLabel(message), childTodos, tool.timestamp));
    });
  });

  return [...summaries.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
```

- [ ] **Step 4: Run test verify passes**

Run:

```bash
node --import tsx --test src/components/chat/utils/agentTodoSummary.test.ts
```

Expected: PASS.

### Task 2: Composer Status Strip Component

**Files:**
- Create: `src/components/chat/view/subcomponents/AgentTodoStatusStrip.tsx`

- [ ] **Step 1: Create compact component**

```tsx
import { useEffect, useState } from 'react';
import { ListTodo } from 'lucide-react';

import type { AgentTodoSummary } from '../../utils/agentTodoSummary';
import { TodoListContent } from '../../tools/components/ContentRenderers/TodoListContent';

type AgentTodoStatusStripProps = {
  summaries: AgentTodoSummary[];
};

const formatAge = (updatedAt: Date, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - updatedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
};

export default function AgentTodoStatusStrip({ summaries }: AgentTodoStatusStripProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (summaries.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [summaries.length]);

  if (summaries.length === 0) return null;

  return (
    <div className="pointer-events-auto flex min-w-0 flex-wrap items-end gap-1.5">
      {summaries.map((summary) => {
        const isExpanded = expandedId === summary.id;
        const countLabel = `${summary.completedCount}/${summary.todos.length}`;

        return (
          <div key={summary.id} className="relative">
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : summary.id)}
              className="inline-flex h-8 max-w-[18rem] items-center gap-1.5 rounded-t-lg border border-b-0 border-border/50 bg-card px-2.5 text-xs shadow-[0_-1px_1px_hsl(var(--foreground)/0.04),1px_0_1px_hsl(var(--foreground)/0.03),-1px_0_1px_hsl(var(--foreground)/0.03)] transition-colors hover:bg-accent"
              title={summary.activeTodo || summary.label}
            >
              <ListTodo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="shrink-0 font-medium text-muted-foreground">{summary.label}</span>
              {summary.activeTodo && (
                <span className="min-w-0 truncate text-foreground">{summary.activeTodo}</span>
              )}
              <span className="shrink-0 tabular-nums text-muted-foreground/70">{countLabel}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground/50">{formatAge(summary.updatedAt, now)}</span>
            </button>

            {isExpanded && (
              <div className="absolute bottom-full left-0 z-30 mb-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border/60 bg-card p-2 shadow-lg">
                <TodoListContent todos={summary.todos} isResult />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS or fail only because the component is not wired yet if import path issues exist; fix import path before moving on.

### Task 3: Wire Strip Into Chat Composer

**Files:**
- Modify: `src/components/chat/view/ChatInterface.tsx`
- Modify: `src/components/chat/view/subcomponents/ChatComposer.tsx`

- [ ] **Step 1: Derive summaries in `ChatInterface.tsx`**

Add import:

```ts
import { deriveAgentTodoSummaries } from '../utils/agentTodoSummary';
```

After `handleExportSession`, add:

```ts
const agentTodoSummaries = useMemo(
  () => deriveAgentTodoSummaries(chatMessages),
  [chatMessages],
);
```

Pass the prop to `ChatComposer`:

```tsx
agentTodoSummaries={agentTodoSummaries}
```

- [ ] **Step 2: Accept and render summaries in `ChatComposer.tsx`**

Add imports:

```ts
import type { AgentTodoSummary } from '../../utils/agentTodoSummary';
import AgentTodoStatusStrip from './AgentTodoStatusStrip';
```

Add prop:

```ts
agentTodoSummaries?: AgentTodoSummary[];
```

Destructure prop:

```ts
agentTodoSummaries = [],
```

Replace the activity-only status booleans with:

```ts
const hasPendingPermissions = pendingPermissionRequests.length > 0;
const hasComposerStatus = !hasPendingPermissions && (Boolean(activity) || agentTodoSummaries.length > 0);
```

Render the status row:

```tsx
{hasComposerStatus && (
  <div className="mx-auto w-full max-w-[54.25rem] translate-y-px bg-transparent">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <ActivityIndicator activity={activity} onAbort={onAbortSession} isInputFocused={isInputFocused} />
      <AgentTodoStatusStrip summaries={agentTodoSummaries} />
    </div>
  </div>
)}
```

Use `hasComposerStatus` for the composer radius:

```ts
hasComposerStatus ? 'rounded-t-none' : '',
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
node --import tsx --test src/components/chat/utils/agentTodoSummary.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

```bash
git add src/components/chat/utils/agentTodoSummary.ts \
  src/components/chat/utils/agentTodoSummary.test.ts \
  src/components/chat/view/subcomponents/AgentTodoStatusStrip.tsx \
  src/components/chat/view/subcomponents/ChatComposer.tsx \
  src/components/chat/view/ChatInterface.tsx
git commit -m "feat: show agent todo status strip"
```

---

Plan self-review:
- Spec coverage: current session, Claude TodoWrite/TodoRead, Codex TodoList/todo_list, composer placement, compact item, expanded list, empty state.
- Placeholder scan: no TODO/TBD or deferred implementation steps.
- Type consistency: `AgentTodoSummary` is created by the utility, consumed by the strip, and passed through `ChatInterface` into `ChatComposer`.
- Skipped: global dashboard, history, persistence, new server API.

