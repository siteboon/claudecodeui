import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { buildLookupMap } from '@/shared/utils.js';

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

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

/**
 * Writes a minimal valid Claude JSONL session file with enough fields for
 * `extractFirstValidJsonlData` to parse `sessionId` and `cwd`.
 */
async function writeSessionJsonl(
  dirPath: string,
  fileName: string,
  lines: string[],
): Promise<string> {
  const filePath = path.join(dirPath, fileName);
  const head = [
    JSON.stringify({ type: 'mode', mode: 'normal', sessionId: 'test-session-1' }),
    JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'test-session-1' }),
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content: 'first prompt' },
      uuid: 'msg-1',
      timestamp: '2026-07-10T00:00:00.000Z',
      cwd: '/workspace/demo',
      sessionId: 'test-session-1',
    }),
  ];
  const content = [...head, ...lines, ''].join('\n');
  await writeFile(filePath, content, 'utf8');
  return filePath;
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

const EDIT_SESSION_ID = 'claude-edit-session';

/**
 * Writes a transcript where one prompt was edited: the replacement shares a
 * parent with the original, which is the shape Claude's resume-partway leaves
 * behind. Nothing is deleted from the file.
 */
async function writeEditedTranscript(projectDirectory: string): Promise<string> {
  const transcriptPath = path.join(projectDirectory, `${EDIT_SESSION_ID}.jsonl`);
  const rows = [
    {
      type: 'user', uuid: 'u1', parentUuid: null, sessionId: EDIT_SESSION_ID,
      timestamp: '2026-08-23T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'first prompt' }] },
    },
    {
      type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: EDIT_SESSION_ID,
      timestamp: '2026-08-23T10:00:01.000Z',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'first answer' }] },
    },
    {
      type: 'user', uuid: 'u2', parentUuid: 'a1', sessionId: EDIT_SESSION_ID,
      timestamp: '2026-08-23T10:00:02.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'original second prompt' }] },
    },
    {
      type: 'assistant', uuid: 'a2', parentUuid: 'u2', sessionId: EDIT_SESSION_ID,
      timestamp: '2026-08-23T10:00:03.000Z',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'answer to be replaced' }] },
    },
    // The edit: same parent as u2, written later.
    {
      type: 'user', uuid: 'u2b', parentUuid: 'a1', sessionId: EDIT_SESSION_ID,
      timestamp: '2026-08-23T10:00:04.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'edited second prompt' }] },
    },
    {
      type: 'assistant', uuid: 'a2b', parentUuid: 'u2b', sessionId: EDIT_SESSION_ID,
      timestamp: '2026-08-23T10:00:05.000Z',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'answer to the edit' }] },
    },
  ];

  await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return transcriptPath;
}

test('an edited prompt replaces the one it superseded instead of stacking on it', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-edit-history-'));

  try {
    const transcriptPath = await writeEditedTranscript(tempRoot);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(EDIT_SESSION_ID, 'claude', tempRoot, 'Edited session', now, now, transcriptPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(EDIT_SESSION_ID, {
        providerSessionId: EDIT_SESSION_ID,
      });
      const texts = history.messages.map((message) => message.content);

      assert.deepEqual(texts, [
        'first prompt',
        'first answer',
        'edited second prompt',
        'answer to the edit',
      ]);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('parallel tool calls are not mistaken for an edit', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-parallel-tools-'));
  const sessionId = 'claude-parallel-session';

  try {
    const transcriptPath = path.join(tempRoot, `${sessionId}.jsonl`);
    // One assistant turn issuing two tools: each tool_result parents onto the
    // same row, so this row has two children — a branch point that must not be
    // pruned, or tool output disappears from every transcript in the app.
    const rows = [
      {
        type: 'user', uuid: 'p1', parentUuid: null, sessionId,
        timestamp: '2026-08-23T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'do two things' }] },
      },
      {
        type: 'assistant', uuid: 'pa1', parentUuid: 'p1', sessionId,
        timestamp: '2026-08-23T10:00:01.000Z',
        message: {
          role: 'assistant', model: 'claude-opus-5',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/a' } }],
        },
      },
      {
        type: 'user', uuid: 'pr1', parentUuid: 'pa1', sessionId,
        timestamp: '2026-08-23T10:00:02.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'contents of a' }] },
      },
      {
        type: 'user', uuid: 'pr2', parentUuid: 'pa1', sessionId,
        timestamp: '2026-08-23T10:00:03.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: 'contents of b' }] },
      },
    ];
    await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(sessionId, 'claude', tempRoot, 'Parallel tools', now, now, transcriptPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(sessionId, {
        providerSessionId: sessionId,
      });

      assert.equal(
        history.messages.some((message) => message.content === 'do two things'),
        true,
      );
      const toolRow = history.messages.find((message) => message.kind === 'tool_use');
      assert.ok(toolRow, 'the tool call survives');
      assert.equal(toolRow?.toolResult?.content, 'contents of a');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('resolving an edit anchor returns the assistant turn before it', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-edit-anchor-'));

  try {
    const transcriptPath = await writeEditedTranscript(tempRoot);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(EDIT_SESSION_ID, 'claude', tempRoot, 'Edited session', now, now, transcriptPath);
      const provider = new ClaudeSessionsProvider();

      // Resuming is inclusive of the row it names, so replacing `u2b` must
      // resume through `a1` — naming `u2b` itself would leave the prompt being
      // replaced in context.
      assert.deepEqual(
        await provider.resolveEditAnchor(EDIT_SESSION_ID, 'u2b'),
        { found: true, resumeThroughId: 'a1' },
      );

      // Nothing precedes the first prompt, so the conversation starts over.
      assert.deepEqual(
        await provider.resolveEditAnchor(EDIT_SESSION_ID, 'u1'),
        { found: true, resumeThroughId: null },
      );

      assert.deepEqual(
        await provider.resolveEditAnchor(EDIT_SESSION_ID, 'not-in-transcript'),
        { found: false, resumeThroughId: null },
      );
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('user turns carry the transcript uuid so they can be edited', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-anchor-ids-'));

  try {
    const transcriptPath = await writeEditedTranscript(tempRoot);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(EDIT_SESSION_ID, 'claude', tempRoot, 'Edited session', now, now, transcriptPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(EDIT_SESSION_ID, {
        providerSessionId: EDIT_SESSION_ID,
      });

      const userRows = history.messages.filter((message) => message.role === 'user');
      assert.deepEqual(
        userRows.map((message) => message.transcriptAnchorId),
        ['u1', 'u2b'],
      );
      // Assistant rows are never an anchor: the UI only offers editing on a
      // turn the user typed.
      assert.equal(
        history.messages.some((message) => message.role !== 'user' && message.transcriptAnchorId),
        false,
      );
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('resolving an edit anchor skips rows that are not conversation turns', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-anchor-skip-'));
  const sessionId = 'claude-anchor-skip-session';

  try {
    const transcriptPath = path.join(tempRoot, `${sessionId}.jsonl`);
    // An attachment row sits between the assistant turn and the next prompt.
    // Resuming names an assistant message, so the walk has to pass over it —
    // naming the attachment would resume at something the SDK cannot address.
    const rows = [
      {
        type: 'user', uuid: 'su1', parentUuid: null, sessionId,
        timestamp: '2026-08-23T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      },
      {
        type: 'assistant', uuid: 'sa1', parentUuid: 'su1', sessionId,
        timestamp: '2026-08-23T10:00:01.000Z',
        message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'hi' }] },
      },
      {
        type: 'attachment', uuid: 'sat1', parentUuid: 'sa1', sessionId,
        timestamp: '2026-08-23T10:00:02.000Z',
      },
      {
        type: 'user', uuid: 'su2', parentUuid: 'sat1', sessionId,
        timestamp: '2026-08-23T10:00:03.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'second prompt' }] },
      },
    ];
    await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(sessionId, 'claude', tempRoot, 'Anchor skip', now, now, transcriptPath);

      assert.deepEqual(
        await new ClaudeSessionsProvider().resolveEditAnchor(sessionId, 'su2'),
        { found: true, resumeThroughId: 'sa1' },
      );
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// buildLookupMap
// ---------------------------------------------------------------------------

test('buildLookupMap returns first-seen value when key appears multiple times', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-lookup-'));
  const filePath = path.join(tmp, 'history.jsonl');
  try {
    await writeFile(
      filePath,
      [
        JSON.stringify({ sessionId: 's1', display: 'first-message' }),
        JSON.stringify({ sessionId: 's1', display: 'second-message' }),
        JSON.stringify({ sessionId: 's2', display: 'only-message' }),
      ].join('\n'),
      'utf8',
    );

    const map = await buildLookupMap(filePath, 'sessionId', 'display');

    assert.equal(map.size, 2);
    assert.equal(map.get('s1'), 'first-message');
    assert.equal(map.get('s2'), 'only-message');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('buildLookupMap returns empty map for missing file', async () => {
  const map = await buildLookupMap(path.join(os.tmpdir(), 'does-not-exist.jsonl'), 'k', 'v');
  assert.equal(map.size, 0);
});

test('buildLookupMap returns empty map for empty file', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-lookup-'));
  const filePath = path.join(tmp, 'empty.jsonl');
  try {
    await writeFile(filePath, '', 'utf8');
    const map = await buildLookupMap(filePath, 'k', 'v');
    assert.equal(map.size, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('buildLookupMap skips rows with non-string key or value', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-lookup-'));
  const filePath = path.join(tmp, 'history.jsonl');
  try {
    await writeFile(
      filePath,
      [
        JSON.stringify({ sessionId: 123, display: 'not-a-string-key' }),
        JSON.stringify({ sessionId: 's1', display: 456 }),
        JSON.stringify({ sessionId: 's1', display: 'valid-entry' }),
      ].join('\n'),
      'utf8',
    );

    const map = await buildLookupMap(filePath, 'sessionId', 'display');
    assert.equal(map.size, 1);
    assert.equal(map.get('s1'), 'valid-entry');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// extractSessionAiTitleFromEnd — tested via synchronizeFile
// ---------------------------------------------------------------------------

test('synchronizeFile uses ai-title from JSONL when no DB custom_name exists', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-aititle-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    // Create ~/.claude/history.jsonl with a competing display name.
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(
      path.join(claudeHome, 'history.jsonl'),
      JSON.stringify({ sessionId: 'test-session-1', display: 'user-first-prompt-from-history' }) + '\n',
      'utf8',
    );

    // Write session JSONL with ai-title before last-prompt.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({ type: 'ai-title', aiTitle: 'AI generated title', sessionId: 'test-session-1' }),
      JSON.stringify({
        parentUuid: 'msg-1',
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        type: 'assistant',
        uuid: 'msg-2',
      }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'first prompt', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result, 'synchronizeFile should return a session id');
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'AI generated title');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile uses custom-title from JSONL when no DB custom_name and no ai-title', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-customtitle-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(path.join(claudeHome, 'history.jsonl'), '', 'utf8');

    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({
        parentUuid: 'msg-1',
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        type: 'assistant',
        uuid: 'msg-2',
      }),
      JSON.stringify({ type: 'custom-title', customTitle: 'Renamed via cli', sessionId: 'test-session-1' }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'first prompt', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'Renamed via cli');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile falls back to history.jsonl display when JSONL has no title events', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-fallback-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(
      path.join(claudeHome, 'history.jsonl'),
      JSON.stringify({ sessionId: 'test-session-1', display: 'fallback display name' }) + '\n',
      'utf8',
    );

    // Session JSONL with NO ai-title, custom-title, or last-prompt.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({
        parentUuid: 'msg-1',
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        type: 'assistant',
        uuid: 'msg-2',
      }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'fallback display name');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile falls back to Untitled Claude Session when all sources are empty', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-untitled-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(path.join(claudeHome, 'history.jsonl'), '', 'utf8');

    // Session JSONL with NO title events at all.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({
        parentUuid: 'msg-1',
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        type: 'assistant',
        uuid: 'msg-2',
      }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'Untitled Claude Session');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Priority: DB custom_name > JSONL title > history.jsonl
// ---------------------------------------------------------------------------

test('synchronizeFile preserves existing DB custom_name regardless of JSONL and history.jsonl', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-dbwins-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(
      path.join(claudeHome, 'history.jsonl'),
      JSON.stringify({ sessionId: 'test-session-1', display: 'history-display-name' }) + '\n',
      'utf8',
    );

    // Write session JSONL with competing ai-title.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({ type: 'ai-title', aiTitle: 'JSONL ai title', sessionId: 'test-session-1' }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'first prompt', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      // Pre-seed the DB with a custom_name set via CloudCLI sidebar rename.
      sessionsDb.createSession(
        'test-session-1',
        'claude',
        workspacePath,
        'Sidebar custom name',
      );

      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      // DB custom_name must win over JSONL ai-title AND history.jsonl display.
      assert.equal(session?.custom_name, 'Sidebar custom name');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile does NOT treat "Untitled Claude Session" in DB as a real custom_name', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-untitled-db-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(path.join(claudeHome, 'history.jsonl'), '', 'utf8');

    // Session JSONL with an ai-title that should win over the DB default.
    await writeSessionJsonl(workspacePath, 'test-session-1.jsonl', [
      JSON.stringify({ type: 'ai-title', aiTitle: 'Real AI title from JSONL', sessionId: 'test-session-1' }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'first prompt', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      // Seed with the default fallback name — should be ignored.
      sessionsDb.createSession(
        'test-session-1',
        'claude',
        workspacePath,
        'Untitled Claude Session',
      );

      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(workspacePath, 'test-session-1.jsonl'),
      );

      assert.ok(result);
      const session = sessionsDb.getSessionById(result!);
      assert.equal(session?.custom_name, 'Real AI title from JSONL');
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('synchronizeFile skips subagent transcripts', { concurrency: false }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-subagent-'));
  const workspacePath = path.join(tmp, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tmp);

  try {
    const claudeHome = path.join(tmp, '.claude');
    await mkdir(claudeHome, { recursive: true });
    await writeFile(path.join(claudeHome, 'history.jsonl'), '', 'utf8');

    // Create a file whose path contains "subagents".
    const subagentsDir = path.join(workspacePath, 'test-session-1', 'subagents');
    await mkdir(subagentsDir, { recursive: true });
    await writeSessionJsonl(subagentsDir, 'agent-1.jsonl', [
      JSON.stringify({ type: 'ai-title', aiTitle: 'Subagent title', sessionId: 'test-session-1' }),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new ClaudeSessionSynchronizer();
      const result = await synchronizer.synchronizeFile(
        path.join(subagentsDir, 'agent-1.jsonl'),
      );

      // Subagent transcripts should be silently skipped (return null).
      assert.equal(result, null);
    });
  } finally {
    restoreHomeDir();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synchronizeFile skips non-jsonl files', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const synchronizer = new ClaudeSessionSynchronizer();
    const result = await synchronizer.synchronizeFile('/tmp/not-a-jsonl.txt');
    assert.equal(result, null);
  });
});
