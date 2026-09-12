import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const PROVIDER_SESSION_ID = 'provider-session-1';

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'claude-subagents-'));
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');

  closeConnection();
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const row = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  type: 'assistant',
  sessionId: PROVIDER_SESSION_ID,
  timestamp: '2026-09-11T10:00:00.000Z',
  message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'working' }] },
  ...overrides,
});

/** Writes a parent transcript naming the agent and (optionally) its notification. */
async function writeParentTranscript(parentPath: string, agentId: string, toolUseId: string | null, notification: string | null): Promise<void> {
  const lines = [row({ uuid: 'root', message: { role: 'user', content: 'go' } })];

  if (toolUseId) {
    lines.push(JSON.stringify({
      type: 'assistant',
      uuid: 'launch',
      parentUuid: 'root',
      sessionId: PROVIDER_SESSION_ID,
      timestamp: '2026-09-11T10:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: {} }] },
    }));
    // The real transcript carries the launch acknowledgement as a tool_result
    // row, and that is where the agent id lives — the roster's parent mapping
    // reads exactly this shape.
    lines.push(JSON.stringify({
      type: 'user',
      uuid: 'launch-result',
      parentUuid: 'launch',
      sessionId: PROVIDER_SESSION_ID,
      timestamp: '2026-09-11T10:00:02.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Async agent launched successfully', is_error: false }] },
      toolUseResult: { agentId },
    }));
  }

  if (notification && toolUseId) {
    lines.push(JSON.stringify({
      type: 'user',
      uuid: 'notify',
      parentUuid: 'launch-result',
      sessionId: PROVIDER_SESSION_ID,
      timestamp: '2026-09-11T10:05:00.000Z',
      message: { role: 'user', content: `<task-notification><tool-use-id>${toolUseId}</tool-use-id><status>completed</status><summary>done</summary><result>finished work</result></task-notification>` },
    }));
  }

  await writeFile(parentPath, lines.join('\n'), 'utf8');
}

async function writeAgentFiles(
  directory: string,
  agentId: string,
  options: { meta?: Record<string, unknown>; lines?: string[]; idleSeconds?: number } = {},
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const transcriptPath = path.join(directory, `agent-${agentId}.jsonl`);
  const body = (options.lines ?? [row({ uuid: `a-${agentId}-1` }), row({
    uuid: `a-${agentId}-2`,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${agentId}`, name: 'Bash', input: { command: 'ls' } }] },
  })]).join('\n');
  await writeFile(transcriptPath, `${body}\n`, 'utf8');
  await writeFile(
    transcriptPath.replace(/\.jsonl$/, '.meta.json'),
    JSON.stringify(options.meta ?? { agentType: 'Explore', description: 'survey the repo' }),
    'utf8',
  );

  if (options.idleSeconds) {
    const stamp = new Date(Date.now() - options.idleSeconds * 1000);
    await utimes(transcriptPath, stamp, stamp);
  }

  return transcriptPath;
}

async function seedSession(projectDir: string, parentPath: string): Promise<string> {
  const sessionId = sessionsDb.createSession(PROVIDER_SESSION_ID, 'claude', projectDir, undefined, undefined, undefined, parentPath);
  return sessionId;
}

test('the roster lists agents from the CLI directory, with meta and composed status', async () => {
  await withIsolatedDatabase(async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'subagents-project-'));
    const parentPath = path.join(projectDir, `${PROVIDER_SESSION_ID}.jsonl`);
    // alpha has a completion notification in the parent transcript; beta does not.
    await writeParentTranscript(parentPath, 'alpha', 'toolu_launch', 'completed');
    await writeAgentFiles(path.join(projectDir, PROVIDER_SESSION_ID, 'subagents'), 'alpha', {
      meta: { agentType: 'Explore', description: 'survey the repo', toolUseId: 'toolu_launch', spawnDepth: 1 },
    });
    // Running: parent is running and the file is fresh.
    await writeAgentFiles(path.join(projectDir, PROVIDER_SESSION_ID, 'subagents'), 'beta', {
      meta: { agentType: 'general-purpose', description: 'fix tests', toolUseId: 'toolu_beta' },
      idleSeconds: 5,
    });
    const sessionId = await seedSession(projectDir, parentPath);

    const provider = new ClaudeSessionsProvider();
    const summaries = await provider.listSubagents(sessionId, PROVIDER_SESSION_ID, true);

    assert.deepEqual(summaries.map((entry) => entry.agentId).sort(), ['alpha', 'beta']);
    const alpha = summaries.find((entry) => entry.agentId === 'alpha')!;
    assert.equal(alpha.status, 'completed');
    assert.equal(alpha.agentType, 'Explore');
    assert.equal(alpha.description, 'survey the repo');
    assert.equal(alpha.toolUseId, 'toolu_launch');
    assert.ok(alpha.activityCount > 0);

    // No notification for beta's tool use id, and the parent runs: fresh file = running.
    assert.equal(summaries.find((entry) => entry.agentId === 'beta')!.status, 'running');
  });
});

test('a quiet parent never reports a running agent', async () => {
  await withIsolatedDatabase(async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'subagents-project-'));
    const parentPath = path.join(projectDir, `${PROVIDER_SESSION_ID}.jsonl`);
    await writeParentTranscript(parentPath, 'alpha', 'toolu_launch', null);
    await writeAgentFiles(path.join(projectDir, PROVIDER_SESSION_ID, 'subagents'), 'alpha', { idleSeconds: 5 });
    const sessionId = await seedSession(projectDir, parentPath);

    const provider = new ClaudeSessionsProvider();
    const summaries = await provider.listSubagents(sessionId, PROVIDER_SESSION_ID, false);

    // parentRunning=false kills the heuristic even for a minutes-old file,
    // which is what stops a crashed run's leftover from spinning forever.
    assert.equal(summaries[0].status, 'completed');
  });
});

test('a fresh file under a running parent, with a failed notification, reports failed', async () => {
  await withIsolatedDatabase(async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'subagents-project-'));
    const parentPath = path.join(projectDir, `${PROVIDER_SESSION_ID}.jsonl`);
    await writeFile(parentPath, [
      JSON.stringify({
        type: 'assistant', uuid: 'launch', sessionId: PROVIDER_SESSION_ID, timestamp: '2026-09-11T10:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_launch', name: 'Agent', input: {} }] },
      }),
      JSON.stringify({
        type: 'user', uuid: 'launch-result', sessionId: PROVIDER_SESSION_ID, timestamp: '2026-09-11T10:00:01.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_launch', content: 'Async agent launched', is_error: false }] },
        toolUseResult: { agentId: 'alpha' },
      }),
      JSON.stringify({
        type: 'user', uuid: 'notify', sessionId: PROVIDER_SESSION_ID, timestamp: '2026-09-11T10:01:00.000Z',
        message: { role: 'user', content: '<task-notification><tool-use-id>toolu_launch</tool-use-id><status>failed</status><summary>crashed</summary><result></result></task-notification>' },
      }),
    ].join('\n'), 'utf8');
    await writeAgentFiles(path.join(projectDir, PROVIDER_SESSION_ID, 'subagents'), 'alpha', { idleSeconds: 1 });
    const sessionId = await seedSession(projectDir, parentPath);

    const provider = new ClaudeSessionsProvider();
    const summaries = await provider.listSubagents(sessionId, PROVIDER_SESSION_ID, true);
    assert.equal(summaries[0].status, 'failed');
  });
});

test('the history pages one agent transcript and matches tool results', async () => {
  await withIsolatedDatabase(async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'subagents-project-'));
    const parentPath = path.join(projectDir, `${PROVIDER_SESSION_ID}.jsonl`);
    await writeParentTranscript(parentPath, 'alpha', 'toolu_launch', null);
    const directory = path.join(projectDir, PROVIDER_SESSION_ID, 'subagents');
    await writeAgentFiles(directory, 'alpha', {
      lines: [
        row({ uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'starting' }] } }),
        row({ uuid: 'a2', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_x', name: 'Bash', input: { command: 'ls' } }] } }),
        row({ uuid: 'a3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'file list', is_error: false }] } }),
        row({ uuid: 'a4', message: { role: 'assistant', content: [{ type: 'text', text: 'done here' }] } }),
      ],
    });
    const sessionId = await seedSession(projectDir, parentPath);

    const provider = new ClaudeSessionsProvider();
    const firstPage = await provider.fetchSubagentHistory(sessionId, PROVIDER_SESSION_ID, 'alpha', { limit: 2, offset: 0 });
    // Four raw rows, three visible ones: the tool result folds into its call.
    assert.equal(firstPage.total, 3);
    assert.equal(firstPage.hasMore, true);
    // Tail page: the last two visible rows.
    assert.deepEqual(
      firstPage.messages.map((message) => message.kind),
      ['tool_use', 'text'],
    );
    const toolUse = firstPage.messages.find((message) => message.kind === 'tool_use');
    assert.equal(toolUse?.toolName, 'Bash');
    assert.equal(toolUse?.toolResult?.content, 'file list');
    // Agent rows carry no parent linkage; nothing should be grouped under it.
    assert.equal(toolUse?.parentToolUseId, undefined);

    const earlier = await provider.fetchSubagentHistory(sessionId, PROVIDER_SESSION_ID, 'alpha', { limit: 2, offset: 2 });
    assert.equal(earlier.messages.length, 1);
    assert.equal(earlier.hasMore, false);
  });
});

test('unknown agents and providers without the methods degrade to empty', async () => {
  await withIsolatedDatabase(async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'subagents-project-'));
    const parentPath = path.join(projectDir, `${PROVIDER_SESSION_ID}.jsonl`);
    await writeParentTranscript(parentPath, 'alpha', 'toolu_launch', null);
    const sessionId = await seedSession(projectDir, parentPath);

    const provider = new ClaudeSessionsProvider();
    assert.deepEqual(await provider.listSubagents(sessionId, PROVIDER_SESSION_ID, false), []);
    const empty = await provider.fetchSubagentHistory(sessionId, PROVIDER_SESSION_ID, 'ghost', { limit: 10 });
    assert.equal(empty.total, 0);
    assert.equal(empty.messages.length, 0);
  });
});

test('older layouts next to the parent transcript are still rostered', async () => {
  await withIsolatedDatabase(async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'subagents-project-'));
    const parentPath = path.join(projectDir, `${PROVIDER_SESSION_ID}.jsonl`);
    await writeParentTranscript(parentPath, 'legacy', 'toolu_legacy', null);
    await writeAgentFiles(projectDir, 'legacy', { idleSeconds: 1 });
    const sessionId = await seedSession(projectDir, parentPath);

    const provider = new ClaudeSessionsProvider();
    const summaries = await provider.listSubagents(sessionId, PROVIDER_SESSION_ID, false);
    assert.deepEqual(summaries.map((entry) => entry.agentId), ['legacy']);
  });
});
