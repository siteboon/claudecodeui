import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/**
 * Rewrites the notification turn into the shape the harness writes when it
 * consumes the report inline, while the parent turn is still running: a
 * top-level `queue-operation` record with the payload in `content`, no
 * `message`, no `uuid`, and no user-role turn anywhere in the file.
 */
async function useQueueOperationNotification(
  parentPath: string,
  operation: 'remove' | 'enqueue',
): Promise<void> {
  const lines = (await readFile(parentPath, 'utf8')).split('\n').filter(Boolean);
  const rewritten = lines.map((line) => {
    const row = JSON.parse(line) as Record<string, any>;
    if (!line.includes('task-notification')) {
      return line;
    }

    return JSON.stringify({
      type: 'queue-operation',
      operation,
      timestamp: row.timestamp,
      sessionId: row.sessionId,
      content: row.message.content[0].text,
    });
  });
  await writeFile(parentPath, `${rewritten.join('\n')}\n`, 'utf8');
}

for (const operation of ['remove', 'enqueue'] as const) {
  test(`Claude history folds a ${operation} queue-operation notification onto the agent card`, { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-queued-notification-'));

    try {
      const parentPath = await writeClaudeSubagentSession(tempRoot);
      await useQueueOperationNotification(parentPath, operation);

      await withIsolatedDatabase(async () => {
        const now = new Date().toISOString();
        sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

        const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
          providerSessionId: SESSION_ID,
        });
        const agentRow = history.messages.find(
          (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
        );

        // The report is in the file, just in the shape the collector used to
        // skip — so the card has to read exactly as it does for a user-role
        // notification: the agent's answer on the card, and a settled status.
        assert.equal(agentRow?.toolResult?.content, 'The repo has two packages.');
        assert.equal(agentRow?.subagent?.status, 'completed');

        const strayNotification = history.messages.find(
          (message) => typeof message.content === 'string' && message.content.includes('<task-notification>'),
        );
        assert.equal(strayNotification, undefined, 'a folded notification must never also render on its own');
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
}

test('Claude history keeps rows that have no uuid when a queue-operation notification is folded', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-uuidless-row-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    await useQueueOperationNotification(parentPath, 'remove');
    // A queue-operation record carries no `uuid`, so folding it must not put an
    // empty string in the drop set — that would match every other uuid-less row
    // and delete it from the transcript.
    await writeFile(
      parentPath,
      `${(await readFile(parentPath, 'utf8')).trim()}\n${JSON.stringify({
        type: 'assistant',
        sessionId: SESSION_ID,
        timestamp: '2026-08-21T10:06:00.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'A row with no uuid.' }] },
      })}\n`,
      'utf8',
    );

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });

      assert.ok(
        history.messages.some((message) => message.content === 'A row with no uuid.'),
        'a row without a uuid must survive the fold',
      );
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history drops every notification row of a task that reported more than once', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-renotified-agent-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    // A resumed session first reports the task as stopped ("no completion
    // record was found"), then the task finishes and reports again. The last
    // word is what the card shows; the earlier row is superseded bookkeeping
    // and must not linger as a bubble of its own.
    const lines = (await readFile(parentPath, 'utf8')).split('\n').filter(Boolean);
    const [notificationLine] = lines.filter((line) => line.includes('task-notification'));
    const completed = JSON.parse(notificationLine) as Record<string, any>;
    const stopped = {
      ...completed,
      uuid: 'notification-0',
      timestamp: '2026-08-21T10:04:00.000Z',
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: completed.message.content[0].text
            .replace('<status>completed</status>', '<status>stopped</status>')
            .replace(/<result>[\s\S]*<\/result>/, '')
            .replace(/<summary>[^<]*<\/summary>/, '<summary>No completion record was found for this agent</summary>'),
        }],
      },
    };
    const rewritten = lines.flatMap((line) => (line === notificationLine ? [JSON.stringify(stopped), line] : [line]));
    await writeFile(parentPath, `${rewritten.join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider().fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );

      assert.equal(agentRow?.subagent?.status, 'completed');
      assert.equal(agentRow?.toolResult?.content, 'The repo has two packages.');
      assert.ok(
        !history.messages.some((message) => (message.content ?? '').includes('<task-notification>')),
        'no notification row may render on its own once the task is folded',
      );
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

test('Claude history keeps a background agent running until its outcome is reported', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-live-agent-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    await dropTaskNotification(parentPath);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      // The run that launched the agent is still up, so it can still report.
      const liveRunStartedAt = Date.parse('2026-08-21T09:59:00.000Z');
      const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => liveRunStartedAt }).fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );

      // This agent's transcript ends on a resolved tool call, which used to be
      // read as proof it had finished. A background agent routinely stops there
      // while its work is outstanding — it says it is waiting on something and
      // ends its turn — so the transcript proves nothing and only the
      // notification does. Reporting `completed` here dropped the spinner and
      // collapsed the card while the agent was still working.
      assert.equal(agentRow?.subagent?.status, 'running');
      assert.equal(agentRow?.toolResult?.content, '', 'the launch acknowledgement must never show as a result');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history reports a background agent stopped once its session process is gone', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-stopped-agent-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    await dropTaskNotification(parentPath);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      // A background agent runs inside the session's CLI process. With that
      // process gone — the run was stopped, or crashed — an agent that never
      // reported never will, and "still running" would pin a spinner on the
      // card forever.
      const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => null }).fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );

      assert.equal(agentRow?.subagent?.status, 'stopped');
      assert.equal(agentRow?.toolResult?.content, '', 'the launch acknowledgement must never show as a result');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history reports a background agent stopped when a later run of the session is live', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-orphaned-agent-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    await dropTaskNotification(parentPath);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      // Each turn of a session is its own CLI process. The agent was launched
      // at 10:00:01 by a process that has since exited; the run up now started
      // an hour later and cannot deliver that agent's report. Reading it as
      // `running` made an orphaned card flicker back to a spinner on every
      // later turn.
      const laterRunStartedAt = Date.parse('2026-08-21T11:00:00.000Z');
      const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => laterRunStartedAt }).fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );

      assert.equal(agentRow?.subagent?.status, 'stopped');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history asks after the session process by both the app and the provider session id', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-liveness-keys-'));
  const appSessionId = 'app-session-1';

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    await dropTaskNotification(parentPath);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      // The DB row carries the app-facing id; the transcript rows carry the
      // provider-native one. The runtime keys its process map by whichever
      // id started the run — the app id from the chat gateway, the provider
      // id from the agent API — so a probe that knows only one of them must
      // still find the run.
      sessionsDb.createSession(appSessionId, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      for (const liveId of [appSessionId, SESSION_ID]) {
        const history = await new ClaudeSessionsProvider({
          getLiveRunStartTime: (sessionId) => (sessionId === liveId ? Date.parse('2026-08-21T09:59:00.000Z') : null),
        }).fetchHistory(appSessionId, { providerSessionId: SESSION_ID });
        const agentRow = history.messages.find(
          (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
        );

        assert.equal(agentRow?.subagent?.status, 'running', `a run keyed by ${liveId} must read as live`);
      }
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/** Removes the agent's own transcript and sidecar, leaving only the parent's rows. */
async function dropSubagentTranscript(projectDirectory: string): Promise<void> {
  await rm(path.join(projectDirectory, SESSION_ID, 'subagents'), { recursive: true, force: true });
}

for (const reported of ['completed', 'failed'] as const) {
  test(`Claude history settles a ${reported} background agent from its notification when its transcript is missing`, { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-transcriptless-agent-'));

    try {
      const parentPath = await writeClaudeSubagentSession(tempRoot);
      await useQueueOperationNotification(parentPath, 'remove');
      await writeFile(
        parentPath,
        (await readFile(parentPath, 'utf8')).replace('<status>completed</status>', `<status>${reported}</status>`),
        'utf8',
      );
      await dropSubagentTranscript(tempRoot);

      await withIsolatedDatabase(async () => {
        const now = new Date().toISOString();
        sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

        // The notification is the only record of the outcome, and it is
        // enough: the agent's own transcript names its timeline, not whether
        // it finished. Folding the answer onto the card while leaving the
        // status unset read as `running` on a card whose result said "done".
        const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => null }).fetchHistory(SESSION_ID, {
          providerSessionId: SESSION_ID,
        });
        const agentRow = history.messages.find(
          (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
        );

        assert.equal(agentRow?.toolResult?.content, 'The repo has two packages.');
        assert.equal(agentRow?.subagent?.status, reported);
        assert.equal(agentRow?.subagent?.id, AGENT_ID);
        assert.equal(agentRow?.subagent?.description, 'Survey the repo');
        assert.equal(agentRow?.subagent?.model, 'claude-opus-5');
        assert.equal(agentRow?.subagentTools, undefined, 'there is no timeline to show without a transcript');
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
}

test('Claude history reports a forked background agent stopped: no transcript, no notification, no process', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-forked-agent-'));

  try {
    // A fork copies the parent's `.jsonl` rows and nothing else — no
    // `subagents/` directory and no queue-operation records — and the new
    // session has no process of its own yet.
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    await dropTaskNotification(parentPath);
    await dropSubagentTranscript(tempRoot);

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(SESSION_ID, 'claude', tempRoot, 'Subagent session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => null }).fetchHistory(SESSION_ID, {
        providerSessionId: SESSION_ID,
      });
      const agentRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === AGENT_TOOL_USE_ID,
      );

      // Without `subagent` the card falls back to "async launch, therefore
      // running", which is the spinner that never went away.
      assert.equal(agentRow?.subagent?.status, 'stopped');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('a live SDK tool result keeps its launch metadata under the stream key', () => {
  // The transcript spells it `toolUseResult`; the SDK stream spells it
  // `tool_use_result`. Reading only the former sent every live agent launch to
  // the client without `isAsync`, so the card could not tell the launch
  // acknowledgement apart from an answer and settled the agent at launch.
  const [normalized] = new ClaudeSessionsProvider().normalizeMessage({
    type: 'user',
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    uuid: 'launch-ack-live',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: AGENT_TOOL_USE_ID,
        content: 'Async agent launched successfully. agentId: internal bookkeeping',
      }],
    },
    tool_use_result: { isAsync: true, status: 'async_launched', agentId: AGENT_ID },
  }, SESSION_ID);

  assert.equal(normalized?.kind, 'tool_result');
  assert.equal((normalized?.toolUseResult as { isAsync?: boolean } | undefined)?.isAsync, true);
});

test('a live SDK tool result caps the strings inside its structured output', () => {
  // The stream's `tool_use_result` is the tool's whole structured output — an
  // Edit's carries the entire file it edited — and it is sent to every client
  // and kept in the run's replay buffer. The transcript path caps each nested
  // string at the same limit before it leaves the server; the live path must
  // not be the one place that forwards it whole.
  const [normalized] = new ClaudeSessionsProvider().normalizeMessage({
    type: 'user',
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    uuid: 'edit-result-live',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_edit', content: 'The file has been updated.' }],
    },
    tool_use_result: { filePath: '/repo/big.ts', originalFile: 'x'.repeat(50_000) },
  }, SESSION_ID);

  const forwarded = normalized?.toolUseResult as { filePath?: string; originalFile?: string } | undefined;
  assert.equal(forwarded?.filePath, '/repo/big.ts');
  assert.ok(forwarded?.originalFile && forwarded.originalFile.length < 50_000, 'the file body must be capped');
  assert.match(forwarded?.originalFile ?? '', /… 10000 more characters$/);
});

const WORKFLOW_SESSION_ID = 'claude-workflow-session';
const WORKFLOW_TOOL_USE_ID = 'toolu_workflow_1';
const WORKFLOW_RUN_ID = 'wf_16fbf852-274';
const WORKFLOW_TASK_ID = 'wxkj4kcvd';
const WORKFLOW_SCRIPT = [
  'export const meta = {',
  "  name: 'frontend-architecture-audit',",
  "  description: 'Evidence-based audit of the frontend',",
  "  phases: [{ title: 'Audit', detail: 'parallel deep-dives per module cluster' }],",
  '}',
].join('\n');

/**
 * The `<task-notification>` a finished workflow reports through, as the
 * harness writes it — the real one in session 4820c6b8 carries a JSON
 * `<result>` and names the tool call that launched the run.
 */
const workflowNotificationText = (status: string) => [
  '<task-notification>',
  `<task-id>${WORKFLOW_TASK_ID}</task-id>`,
  `<tool-use-id>${WORKFLOW_TOOL_USE_ID}</tool-use-id>`,
  `<output-file>/tmp/claude-1000/tasks/${WORKFLOW_TASK_ID}.output</output-file>`,
  `<status>${status}</status>`,
  '<summary>Dynamic workflow "Evidence-based audit of the frontend" completed</summary>',
  '<result>{"audits":[{"area":"src/modules/chat","summary":"three large hooks"}]}</result>',
  '</task-notification>',
].join('\n');

type WorkflowSessionOptions = {
  /** How the completion report is recorded, or `none` for a run still out. */
  notification: 'user' | 'remove' | 'enqueue' | 'none';
  /** Whether the run left a journal behind; a fork copies none. */
  journal: boolean;
};

/**
 * Writes the rows a `Workflow` launch leaves in a session transcript, copied
 * from session 4820c6b8-b23b-468f-b462-74162ecf0f24 (lines 107, 108 and 294),
 * plus the run's journal under `<session>/subagents/workflows/<runId>/`.
 *
 * The journal records three agents: one finished, one failed, one still
 * going — the shape a run has partway through its second phase.
 */
async function writeClaudeWorkflowSession(
  projectDirectory: string,
  { notification, journal }: WorkflowSessionOptions,
): Promise<string> {
  const parentPath = path.join(projectDirectory, `${WORKFLOW_SESSION_ID}.jsonl`);
  const transcriptDir = path.join(projectDirectory, WORKFLOW_SESSION_ID, 'subagents', 'workflows', WORKFLOW_RUN_ID);
  const scriptPath = path.join(projectDirectory, WORKFLOW_SESSION_ID, 'workflows', 'scripts', `frontend-architecture-audit-${WORKFLOW_RUN_ID}.js`);

  const parentLines: Record<string, unknown>[] = [
    {
      type: 'assistant',
      uuid: 'assistant-wf-1',
      sessionId: WORKFLOW_SESSION_ID,
      timestamp: '2026-08-21T10:32:10.000Z',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: WORKFLOW_TOOL_USE_ID,
          name: 'Workflow',
          input: { script: WORKFLOW_SCRIPT, description: 'Parallel frontend architecture audit' },
        }],
      },
    },
    {
      type: 'user',
      uuid: 'workflow-ack-1',
      sessionId: WORKFLOW_SESSION_ID,
      timestamp: '2026-08-21T10:32:15.657Z',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: WORKFLOW_TOOL_USE_ID,
          content: `Workflow launched in background. Task ID: ${WORKFLOW_TASK_ID}\nSummary: Evidence-based audit of the frontend\nTranscript dir: ${transcriptDir}\nScript file: ${scriptPath}`,
        }],
      },
      toolUseResult: {
        status: 'async_launched',
        taskId: WORKFLOW_TASK_ID,
        taskType: 'local_workflow',
        workflowName: 'frontend-architecture-audit',
        runId: WORKFLOW_RUN_ID,
        summary: 'Evidence-based audit of the frontend',
        transcriptDir,
        scriptPath,
      },
    },
  ];

  if (notification === 'user') {
    parentLines.push({
      type: 'user',
      uuid: 'workflow-notification-1',
      sessionId: WORKFLOW_SESSION_ID,
      timestamp: '2026-08-21T11:27:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: workflowNotificationText('completed') }] },
    });
  } else if (notification !== 'none') {
    parentLines.push({
      type: 'queue-operation',
      operation: notification,
      timestamp: '2026-08-21T11:27:00.000Z',
      sessionId: WORKFLOW_SESSION_ID,
      content: workflowNotificationText('completed'),
    });
  }

  await writeFile(parentPath, `${parentLines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

  if (journal) {
    await mkdir(transcriptDir, { recursive: true });
    const journalLines = [
      { type: 'launched' },
      { type: 'started', key: 'v2:one', agentId: 'aa1e064cf8bd159d6', label: 'audit:chat', phase: 'Audit' },
      { type: 'started', key: 'v2:two', agentId: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', phase: 'Audit' },
      { type: 'result', key: 'v2:one', agentId: 'aa1e064cf8bd159d6', result: { area: 'chat' } },
      { type: 'failed', key: 'v2:two', agentId: 'a9cfe29aa8f2afcbf' },
      { type: 'started', key: 'v2:three', agentId: 'ab89f2cde612a51b1', label: 'synthesize', phase: 'Synthesize' },
    ];
    await writeFile(
      path.join(transcriptDir, 'journal.jsonl'),
      `${journalLines.map((line) => JSON.stringify(line)).join('\n')}\n`,
      'utf8',
    );
  }

  return parentPath;
}

for (const notification of ['user', 'remove', 'enqueue'] as const) {
  test(`Claude history folds a workflow's ${notification} notification onto the call that launched it`, { concurrency: false }, async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-workflow-notification-'));

    try {
      const parentPath = await writeClaudeWorkflowSession(tempRoot, { notification, journal: true });

      await withIsolatedDatabase(async () => {
        const now = new Date().toISOString();
        sessionsDb.createSession(WORKFLOW_SESSION_ID, 'claude', tempRoot, 'Workflow session', now, now, parentPath);

        // The run is over, so no process is up — and that must not matter:
        // the notification is the outcome.
        const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => null }).fetchHistory(WORKFLOW_SESSION_ID, {
          providerSessionId: WORKFLOW_SESSION_ID,
        });
        const workflowRow = history.messages.find(
          (message) => message.kind === 'tool_use' && message.toolId === WORKFLOW_TOOL_USE_ID,
        );

        // A Workflow launch has no `agentId`, so the fold used to skip it: the
        // card kept "Workflow launched in background. Task ID: …" as its result
        // for good while the report rendered as a raw user bubble — or, for a
        // queue-operation record, nowhere.
        assert.equal(
          workflowRow?.toolResult?.content,
          '{"audits":[{"area":"src/modules/chat","summary":"three large hooks"}]}',
        );
        assert.equal(workflowRow?.workflow?.status, 'completed');
        assert.equal(workflowRow?.workflow?.name, 'frontend-architecture-audit');
        assert.equal(workflowRow?.workflow?.runId, WORKFLOW_RUN_ID);
        assert.equal(workflowRow?.workflow?.description, 'Evidence-based audit of the frontend');
        assert.match(workflowRow?.workflow?.scriptPath ?? '', /frontend-architecture-audit-wf_16fbf852-274\.js$/);

        const strayNotification = history.messages.find(
          (message) => typeof message.content === 'string' && message.content.includes('<task-notification>'),
        );
        assert.equal(strayNotification, undefined, 'the folded notification must not also render on its own');
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
}

test('Claude history reads a workflow\'s agents and their progress from its journal', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-workflow-journal-'));

  try {
    const parentPath = await writeClaudeWorkflowSession(tempRoot, { notification: 'none', journal: true });

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(WORKFLOW_SESSION_ID, 'claude', tempRoot, 'Workflow session', now, now, parentPath);

      // The run that launched the workflow is still up, so it is still going.
      const liveRunStartedAt = Date.parse('2026-08-21T10:30:00.000Z');
      const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => liveRunStartedAt }).fetchHistory(WORKFLOW_SESSION_ID, {
        providerSessionId: WORKFLOW_SESSION_ID,
      });
      const workflowRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === WORKFLOW_TOOL_USE_ID,
      );

      assert.equal(workflowRow?.workflow?.status, 'running');
      assert.equal(workflowRow?.toolResult?.content, '', 'the launch acknowledgement must never show as a result');
      // An agent with a `started` record and no `result` or `failed` is the
      // one still working; the journal is the only place that says so.
      assert.deepEqual(workflowRow?.workflow?.agents, [
        { id: 'aa1e064cf8bd159d6', label: 'audit:chat', phase: 'Audit', status: 'completed' },
        { id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', phase: 'Audit', status: 'failed' },
        { id: 'ab89f2cde612a51b1', label: 'synthesize', phase: 'Synthesize', status: 'running' },
      ]);
      assert.deepEqual(workflowRow?.workflow?.agentCounts, { total: 3, completed: 1, failed: 1, running: 1, stopped: 0 });
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history does not keep a journal agent running once the workflow itself has settled', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-workflow-orphan-agent-'));

  try {
    // The journal has a `started` with no `result` or `failed` for the
    // synthesize step, but the run has reported completed — a resume re-ran
    // that step under a new id, or the run was stopped under it. Either way
    // nothing is still going, and a pulsing dot on a finished card said
    // otherwise.
    const parentPath = await writeClaudeWorkflowSession(tempRoot, { notification: 'user', journal: true });

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(WORKFLOW_SESSION_ID, 'claude', tempRoot, 'Workflow session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => null }).fetchHistory(WORKFLOW_SESSION_ID, {
        providerSessionId: WORKFLOW_SESSION_ID,
      });
      const workflowRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === WORKFLOW_TOOL_USE_ID,
      );

      assert.equal(workflowRow?.workflow?.status, 'completed');
      assert.deepEqual(
        workflowRow?.workflow?.agents.map((agent) => agent.status),
        ['completed', 'failed', 'stopped'],
      );
      assert.deepEqual(workflowRow?.workflow?.agentCounts, { total: 3, completed: 1, failed: 1, running: 0, stopped: 1 });
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history reports a workflow stopped, with no agents, when its run and journal are both gone', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-workflow-forked-'));

  try {
    // A fork copies the parent's `.jsonl` rows and nothing else: no
    // `subagents/workflows/` directory, no queue-operation records, and no
    // process of its own.
    const parentPath = await writeClaudeWorkflowSession(tempRoot, { notification: 'none', journal: false });

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(WORKFLOW_SESSION_ID, 'claude', tempRoot, 'Workflow session', now, now, parentPath);

      const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => null }).fetchHistory(WORKFLOW_SESSION_ID, {
        providerSessionId: WORKFLOW_SESSION_ID,
      });
      const workflowRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === WORKFLOW_TOOL_USE_ID,
      );

      assert.equal(workflowRow?.workflow?.status, 'stopped');
      assert.deepEqual(workflowRow?.workflow?.agents, []);
      assert.deepEqual(workflowRow?.workflow?.agentCounts, { total: 0, completed: 0, failed: 0, running: 0, stopped: 0 });
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Claude history folds a backgrounded Bash command\'s notification onto its call', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-background-bash-'));
  const sessionId = 'claude-bash-session';
  const toolUseId = 'toolu_bash_bg_1';

  try {
    // Copied from session 30ee5a44 (lines 167 and 234): the shell's own
    // acknowledgement, and the report the harness later queues for it. A
    // shell report carries no `<result>`, only its summary.
    const rows = [
      {
        type: 'assistant',
        uuid: 'assistant-bash-1',
        sessionId,
        timestamp: '2026-08-21T10:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command: 'npm run dev', run_in_background: true } }],
        },
      },
      {
        type: 'user',
        uuid: 'bash-ack-1',
        sessionId,
        timestamp: '2026-08-21T10:00:01.000Z',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: 'Command running in background with ID: b5xsbzu5k. Output is being written to: /tmp/tasks/b5xsbzu5k.output. You will be notified when it completes.',
          }],
        },
        toolUseResult: { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: 'b5xsbzu5k' },
      },
      {
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: '2026-08-21T10:05:00.000Z',
        sessionId,
        content: [
          '<task-notification>',
          '<task-id>b5xsbzu5k</task-id>',
          `<tool-use-id>${toolUseId}</tool-use-id>`,
          '<output-file>/tmp/tasks/b5xsbzu5k.output</output-file>',
          '<status>completed</status>',
          '<summary>Background command "Start the dev server" completed (exit code 0)</summary>',
          '</task-notification>',
        ].join('\n'),
      },
    ];
    const transcriptPath = path.join(tempRoot, `${sessionId}.jsonl`);
    await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(sessionId, 'claude', tempRoot, 'Bash session', now, now, transcriptPath);

      const history = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => null }).fetchHistory(sessionId, {
        providerSessionId: sessionId,
      });
      const bashRow = history.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === toolUseId,
      );

      assert.equal(bashRow?.toolResult?.content, 'Background command "Start the dev server" completed (exit code 0)');

      // Without the report, the shell's acknowledgement stays: unlike an
      // agent's or a workflow's, it names the output file, which is the only
      // handle on the command's output until it reports.
      await writeFile(transcriptPath, `${rows.slice(0, 2).map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
      const unreported = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => null }).fetchHistory(sessionId, {
        providerSessionId: sessionId,
      });
      const unreportedRow = unreported.messages.find(
        (message) => message.kind === 'tool_use' && message.toolId === toolUseId,
      );
      assert.match(unreportedRow?.toolResult?.content ?? '', /Output is being written to: \/tmp\/tasks\/b5xsbzu5k\.output/);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('a long workflow agent timeline keeps its newest steps within the transport cap', { concurrency: false }, async () => {
  // The timeline is polled while the agent runs for what it is doing now; a
  // cap that kept the first 200 steps would freeze it there, and the card's
  // "N earlier steps are not included" would be the wrong way round.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-workflow-agent-long-'));

  try {
    const parentPath = await writeClaudeWorkflowSession(tempRoot, { notification: 'none', journal: true });
    const runDir = path.join(tempRoot, WORKFLOW_SESSION_ID, 'subagents', 'workflows', WORKFLOW_RUN_ID);
    const agentId = 'ab89f2cde612a51b1';
    const rows = [
      { isSidechain: true, agentId, type: 'user', uuid: 'wa-u1', timestamp: '2026-08-21T10:40:00.000Z', message: { role: 'user', content: 'Synthesize the audits.' } },
      ...Array.from({ length: 205 }, (_, index) => ({
        isSidechain: true,
        agentId,
        type: 'assistant',
        uuid: `wa-a${index + 1}`,
        timestamp: new Date(Date.parse('2026-08-21T10:40:05.000Z') + index * 1_000).toISOString(),
        message: { role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'thinking', thinking: `step ${index + 1}` }] },
      })),
    ];
    await writeFile(path.join(runDir, `agent-${agentId}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(WORKFLOW_SESSION_ID, 'claude', tempRoot, 'Workflow session', now, now, parentPath);

      const live = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => Date.parse('2026-08-21T10:30:00.000Z') })
        .readWorkflowAgentActivity(WORKFLOW_SESSION_ID, WORKFLOW_RUN_ID, agentId);
      assert.equal(live?.activityCount, 205);
      assert.equal(live?.activity.length, 200);
      assert.equal(live?.activity[0]?.content, 'step 6');
      assert.equal(live?.activity.at(-1)?.content, 'step 205');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('a workflow agent the journal has not settled is running only while the run that spawned it is', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-workflow-agent-activity-'));

  try {
    const parentPath = await writeClaudeWorkflowSession(tempRoot, { notification: 'none', journal: true });
    // The synthesize step's transcript: the journal says `started` and nothing
    // more, so only the process tells whether it is still working.
    const runDir = path.join(tempRoot, WORKFLOW_SESSION_ID, 'subagents', 'workflows', WORKFLOW_RUN_ID);
    const agentId = 'ab89f2cde612a51b1';
    const rows = [
      { isSidechain: true, agentId, type: 'user', uuid: 'wa-u1', timestamp: '2026-08-21T10:40:00.000Z', message: { role: 'user', content: 'Synthesize the audits.' } },
      { isSidechain: true, agentId, type: 'assistant', uuid: 'wa-a1', timestamp: '2026-08-21T10:40:05.000Z', message: { role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'thinking', thinking: 'Two audits to merge.' }, { type: 'tool_use', id: 'toolu_wa_1', name: 'Read', input: { file_path: '/repo/audits.json' } }] } },
    ];
    await writeFile(path.join(runDir, `agent-${agentId}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(WORKFLOW_SESSION_ID, 'claude', tempRoot, 'Workflow session', now, now, parentPath);

      // The run that spawned the agent is still up: it started before the
      // agent's first row was written.
      const live = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => Date.parse('2026-08-21T10:30:00.000Z') })
        .readWorkflowAgentActivity(WORKFLOW_SESSION_ID, WORKFLOW_RUN_ID, agentId);
      assert.deepEqual(live?.agent, { id: agentId, label: 'synthesize', model: 'claude-opus-4-1', status: 'running' });
      assert.equal(live?.activityCount, 2);
      assert.deepEqual(live?.activity.map((entry) => entry.kind), ['thinking', 'tool']);
      assert.equal(live?.activity[0]?.content, 'Two audits to merge.');
      assert.equal(live?.activity[1]?.toolName, 'Read');

      // A later run of the session is a new process; the agent's own is gone.
      const orphaned = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => Date.parse('2026-08-21T11:00:00.000Z') })
        .readWorkflowAgentActivity(WORKFLOW_SESSION_ID, WORKFLOW_RUN_ID, agentId);
      assert.equal(orphaned?.agent.status, 'stopped');

      // No transcript for this agent: nothing to show, which the route turns
      // into a 404 rather than an empty timeline.
      const missing = await new ClaudeSessionsProvider({ getLiveRunStartTime: () => null })
        .readWorkflowAgentActivity(WORKFLOW_SESSION_ID, WORKFLOW_RUN_ID, 'aa1e064cf8bd159d6');
      assert.equal(missing, null);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('a workflow agent read carries the task it was given and the whole result the journal recorded', { concurrency: false }, async () => {
  // The CLI's `/workflows` view shows each agent's prompt and result; the
  // card had only its steps, whose prose is capped for transport. Both are
  // read for the one agent the user opens, so neither is cut short.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-workflow-agent-brief-'));

  try {
    const parentPath = await writeClaudeWorkflowSession(tempRoot, { notification: 'user', journal: true });
    const runDir = path.join(tempRoot, WORKFLOW_SESSION_ID, 'subagents', 'workflows', WORKFLOW_RUN_ID);
    const prompt = [
      'You are the chat step of a frontend audit.',
      '',
      ...Array.from({ length: 60 }, (_, index) => `${index + 1}. Read the hook named in item ${index + 1} of the brief and note what it owns.`),
    ].join('\n');
    const report = `# Chat audit\n\n${'Three large hooks carry most of the module. '.repeat(120)}\nLast line of the report.`;
    assert.ok(prompt.length > 4000 && report.length > 4000, 'both must exceed the timeline\'s per-entry cap');

    const agentRows = (agentId: string) => [
      { parentUuid: null, isSidechain: true, agentId, type: 'user', uuid: `${agentId}-u1`, timestamp: '2026-08-21T10:40:00.000Z', message: { role: 'user', content: prompt } },
      { parentUuid: `${agentId}-u1`, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-a1`, timestamp: '2026-08-21T10:40:05.000Z', message: { role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'tool_use', id: `toolu_${agentId}_1`, name: 'Grep', input: { pattern: 'use' } }] } },
      { parentUuid: `${agentId}-a1`, isSidechain: true, agentId, type: 'user', uuid: `${agentId}-u2`, timestamp: '2026-08-21T10:40:06.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${agentId}_1`, content: 'src/modules/chat/useChat.ts' }] } },
      { parentUuid: `${agentId}-u2`, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-a2`, timestamp: '2026-08-21T10:41:00.000Z', message: { role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'text', text: report }] } },
    ];
    const reportAgentId = 'ac0ffee0000000001';
    for (const agentId of ['aa1e064cf8bd159d6', 'a9cfe29aa8f2afcbf', reportAgentId]) {
      await writeFile(path.join(runDir, `agent-${agentId}.jsonl`), `${agentRows(agentId).map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    }
    // A fourth agent that returned prose rather than structured output.
    await appendFile(path.join(runDir, 'journal.jsonl'), `${[
      { type: 'started', key: 'v2:four', agentId: reportAgentId, label: 'report', phase: 'Synthesize' },
      { type: 'result', key: 'v2:four', agentId: reportAgentId, result: report },
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      const now = new Date().toISOString();
      sessionsDb.createSession(WORKFLOW_SESSION_ID, 'claude', tempRoot, 'Workflow session', now, now, parentPath);
      const provider = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });

      // Structured output comes back as its JSON, for the card to lay out.
      const structured = await provider.readWorkflowAgentActivity(WORKFLOW_SESSION_ID, WORKFLOW_RUN_ID, 'aa1e064cf8bd159d6');
      assert.equal(structured?.prompt, prompt);
      assert.equal(structured?.result, '{"area":"chat"}');

      // Prose comes back whole, although the same text in the timeline is
      // capped like any other step.
      const prose = await provider.readWorkflowAgentActivity(WORKFLOW_SESSION_ID, WORKFLOW_RUN_ID, reportAgentId);
      assert.equal(prose?.prompt, prompt);
      assert.equal(prose?.result, report);
      assert.match(prose?.activity.at(-1)?.content ?? '', /more characters$/);

      // A failed agent returned nothing; its brief is still worth reading.
      const failed = await provider.readWorkflowAgentActivity(WORKFLOW_SESSION_ID, WORKFLOW_RUN_ID, 'a9cfe29aa8f2afcbf');
      assert.equal(failed?.agent.status, 'failed');
      assert.equal(failed?.prompt, prompt);
      assert.equal(failed?.result, undefined);

      // None of it rides on the history load, which ships every agent of the
      // run each time the session is opened.
      const history = await provider.fetchHistory(WORKFLOW_SESSION_ID, { providerSessionId: WORKFLOW_SESSION_ID });
      const workflowRow = history.messages.find((message) => message.kind === 'tool_use' && message.toolId === WORKFLOW_TOOL_USE_ID);
      assert.equal(workflowRow?.workflow?.agents.length, 4);
      assert.doesNotMatch(JSON.stringify(workflowRow?.workflow), /Three large hooks|frontend audit/);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('the live stream\'s background-task events normalize to task_status', () => {
  // Verified against a real query: the SDK reports on a launched workflow,
  // agent or shell command through four `system` subtypes the transcript
  // never records. They used to fall through every branch of the normalizer
  // and vanish, so a running workflow's card could not move off its launch
  // acknowledgement until the whole run had finished and history reloaded.
  const provider = new ClaudeSessionsProvider();
  const normalize = (raw: Record<string, unknown>) =>
    provider.normalizeMessage({ type: 'system', session_id: WORKFLOW_SESSION_ID, uuid: `evt-${String(raw.subtype)}`, ...raw }, WORKFLOW_SESSION_ID);

  const [started] = normalize({
    subtype: 'task_started',
    task_id: WORKFLOW_TASK_ID,
    tool_use_id: WORKFLOW_TOOL_USE_ID,
    description: 'Parallel frontend architecture audit',
    task_type: 'local_workflow',
    workflow_name: 'frontend-architecture-audit',
  });
  assert.equal(started?.kind, 'task_status');
  assert.equal(started?.event, 'started');
  assert.equal(started?.taskId, WORKFLOW_TASK_ID);
  assert.equal(started?.toolUseId, WORKFLOW_TOOL_USE_ID);
  assert.equal(started?.taskType, 'local_workflow');
  assert.equal(started?.workflowName, 'frontend-architecture-audit');
  assert.equal(started?.description, 'Parallel frontend architecture audit');

  const [progress] = normalize({
    subtype: 'task_progress',
    task_id: WORKFLOW_TASK_ID,
    tool_use_id: WORKFLOW_TOOL_USE_ID,
    description: 'Parallel frontend architecture audit',
    usage: { total_tokens: 12_345, tool_uses: 12, duration_ms: 65_000 },
    summary: 'Verify 3/6',
  });
  assert.equal(progress?.kind, 'task_status');
  assert.equal(progress?.event, 'progress');
  assert.deepEqual(progress?.usage, { totalTokens: 12_345, toolUses: 12, durationMs: 65_000 });
  assert.equal(progress?.summary, 'Verify 3/6');

  // `task_updated` names no tool call — the client has to remember the task
  // id from the start event — and spells a stop `killed`.
  const [updated] = normalize({
    subtype: 'task_updated',
    task_id: WORKFLOW_TASK_ID,
    patch: { status: 'killed', end_time: 1_700_000_000_000 },
  });
  assert.equal(updated?.kind, 'task_status');
  assert.equal(updated?.event, 'updated');
  assert.equal(updated?.taskId, WORKFLOW_TASK_ID);
  assert.equal(updated?.toolUseId, undefined);
  assert.equal(updated?.status, 'stopped');

  const [notification] = normalize({
    subtype: 'task_notification',
    task_id: WORKFLOW_TASK_ID,
    tool_use_id: WORKFLOW_TOOL_USE_ID,
    status: 'completed',
    summary: 'Dynamic workflow "Evidence-based audit of the frontend" completed',
    output_file: `/tmp/claude-1000/tasks/${WORKFLOW_TASK_ID}.output`,
  });
  assert.equal(notification?.kind, 'task_status');
  assert.equal(notification?.event, 'notification');
  assert.equal(notification?.status, 'completed');
  assert.equal(notification?.summary, 'Dynamic workflow "Evidence-based audit of the frontend" completed');
  assert.equal(notification?.outputFile, `/tmp/claude-1000/tasks/${WORKFLOW_TASK_ID}.output`);

  // Every other `system` subtype still normalizes to nothing.
  assert.deepEqual(normalize({ subtype: 'hook_started', task_id: 'irrelevant' }), []);
  assert.deepEqual(normalize({ subtype: 'init' }), []);
});

test('a workflow\'s progress event reports where each of its agents stands', () => {
  // Verified against a real query (SDK 0.3.165 / CLI 2.1.274): a workflow's
  // `task_progress` carries an undocumented `workflow_progress` with one entry
  // per agent the script spawned, and its task-level `last_tool_name` is the
  // current agent's label, not a tool — on every batch, with or without the
  // agent list. Read as a tool, the card's usage line said
  // "32 tool uses · 3m 30s · You are the analysis step of…".
  const provider = new ClaudeSessionsProvider();
  const [progress] = provider.normalizeMessage({
    type: 'system',
    subtype: 'task_progress',
    session_id: WORKFLOW_SESSION_ID,
    uuid: 'evt-workflow-progress',
    task_id: WORKFLOW_TASK_ID,
    tool_use_id: WORKFLOW_TOOL_USE_ID,
    description: 'audit:sidebar',
    summary: 'Evidence-based audit of the frontend',
    usage: { total_tokens: 12_345, tool_uses: 32, duration_ms: 210_000 },
    last_tool_name: 'audit:sidebar',
    workflow_progress: [
      {
        type: 'workflow_agent',
        index: 0,
        label: 'audit:chat',
        phaseIndex: 0,
        phaseTitle: 'Audit',
        agentId: 'aa1e064cf8bd159d6',
        model: 'claude-opus-4-1',
        state: 'done',
        startedAt: 1_700_000_000_000,
        tokens: 8_000,
        toolCalls: 20,
        durationMs: 120_000,
        resultPreview: 'Three large hooks carry most of the module.',
      },
      {
        type: 'workflow_agent',
        index: 1,
        label: 'audit:sidebar',
        phaseIndex: 0,
        phaseTitle: 'Audit',
        agentId: 'a9cfe29aa8f2afcbf',
        state: 'progress',
        startedAt: 1_700_000_120_000,
        lastToolName: 'Grep',
        lastToolSummary: 'useSidebar',
        promptPreview: 'You are the analysis step of a code-quality audit',
        lastProgressAt: 1_700_000_200_000,
        tokens: 4_000,
        toolCalls: 12,
      },
      // Started but not yet spawned: no transcript, so no id.
      { type: 'workflow_agent', index: 2, label: 'synthesize', state: 'start', queuedAt: 1_700_000_200_000 },
      { type: 'workflow_agent', index: 3, label: 'audit:files', agentId: 'ab89f2cde612a51b1', state: 'start', startedAt: 1_700_000_201_000 },
      { type: 'workflow_agent', index: 4, label: 'audit:terminal', agentId: 'ac89f2cde612a51b2', state: 'error', attempt: 2 },
    ],
  }, WORKFLOW_SESSION_ID);

  assert.equal(progress?.kind, 'task_status');
  assert.equal(progress?.event, 'progress');
  assert.deepEqual(progress?.usage, { totalTokens: 12_345, toolUses: 32, durationMs: 210_000 });
  assert.equal('lastToolName' in (progress ?? {}), false, 'the current agent\'s label must not pass as a tool name');
  assert.deepEqual(progress?.agents, [
    {
      index: 0,
      label: 'audit:chat',
      phase: 'Audit',
      agentId: 'aa1e064cf8bd159d6',
      model: 'claude-opus-4-1',
      state: 'done',
      startedAt: 1_700_000_000_000,
      lastToolName: undefined,
      lastToolSummary: undefined,
      promptPreview: undefined,
      tokens: 8_000,
      toolCalls: 20,
      durationMs: 120_000,
      resultPreview: 'Three large hooks carry most of the module.',
    },
    {
      index: 1,
      label: 'audit:sidebar',
      phase: 'Audit',
      agentId: 'a9cfe29aa8f2afcbf',
      model: undefined,
      state: 'running',
      startedAt: 1_700_000_120_000,
      lastToolName: 'Grep',
      lastToolSummary: 'useSidebar',
      promptPreview: 'You are the analysis step of a code-quality audit',
      tokens: 4_000,
      toolCalls: 12,
      durationMs: undefined,
      resultPreview: undefined,
    },
    {
      index: 2,
      label: 'synthesize',
      phase: undefined,
      agentId: undefined,
      model: undefined,
      state: 'queued',
      startedAt: undefined,
      lastToolName: undefined,
      lastToolSummary: undefined,
      promptPreview: undefined,
      tokens: undefined,
      toolCalls: undefined,
      durationMs: undefined,
      resultPreview: undefined,
    },
    {
      index: 3,
      label: 'audit:files',
      phase: undefined,
      agentId: 'ab89f2cde612a51b1',
      model: undefined,
      state: 'running',
      startedAt: 1_700_000_201_000,
      lastToolName: undefined,
      lastToolSummary: undefined,
      promptPreview: undefined,
      tokens: undefined,
      toolCalls: undefined,
      durationMs: undefined,
      resultPreview: undefined,
    },
    {
      index: 4,
      label: 'audit:terminal',
      phase: undefined,
      agentId: 'ac89f2cde612a51b2',
      model: undefined,
      state: 'failed',
      startedAt: undefined,
      lastToolName: undefined,
      lastToolSummary: undefined,
      promptPreview: undefined,
      tokens: undefined,
      toolCalls: undefined,
      durationMs: undefined,
      resultPreview: undefined,
    },
  ]);

  // A throttled batch — agents mid-step only — comes without the agent list
  // but still names the current agent as the tool.
  const [throttled] = provider.normalizeMessage({
    type: 'system',
    subtype: 'task_progress',
    session_id: WORKFLOW_SESSION_ID,
    uuid: 'evt-workflow-progress-throttled',
    task_id: WORKFLOW_TASK_ID,
    tool_use_id: WORKFLOW_TOOL_USE_ID,
    description: 'Audit: audit:sidebar',
    usage: { total_tokens: 12_400, tool_uses: 33, duration_ms: 212_000 },
    last_tool_name: 'audit:sidebar',
  }, WORKFLOW_SESSION_ID);
  assert.equal('lastToolName' in (throttled ?? {}), false);
  assert.equal(throttled?.agents, undefined);

  // An agent's own progress carries no agent list.
  const [agentProgress] = provider.normalizeMessage({
    type: 'system',
    subtype: 'task_progress',
    session_id: WORKFLOW_SESSION_ID,
    uuid: 'evt-agent-progress',
    task_id: 'agent-task-1',
    tool_use_id: 'toolu_agent_1',
    description: 'Survey the repo',
    usage: { total_tokens: 1, tool_uses: 3, duration_ms: 1 },
    last_tool_name: 'Read',
  }, WORKFLOW_SESSION_ID);
  assert.equal(agentProgress?.agents, undefined);
});

test('Claude history still settles a synchronous agent that stops mid tool call', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-sync-agent-'));

  try {
    const parentPath = await writeClaudeSubagentSession(tempRoot);
    await dropTaskNotification(parentPath);

    // A synchronous agent hands its answer back on its own tool result and
    // never sends a notification, so "no notification" must not read as
    // "still running" for one — not even with a dangling tool call, the
    // strongest possible hint that it stopped mid-flight.
    const parentRaw = await readFile(parentPath, 'utf8');
    await writeFile(parentPath, parentRaw.replace('"isAsync":true', '"isAsync":false'), 'utf8');

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

      assert.equal(agentRow?.subagent?.status, 'completed');
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
// extractSessionTitle — tested via synchronizeFile
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
