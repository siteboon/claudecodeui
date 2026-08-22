import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-provider-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

const SESSION_ID = 'claude-session-1';
const AGENT_ID = 'a1b2c3d4e5f60718';
const AGENT_TOOL_USE_ID = 'toolu_agent_1';

/**
 * Writes the transcript pair current Claude versions produce for one async
 * subagent: the parent session, and the agent's own transcript plus sidecar
 * metadata under `<session>/subagents/`.
 */
async function writeClaudeSubagentSession(projectDirectory: string): Promise<string> {
  const parentPath = path.join(projectDirectory, `${SESSION_ID}.jsonl`);
  const subagentDirectory = path.join(projectDirectory, SESSION_ID, 'subagents');
  await mkdir(subagentDirectory, { recursive: true });

  const parentLines = [
    {
      type: 'assistant',
      uuid: 'assistant-1',
      sessionId: SESSION_ID,
      timestamp: '2026-08-21T10:00:00.000Z',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: AGENT_TOOL_USE_ID,
          name: 'Agent',
          input: { subagent_type: 'Explore', description: 'Survey the repo', prompt: 'Look around' },
        }],
      },
    },
    {
      type: 'user',
      uuid: 'launch-ack-1',
      sessionId: SESSION_ID,
      timestamp: '2026-08-21T10:00:01.000Z',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: AGENT_TOOL_USE_ID,
          content: 'Async agent launched successfully. agentId: internal bookkeeping',
        }],
      },
      toolUseResult: {
        isAsync: true,
        status: 'async_launched',
        agentId: AGENT_ID,
        description: 'Survey the repo',
        resolvedModel: 'claude-opus-5',
      },
    },
    {
      type: 'user',
      uuid: 'notification-1',
      sessionId: SESSION_ID,
      timestamp: '2026-08-21T10:05:00.000Z',
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: [
            '<task-notification>',
            `<task-id>${AGENT_ID}</task-id>`,
            `<tool-use-id>${AGENT_TOOL_USE_ID}</tool-use-id>`,
            '<status>completed</status>',
            '<summary>Agent "Survey the repo" finished</summary>',
            '<result>The repo has two packages.</result>',
            '</task-notification>',
          ].join('\n'),
        }],
      },
    },
  ];
  await writeFile(parentPath, `${parentLines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

  const agentLines = [
    {
      type: 'assistant',
      isSidechain: true,
      agentId: AGENT_ID,
      timestamp: '2026-08-21T10:00:30.000Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        content: [
          { type: 'text', text: 'Starting the survey.' },
          { type: 'tool_use', id: 'toolu_child_1', name: 'Read', input: { file_path: '/repo/package.json' } },
        ],
      },
    },
    {
      type: 'user',
      isSidechain: true,
      agentId: AGENT_ID,
      timestamp: '2026-08-21T10:00:31.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_child_1', content: '{"name":"repo"}' }],
      },
    },
  ];
  await writeFile(
    path.join(subagentDirectory, `agent-${AGENT_ID}.jsonl`),
    `${agentLines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    'utf8',
  );
  await writeFile(
    path.join(subagentDirectory, `agent-${AGENT_ID}.meta.json`),
    JSON.stringify({ agentType: 'Explore', description: 'Survey the repo', toolUseId: AGENT_TOOL_USE_ID, spawnDepth: 1 }),
    'utf8',
  );

  return parentPath;
}

test('Claude history attaches a subagent transcript stored under the session directory', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-subagent-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );

      assert.ok(agentRow, 'the Agent call must be in the transcript');
      assert.equal(agentRow.subagent?.id, AGENT_ID);
      assert.equal(agentRow.subagent?.type, 'Explore');
      assert.equal(agentRow.subagent?.description, 'Survey the repo');
      assert.equal(agentRow.subagent?.status, 'completed');

      // The agent's own work — prose and tool calls — comes from its separate
      // transcript, which is the file the previous lookup never found.
      assert.equal(agentRow.subagentTools?.length, 2);
      assert.equal(agentRow.subagentTools?.[0].kind, 'text');
      assert.equal(agentRow.subagentTools?.[1].toolName, 'Read');
      assert.equal(agentRow.subagentTools?.[1].toolResult?.content, '{"name":"repo"}');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history folds an agent task notification into the call that spawned it', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-notification-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );

      // The launch acknowledgement is internal bookkeeping; the agent's answer
      // is what belongs on its card.
      assert.equal(agentRow?.toolResult?.content, 'The repo has two packages.');

      const strayNotification = history.messages.find(
        (message) => typeof message.content === 'string' && message.content.includes('<task-notification>'),
      );
      assert.equal(strayNotification, undefined, 'the folded notification must not also render on its own');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/** Strips the `<task-notification>` turn so the agent has no reported outcome. */
async function dropTaskNotification(parentPath: string): Promise<void> {
  const raw = await readFile(parentPath, 'utf8');
  await writeFile(
    parentPath,
    `${raw.split('\n').filter((line) => line && !line.includes('task-notification')).join('\n')}\n`,
    'utf8',
  );
}

test('Claude history reads a missing notification off the agent\'s own transcript', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-finished-agent-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    await dropTaskNotification(parentPath);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );

      // The notification can be compacted out of a long session. The agent's
      // transcript ends on a resolved tool call, so it finished — reporting it
      // as still running would leave a spinner on the card forever.
      assert.equal(agentRow?.subagent?.status, 'completed');
      assert.equal(agentRow?.toolResult?.content, '', 'the launch acknowledgement must never show as a result');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history keeps an agent running when its transcript stops mid tool call', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-running-agent-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    await dropTaskNotification(parentPath);

    // Drop the child tool result: the agent is mid-call, which is the only
    // in-file evidence that it is still working.
    const agentPath = path.join(tempRoot, SESSION_ID, 'subagents', `agent-${AGENT_ID}.jsonl`);
    const agentRaw = await readFile(agentPath, 'utf8');
    await writeFile(
      agentPath,
      `${agentRaw.split('\n').filter((line) => line && !line.includes('tool_result')).join('\n')}\n`,
      'utf8',
    );

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );

      assert.equal(agentRow?.subagent?.status, 'running');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history trims a subagent timeline down to a preview', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-big-agent-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);

    // One child command with a very large output, which is what makes an
    // agent-heavy session's history payload balloon.
    const hugeOutput = 'x'.repeat(50_000);
    const agentPath = path.join(tempRoot, SESSION_ID, 'subagents', `agent-${AGENT_ID}.jsonl`);
    const agentRaw = await readFile(agentPath, 'utf8');
    const enlarged = agentRaw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const entry = JSON.parse(line) as { message?: { content?: Array<{ type?: string; content?: string }> } };
        for (const part of entry.message?.content ?? []) {
          if (part.type === 'tool_result') {
            part.content = hugeOutput;
          }
        }
        return JSON.stringify(entry);
      })
      .join('\n');
    await writeFile(agentPath, `${enlarged}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );
      const childResult = String(agentRow?.subagentTools?.[1].toolResult?.content ?? '');

      assert.ok(childResult.length < 6000, `nested output must be trimmed, got ${childResult.length}`);
      assert.match(childResult, /more characters$/, 'the trim must say how much was omitted');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
