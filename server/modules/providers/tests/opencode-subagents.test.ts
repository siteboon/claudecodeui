import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';

// A `task` call as opencode 1.18 stores it: the child session id lives in `state.metadata`.
const taskPart = (status: 'running' | 'completed' | 'error', metadata: Record<string, unknown> = {}) => ({
  type: 'tool',
  tool: 'task',
  callID: 'call_task',
  state: {
    status,
    input: { description: 'Count Markdown files', subagent_type: 'general', prompt: 'Count the .md files.' },
    ...(status === 'completed'
      ? { output: '<task id="ses_child" state="completed">\n<task_result>\n**3** files\n</task_result>\n</task>' }
      : {}),
    ...(status === 'error' ? { error: 'Tool execution aborted' } : {}),
    metadata: {
      parentSessionId: 'ses_parent',
      sessionId: 'ses_child',
      model: { modelID: 'gpt-6-luna', providerID: 'openai' },
      ...metadata,
    },
  },
});

async function withOpenCodeDatabase(
  parentTask: Record<string, unknown>,
  runTest: (provider: OpenCodeSessionsProvider, dataDir: string) => Promise<void>,
  extraChildSteps = 0,
): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-subagents-'));
  const originalHomedir = os.homedir;
  (os as any).homedir = () => homeDir;

  const dataDir = path.join(homeDir, '.local', 'share', 'opencode');
  await mkdir(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'opencode.db'));
  try {
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    const message = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
    const part = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)');

    db.prepare('INSERT INTO session VALUES (?, ?)').run('ses_parent', null);
    db.prepare('INSERT INTO session VALUES (?, ?)').run('ses_child', 'ses_parent');

    message.run('msg_p1', 'ses_parent', 1, JSON.stringify({ role: 'user' }));
    part.run('prt_p1', 'msg_p1', 'ses_parent', 1, JSON.stringify({ type: 'text', text: 'use a subagent' }));
    message.run('msg_p2', 'ses_parent', 2, JSON.stringify({ role: 'assistant' }));
    part.run('prt_p2', 'msg_p2', 'ses_parent', 2, JSON.stringify(parentTask));
    part.run('prt_p3', 'msg_p2', 'ses_parent', 3, JSON.stringify({
      type: 'tool', tool: 'glob', callID: 'call_parent_glob', state: { status: 'completed', input: {}, output: '' },
    }));

    // The child's own prompt is a user message: it is the call's input, not activity.
    message.run('msg_c1', 'ses_child', 10, JSON.stringify({ role: 'user' }));
    part.run('prt_c1', 'msg_c1', 'ses_child', 10, JSON.stringify({ type: 'text', text: 'Count the .md files.' }));
    message.run('msg_c2', 'ses_child', 11, JSON.stringify({ role: 'assistant' }));
    part.run('prt_c2', 'msg_c2', 'ses_child', 11, JSON.stringify({ type: 'reasoning', text: 'Globbing.' }));
    part.run('prt_c3', 'msg_c2', 'ses_child', 12, JSON.stringify({
      type: 'tool', tool: 'glob', callID: 'call_glob',
      state: { status: 'completed', input: { pattern: '**/*.md' }, output: 'a.md\nb.md\nc.md' },
    }));
    part.run('prt_c4', 'msg_c2', 'ses_child', 13, JSON.stringify({
      type: 'tool', tool: 'read', callID: 'call_read', state: { status: 'running', input: { filePath: 'a.md' } },
    }));
    part.run('prt_c5', 'msg_c2', 'ses_child', 14, JSON.stringify({ type: 'text', text: '3' }));
    for (let step = 0; step < extraChildSteps; step += 1) {
      part.run(`prt_x${String(step).padStart(4, '0')}`, 'msg_c2', 'ses_child', 100 + step, JSON.stringify({
        type: 'tool', tool: 'read', callID: `call_x${step}`, state: { status: 'completed', input: {}, output: '' },
      }));
    }
  } finally {
    db.close();
  }

  try {
    await runTest(new OpenCodeSessionsProvider(), dataDir);
  } finally {
    (os as any).homedir = originalHomedir;
    await rm(homeDir, { recursive: true, force: true });
  }
}

const readTask = async (provider: OpenCodeSessionsProvider) => {
  const history = await provider.fetchHistory('app-session', { providerSessionId: 'ses_parent' });
  return { history, task: history.messages.find((message) => message.toolName === 'task') };
};

test('a task call in history becomes a subagent container with the child session timeline', { concurrency: false }, async () => {
  await withOpenCodeDatabase(taskPart('completed'), async (provider) => {
    const { history, task } = await readTask(provider);

    assert.deepEqual(task?.subagent, {
      id: 'ses_child',
      type: 'general',
      description: 'Count Markdown files',
      status: 'completed',
      model: 'gpt-6-luna',
      activityCount: 4,
    });
    assert.deepEqual(
      task?.subagentTools?.map((entry) => [entry.kind, entry.toolName ?? entry.content, entry.toolResult?.content ?? null]),
      [
        ['thinking', 'Globbing.', null],
        ['tool', 'glob', 'a.md\nb.md\nc.md'],
        ['tool', 'read', null],
        ['text', '3', null],
      ],
    );
    // The answer is shown without the tool's own wrapper, so it renders as markdown.
    assert.equal(task?.toolResult?.content, '**3** files');

    const otherTool = history.messages.find((message) => message.toolName === 'glob');
    assert.equal(otherTool?.subagent, undefined);
  });
});

test('a task left running with no live run is shown as stopped, with what it did so far', { concurrency: false }, async () => {
  await withOpenCodeDatabase(taskPart('running'), async (provider) => {
    const { task } = await readTask(provider);

    assert.equal(task?.subagent?.status, 'stopped');
    assert.equal(task?.toolResult, undefined);
    assert.equal(task?.subagentTools?.length, 4);
  });
});

test('a task the user interrupted is shown as stopped, not failed', { concurrency: false }, async () => {
  await withOpenCodeDatabase(taskPart('error', { interrupted: true }), async (provider) => {
    const { task } = await readTask(provider);

    assert.equal(task?.subagent?.status, 'stopped');
  });
});

test('a failed task is reported as a failed subagent', { concurrency: false }, async () => {
  const failed = taskPart('error');
  failed.state.error = '<task id="ses_child" state="error">\n<task_error>\nboom\n</task_error>\n</task>';
  await withOpenCodeDatabase(failed, async (provider) => {
    const { task } = await readTask(provider);

    assert.equal(task?.subagent?.status, 'failed');
    assert.equal(task?.toolResult?.isError, true);
    assert.equal(task?.toolResult?.content, 'boom');
  });
});

test('a long subagent keeps its latest steps and reports the full count', { concurrency: false }, async () => {
  await withOpenCodeDatabase(taskPart('completed'), async (provider) => {
    const { task } = await readTask(provider);

    assert.equal(task?.subagent?.activityCount, 254);
    assert.equal(task?.subagentTools?.length, 200);
    assert.equal(task?.subagentTools?.at(-1)?.toolId, 'call_x249');
  }, 250);
});

test('the live task event carries the subagent and its timeline', { concurrency: false }, async () => {
  await withOpenCodeDatabase(taskPart('completed'), async (provider) => {
    const [message] = provider.normalizeMessage({
      type: 'tool_use',
      sessionID: 'ses_parent',
      part: { id: 'prt_p2', messageID: 'msg_p2', sessionID: 'ses_parent', ...taskPart('completed') },
    }, 'app-session');

    assert.equal(message?.id, 'msg_p2_prt_p2');
    assert.equal(message?.subagent?.type, 'general');
    assert.equal(message?.subagent?.status, 'completed');
    assert.equal(message?.subagentTools?.length, 4);
    assert.equal(message?.toolResult?.content, '**3** files');
  });
});

test('a live task still renders as a subagent when the database cannot be opened', { concurrency: false }, async () => {
  await withOpenCodeDatabase(taskPart('completed'), async (provider, dataDir) => {
    const dbPath = path.join(dataDir, 'opencode.db');
    await rm(dbPath);
    await mkdir(dbPath);

    const [message] = provider.normalizeMessage({ type: 'tool_use', part: taskPart('completed') }, 'app-session');

    assert.equal(message?.subagent?.status, 'completed');
    assert.equal(message?.subagentTools, undefined);
  });
});

test('a task whose child session is missing still renders as a subagent, without a timeline', { concurrency: false }, async () => {
  await withOpenCodeDatabase(taskPart('completed'), async (provider) => {
    const [message] = provider.normalizeMessage({
      type: 'tool_use',
      part: taskPart('completed', { sessionId: 'ses_gone' }),
    }, 'app-session');

    assert.equal(message?.subagent?.id, 'ses_gone');
    assert.equal(message?.subagentTools, undefined);
  });
});

test('a flat task event with an output is reported as completed', { concurrency: false }, async () => {
  await withOpenCodeDatabase(taskPart('completed'), async (provider) => {
    const [message] = provider.normalizeMessage({
      type: 'tool_use',
      tool: 'task',
      input: { subagent_type: 'general', description: 'Count' },
      output: '3',
    }, 'app-session');

    assert.equal(message?.subagent?.status, 'completed');
  });
});
