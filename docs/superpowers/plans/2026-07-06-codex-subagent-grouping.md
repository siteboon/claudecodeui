# Codex Subagent Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Codex subagent transcripts out of the sidebar and show them inside the parent chat session.

**Architecture:** Add a tiny Codex transcript metadata helper, use it to skip subagent transcripts during session indexing, and use it again while loading parent history to attach matching child transcript tools to the parent `spawn_agent` call. Reuse the existing `Task`/`SubagentContainer` and `subagentTools` frontend path.

**Tech Stack:** TypeScript, Node `node:test`, existing provider session services, existing chat message normalization.

## Global Constraints

- Codex-only change.
- No new database schema.
- No new sidebar UI.
- No new dependencies.
- Parent session remains the only top-level sidebar session.
- Subagent transcripts are identified by `payload.thread_source === "subagent"` and linked by `payload.parent_thread_id` or `payload.source.subagent.thread_spawn.parent_thread_id`.

---

### Task 1: Codex Transcript Metadata Helper

**Files:**
- Create: `server/modules/providers/list/codex/codex-transcripts.ts`
- Test: `server/modules/providers/tests/codex-transcripts.test.ts`

**Interfaces:**
- Produces: `readCodexTranscriptMeta(filePath: string): Promise<CodexTranscriptMeta | null>`
- Produces: `isCodexSubagentTranscript(filePath: string): Promise<boolean>`
- Produces: `findCodexSubagentTranscriptFiles(parentThreadId: string, rootDir?: string): Promise<string[]>`

- [ ] **Step 1: Write failing metadata tests**

```ts
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findCodexSubagentTranscriptFiles,
  isCodexSubagentTranscript,
  readCodexTranscriptMeta,
} from '@/modules/providers/list/codex/codex-transcripts.js';

async function writeJsonl(filePath: string, rows: unknown[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
}

test('reads Codex parent and subagent transcript metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-transcripts-'));
  const filePath = path.join(dir, 'subagent.jsonl');

  await writeJsonl(filePath, [
    {
      timestamp: '2026-07-06T14:30:42.203Z',
      type: 'session_meta',
      payload: {
        id: 'child-1',
        cwd: '/workspace/demo',
        thread_source: 'subagent',
        parent_thread_id: 'parent-1',
        agent_nickname: 'Ramanujan',
        agent_role: 'default',
      },
    },
  ]);

  const meta = await readCodexTranscriptMeta(filePath);

  assert.deepEqual(meta, {
    sessionId: 'child-1',
    projectPath: '/workspace/demo',
    threadSource: 'subagent',
    parentThreadId: 'parent-1',
    agentNickname: 'Ramanujan',
    agentRole: 'default',
  });
  assert.equal(await isCodexSubagentTranscript(filePath), true);
});

test('finds subagent transcripts for one parent thread', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-transcripts-'));
  const parentMatch = path.join(dir, '2026', '07', '06', 'child-match.jsonl');
  const otherParent = path.join(dir, '2026', '07', '06', 'child-other.jsonl');
  const normalSession = path.join(dir, '2026', '07', '06', 'parent.jsonl');

  await writeJsonl(parentMatch, [{
    type: 'session_meta',
    payload: { id: 'child-match', cwd: '/workspace/demo', thread_source: 'subagent', parent_thread_id: 'parent-1' },
  }]);
  await writeJsonl(otherParent, [{
    type: 'session_meta',
    payload: { id: 'child-other', cwd: '/workspace/demo', thread_source: 'subagent', parent_thread_id: 'parent-2' },
  }]);
  await writeJsonl(normalSession, [{
    type: 'session_meta',
    payload: { id: 'parent-1', cwd: '/workspace/demo' },
  }]);

  assert.deepEqual(await findCodexSubagentTranscriptFiles('parent-1', dir), [parentMatch]);
});
```

- [ ] **Step 2: Run test verify fails**

Run:

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/modules/providers/tests/codex-transcripts.test.ts
```

Expected: FAIL because `codex-transcripts.ts` does not exist.

- [ ] **Step 3: Implement the helper**

```ts
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

import { findFilesRecursivelyCreatedAfter, readObjectRecord } from '@/shared/utils.js';

export type CodexTranscriptMeta = {
  sessionId: string;
  projectPath: string;
  threadSource?: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
};

export async function readCodexTranscriptMeta(filePath: string): Promise<CodexTranscriptMeta | null> {
  try {
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const entry = readObjectRecord(parsed);
      const payload = readObjectRecord(entry?.payload);
      if (entry?.type !== 'session_meta' || !payload) continue;

      const sessionId = typeof payload.id === 'string' ? payload.id : undefined;
      const projectPath = typeof payload.cwd === 'string' ? payload.cwd : undefined;
      if (!sessionId || !projectPath) return null;

      const source = readObjectRecord(payload.source);
      const subagent = readObjectRecord(source?.subagent);
      const threadSpawn = readObjectRecord(subagent?.thread_spawn);

      return {
        sessionId,
        projectPath,
        threadSource: typeof payload.thread_source === 'string' ? payload.thread_source : undefined,
        parentThreadId:
          typeof payload.parent_thread_id === 'string'
            ? payload.parent_thread_id
            : typeof threadSpawn?.parent_thread_id === 'string'
              ? threadSpawn.parent_thread_id
              : undefined,
        agentNickname: typeof payload.agent_nickname === 'string' ? payload.agent_nickname : undefined,
        agentRole: typeof payload.agent_role === 'string' ? payload.agent_role : undefined,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function isCodexSubagentTranscript(filePath: string): Promise<boolean> {
  return (await readCodexTranscriptMeta(filePath))?.threadSource === 'subagent';
}

export async function findCodexSubagentTranscriptFiles(
  parentThreadId: string,
  rootDir = path.join(os.homedir(), '.codex', 'sessions'),
): Promise<string[]> {
  const files = await findFilesRecursivelyCreatedAfter(rootDir, '.jsonl', null);
  const matches: string[] = [];

  for (const filePath of files) {
    const meta = await readCodexTranscriptMeta(filePath);
    if (meta?.threadSource === 'subagent' && meta.parentThreadId === parentThreadId) {
      matches.push(filePath);
    }
  }

  return matches.sort();
}
```

- [ ] **Step 4: Run metadata tests verify pass**

Run:

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/modules/providers/tests/codex-transcripts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modules/providers/list/codex/codex-transcripts.ts server/modules/providers/tests/codex-transcripts.test.ts
git commit -m "test: cover codex subagent transcript metadata"
```

### Task 2: Stop Indexing Codex Subagents as Sidebar Sessions

**Files:**
- Modify: `server/modules/providers/list/codex/codex-session-synchronizer.provider.ts`
- Test: `server/modules/providers/tests/codex-sessions.test.ts`

**Interfaces:**
- Consumes: `readCodexTranscriptMeta()`
- Consumes: `isCodexSubagentTranscript()`
- Preserves: `CodexSessionSynchronizer.synchronizeFile(filePath): Promise<string | null>`

- [ ] **Step 1: Write failing synchronizer test**

Append to `server/modules/providers/tests/codex-sessions.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';

async function writeCodexJsonl(filePath: string, rows: unknown[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
}

test('Codex synchronizer skips subagent transcripts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-sync-'));
  const filePath = path.join(dir, 'child.jsonl');
  await writeCodexJsonl(filePath, [{
    type: 'session_meta',
    payload: {
      id: 'child-1',
      cwd: '/workspace/demo',
      thread_source: 'subagent',
      parent_thread_id: 'parent-1',
    },
  }]);

  const synchronizer = new CodexSessionSynchronizer();

  assert.equal(await synchronizer.synchronizeFile(filePath), null);
});
```

- [ ] **Step 2: Run test verify fails**

Run:

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/modules/providers/tests/codex-sessions.test.ts
```

Expected: FAIL because `synchronizeFile()` currently indexes subagent transcripts.

- [ ] **Step 3: Update synchronizer to use metadata helper**

In `server/modules/providers/list/codex/codex-session-synchronizer.provider.ts`:

```ts
import { readCodexTranscriptMeta } from './codex-transcripts.js';
```

Replace the first half of `processSessionFile()` with:

```ts
    const meta = await readCodexTranscriptMeta(filePath);
    if (!meta || meta.threadSource === 'subagent') {
      return null;
    }

    const parsed = {
      sessionId: meta.sessionId,
      projectPath: meta.projectPath,
    };
```

Add this early return at the top of `synchronizeFile()`:

```ts
    if (await isCodexSubagentTranscript(filePath)) {
      return null;
    }
```

If `processSessionFile()` already returns `null` for subagents, this early return is optional. Prefer the smaller final diff.

- [ ] **Step 4: Run synchronizer tests verify pass**

Run:

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/modules/providers/tests/codex-sessions.test.ts server/modules/providers/tests/codex-transcripts.test.ts server/modules/providers/tests/claude-sessions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modules/providers/list/codex/codex-session-synchronizer.provider.ts server/modules/providers/tests/codex-sessions.test.ts
git commit -m "fix: skip codex subagent sessions in sidebar"
```

### Task 3: Attach Codex Child Transcript Tools to Parent Spawn Calls

**Files:**
- Modify: `server/modules/providers/list/codex/codex-sessions.provider.ts`
- Test: `server/modules/providers/tests/codex-sessions.test.ts`

**Interfaces:**
- Consumes: `findCodexSubagentTranscriptFiles(parentThreadId, rootDir?)`
- Produces: parent history `tool_use` rows for `spawn_agent` normalized as `toolName: 'Task'`
- Produces: `raw.subagentTools` on the matching parent spawn tool row

- [ ] **Step 1: Write failing parent grouping test**

Append to `server/modules/providers/tests/codex-sessions.test.ts`:

```ts
test('Codex history exposes spawned agent transcript as Task subagent tools', () => {
  const provider = new CodexSessionsProvider();

  const normalized = provider.normalizeMessage({
    type: 'tool_use',
    timestamp: '2026-07-06T14:30:42.142Z',
    toolName: 'Task',
    toolInput: {
      subagent_type: 'Ramanujan',
      description: 'banner-test',
      prompt: 'Create a todo list',
    },
    toolCallId: 'call_spawn',
    subagentTools: [
      {
        toolId: 'call_plan',
        toolName: 'TodoList',
        timestamp: '2026-07-06T14:30:49.657Z',
        toolInput: {
          items: [
            { text: 'say hello', status: 'completed' },
            { text: 'say bye', status: 'completed' },
            { text: 'say thanks', status: 'completed' },
          ],
        },
        toolResult: { content: 'Plan updated', isError: false },
      },
    ],
  }, 'parent-1');

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.kind, 'tool_use');
  assert.equal(normalized[0]?.toolName, 'Task');
  assert.deepEqual(normalized[0]?.subagentTools, [
    {
      toolId: 'call_plan',
      toolName: 'TodoList',
      timestamp: '2026-07-06T14:30:49.657Z',
      toolInput: {
        items: [
          { text: 'say hello', status: 'completed' },
          { text: 'say bye', status: 'completed' },
          { text: 'say thanks', status: 'completed' },
        ],
      },
      toolResult: { content: 'Plan updated', isError: false },
    },
  ]);
});
```

- [ ] **Step 2: Run test verify fails**

Run:

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/modules/providers/tests/codex-sessions.test.ts
```

Expected: FAIL because `normalizeHistoryEntry()` drops `raw.subagentTools`.

- [ ] **Step 3: Preserve `subagentTools` during Codex normalization**

In the `raw.type === 'tool_use' || raw.toolName` branch of `normalizeHistoryEntry()`, add:

```ts
        subagentTools: raw.subagentTools,
```

- [ ] **Step 4: Run test verify passes**

Run:

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/modules/providers/tests/codex-sessions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add child transcript parsing test**

Add a direct test for `update_plan` conversion by exporting a small helper from `codex-sessions.provider.ts`:

```ts
export function codexFunctionCallToTool(entry: AnyRecord): AnyRecord | null
```

Test:

```ts
test('Codex update_plan function call is exposed as TodoList child tool', () => {
  const tool = codexFunctionCallToTool({
    timestamp: '2026-07-06T14:30:49.657Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'update_plan',
      call_id: 'call_plan',
      arguments: JSON.stringify({
        plan: [
          { step: 'say hello', status: 'completed' },
          { step: 'say bye', status: 'in_progress' },
        ],
      }),
    },
  });

  assert.deepEqual(tool, {
    type: 'tool_use',
    timestamp: '2026-07-06T14:30:49.657Z',
    toolName: 'TodoList',
    toolInput: {
      items: [
        { text: 'say hello', status: 'completed' },
        { text: 'say bye', status: 'in_progress' },
      ],
    },
    toolCallId: 'call_plan',
  });
});
```

- [ ] **Step 6: Implement `codexFunctionCallToTool()` and reuse it**

Move the existing `function_call` conversion inside `getCodexSessionMessages()` into this helper:

```ts
export function codexFunctionCallToTool(entry: AnyRecord): AnyRecord | null {
  const payload = readObjectRecord(entry.payload);
  if (entry.type !== 'response_item' || payload?.type !== 'function_call') return null;

  const toolCallId = typeof payload.call_id === 'string' ? payload.call_id : generateMessageId('codex-tool');
  const timestamp = entry.timestamp;

  if (payload.name === 'update_plan') {
    const input = parseJsonRecord(payload.arguments);
    const plan = Array.isArray(input?.plan) ? input.plan : [];
    return {
      type: 'tool_use',
      timestamp,
      toolName: 'TodoList',
      toolInput: {
        items: plan
          .map((item) => readObjectRecord(item))
          .filter(Boolean)
          .map((item) => ({
            text: typeof item.step === 'string' ? item.step : '',
            status: typeof item.status === 'string' ? item.status : 'pending',
          }))
          .filter((item) => item.text.trim()),
      },
      toolCallId,
    };
  }

  if (payload.name === 'spawn_agent' && payload.namespace === 'multi_agent_v1') {
    const input = parseJsonRecord(payload.arguments);
    return {
      type: 'tool_use',
      timestamp,
      toolName: 'Task',
      toolInput: {
        subagent_type: typeof input?.agent_type === 'string' ? input.agent_type : 'default',
        description: typeof input?.message === 'string' ? input.message.split('\n')[0] : 'Subagent',
        prompt: typeof input?.message === 'string' ? input.message : '',
      },
      toolCallId,
    };
  }

  let toolName = payload.name;
  let toolInput = payload.arguments;
  if (toolName === 'shell_command') {
    toolName = 'Bash';
    const args = parseJsonRecord(payload.arguments);
    if (typeof args?.command === 'string') {
      toolInput = JSON.stringify({ command: args.command });
    }
  }

  return { type: 'tool_use', timestamp, toolName, toolInput, toolCallId };
}
```

Add the tiny parser helper near it:

```ts
function parseJsonRecord(value: unknown): AnyRecord | null {
  if (typeof value !== 'string') return readObjectRecord(value);
  try {
    return readObjectRecord(JSON.parse(value));
  } catch {
    return null;
  }
}
```

Replace the old inline `function_call` block with:

```ts
        const tool = codexFunctionCallToTool(entry);
        if (tool) {
          messages.push(tool);
        }
```

- [ ] **Step 7: Attach matching child tools to parent spawn row**

After parent `messages` are parsed and before sorting/pagination, add a helper:

```ts
async function attachCodexSubagentTools(
  messages: AnyRecord[],
  parentSessionId: string,
  sessionFilePath: string,
): Promise<void> {
  const rootDir = path.join(os.homedir(), '.codex', 'sessions');
  // ponytail: O(n) transcript scan; replace with an index if large Codex histories make parent loading slow.
  const childFiles = await findCodexSubagentTranscriptFiles(parentSessionId, rootDir);
  if (childFiles.length === 0) return;

  const spawnByAgentId = new Map<string, AnyRecord>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type !== 'tool_result') continue;
    const result = parseJsonRecord(message.output);
    const agentId = typeof result?.agent_id === 'string' ? result.agent_id : undefined;
    if (!agentId) continue;
    const spawn = messages.find((candidate) => (
      candidate.type === 'tool_use'
      && candidate.toolName === 'Task'
      && candidate.toolCallId === message.toolCallId
    ));
    if (spawn) spawnByAgentId.set(agentId, spawn);
  }

  for (const childFile of childFiles) {
    const meta = await readCodexTranscriptMeta(childFile);
    if (!meta) continue;
    const spawn = spawnByAgentId.get(meta.sessionId);
    if (!spawn) continue;

    const child = await readCodexSessionFileMessages(childFile);
    spawn.subagentTools = child.messages
      .filter((message) => message.type === 'tool_use')
      .map((message) => ({
        toolId: message.toolCallId || generateMessageId('codex-subagent-tool'),
        toolName: message.toolName || 'Unknown',
        toolInput: message.toolInput,
        timestamp: message.timestamp || new Date().toISOString(),
        toolResult: null,
      }));
  }
}
```

Refactor the body of `getCodexSessionMessages()` so file parsing lives in:

```ts
async function readCodexSessionFileMessages(filePath: string): Promise<{ messages: AnyRecord[]; tokenUsage: AnyRecord | null }>
```

Then `getCodexSessionMessages()` calls `readCodexSessionFileMessages(sessionFilePath)`, calls `attachCodexSubagentTools(messages, providerSessionId, sessionFilePath)`, then sorts and paginates.

- [ ] **Step 8: Run Codex tests verify pass**

Run:

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/modules/providers/tests/codex-sessions.test.ts server/modules/providers/tests/codex-transcripts.test.ts server/modules/providers/tests/claude-sessions.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/modules/providers/list/codex/codex-sessions.provider.ts server/modules/providers/tests/codex-sessions.test.ts
git commit -m "feat: group codex subagents in parent chat"
```

### Task 4: Frontend Todo Summary Handles `update_plan` Snapshots

**Files:**
- Modify: `src/components/chat/utils/agentTodoSummary.ts`
- Test: `src/components/chat/utils/agentTodoSummary.test.ts`

**Interfaces:**
- Consumes: child tool shape `{ toolName: 'TodoList', toolInput: { items: [{ text, status }] } }`
- Preserves: existing `TodoWrite`, `TodoRead`, and `TodoList` behavior

- [ ] **Step 1: Add regression test for grouped subagent todos**

Append to `src/components/chat/utils/agentTodoSummary.test.ts`:

```ts
test('grouped Codex subagent TodoList snapshots show as subagent todos', () => {
  const summaries = deriveAgentTodoSummaries([
    {
      type: 'assistant',
      timestamp: 1000,
      isToolUse: true,
      toolName: 'Task',
      toolId: 'spawn-1',
      toolInput: { description: 'banner-test' },
      subagentState: {
        currentToolIndex: 0,
        isComplete: true,
        childTools: [
          {
            toolId: 'plan-1',
            toolName: 'TodoList',
            timestamp: new Date(2000),
            toolInput: {
              items: [
                { text: 'say hello', status: 'completed' },
                { text: 'say bye', status: 'completed' },
                { text: 'say thanks', status: 'completed' },
              ],
            },
          },
        ],
      },
    },
  ]);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.label, 'banner-test');
  assert.equal(summaries[0]?.completedCount, 3);
  assert.deepEqual(summaries[0]?.todos.map((todo) => todo.content), [
    'say hello',
    'say bye',
    'say thanks',
  ]);
});
```

- [ ] **Step 2: Run test**

Run:

```bash
node --import tsx --test src/components/chat/utils/agentTodoSummary.test.ts
```

Expected: PASS. If this fails, fix only `TodoList` normalization for `{ text, status }`.

- [ ] **Step 3: Commit if code changed**

If the test already passes, commit only the test:

```bash
git add src/components/chat/utils/agentTodoSummary.test.ts
git commit -m "test: cover grouped codex subagent todos"
```

If code changed, include both files:

```bash
git add src/components/chat/utils/agentTodoSummary.ts src/components/chat/utils/agentTodoSummary.test.ts
git commit -m "fix: show grouped codex subagent todos"
```

### Task 5: Claude Parity Check

**Files:**
- Modify: `server/modules/providers/tests/claude-sessions.test.ts`

**Interfaces:**
- Verifies existing Claude behavior only
- Preserves: Claude subagent transcripts stay out of top-level sidebar sessions

- [ ] **Step 1: Add Claude subagent skip regression test**

Append to `server/modules/providers/tests/claude-sessions.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';

test('Claude synchronizer skips internal subagent transcript paths', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-subagent-sync-'));
  const filePath = path.join(dir, 'parent-session', 'subagents', 'agent-child.jsonl');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, [
    JSON.stringify({
      type: 'user',
      sessionId: 'parent-session',
      cwd: '/workspace/demo',
      message: { role: 'user', content: 'subagent work' },
    }),
  ].join('\n'), 'utf8');

  const synchronizer = new ClaudeSessionSynchronizer();

  assert.equal(await synchronizer.synchronizeFile(filePath), null);
});
```

- [ ] **Step 2: Run Claude parity test**

Run:

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/modules/providers/tests/claude-sessions.test.ts
```

Expected: PASS. If it fails, fix only the existing Claude internal transcript filter.

- [ ] **Step 3: Commit**

```bash
git add server/modules/providers/tests/claude-sessions.test.ts
git commit -m "test: cover claude subagent transcript skip"
```

### Task 6: Final Verification

**Files:**
- Verify only

**Interfaces:**
- Verifies all earlier tasks together

- [ ] **Step 1: Run focused tests**

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/modules/providers/tests/codex-sessions.test.ts server/modules/providers/tests/codex-transcripts.test.ts server/modules/providers/tests/claude-sessions.test.ts
node --import tsx --test src/components/chat/utils/agentTodoSummary.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck -- --pretty false
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

```bash
git diff --stat HEAD~5..HEAD
git status --short
```

Expected: only Codex transcript/session files, Codex tests, Claude parity test, and todo summary test changed. Existing unrelated untracked docs may still appear.
