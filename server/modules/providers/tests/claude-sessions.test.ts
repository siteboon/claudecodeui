import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { AppError } from '@/shared/utils.js';

const SESSION_ID = 'session-1';

const SKILL_BODY = [
  'Base directory for this skill: /tmp/claude/bundled-skills/2.1.220/abc123/claude-api',
  '',
  '# Building LLM-Powered Applications with Claude',
  '',
  'This skill helps you build LLM-powered applications with Claude.',
].join('\n');

test('claude: injected skill bodies are hidden even without the isMeta flag', () => {
  const provider = new ClaudeSessionsProvider();

  // The live SDK stream omits `isMeta`, so the payload has to be recognised by
  // its content or it renders as a giant user bubble mid-run.
  const live = provider.normalizeMessage(
    {
      uuid: 'u1',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(live, []);

  const persisted = provider.normalizeMessage(
    {
      uuid: 'u2',
      timestamp: '2026-07-28T10:00:00.000Z',
      isMeta: true,
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(persisted, []);
});

test('claude: the Skill tool result itself still reaches the UI', () => {
  const provider = new ClaudeSessionsProvider();

  const messages = provider.normalizeMessage(
    {
      uuid: 'u3',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Launching skill: claude-api' }],
      },
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_result');
  assert.equal(messages[0].toolId, 'toolu_1');
});

test('claude: getTokenUsage reads the latest assistant usage snapshot', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-token-usage-'));
  const sessionFilePath = path.join(tempDirectory, 'provider-session.jsonl');
  const previousContextWindow = process.env.CONTEXT_WINDOW;
  process.env.CONTEXT_WINDOW = '180000';

  try {
    await writeFile(sessionFilePath, [
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 5,
            output_tokens: 30,
          },
        },
      }),
      '{incomplete',
    ].join('\n'));

    const provider = new ClaudeSessionsProvider();
    assert.deepEqual(
      await provider.getTokenUsage({
        appSessionId: 'app-session',
        nativeSessionId: 'provider-session',
        jsonlPath: sessionFilePath,
        projectPath: null,
      }),
      {
        used: 155,
        total: 180_000,
        inputTokens: 125,
        outputTokens: 30,
        cacheReadTokens: 20,
        cacheCreationTokens: 5,
        cacheTokens: 25,
        breakdown: { input: 125, output: 30 },
      },
    );

    await assert.rejects(
      () => provider.getTokenUsage({
        appSessionId: 'app-session',
        nativeSessionId: 'provider-session',
        jsonlPath: path.join(tempDirectory, 'missing.jsonl'),
        projectPath: null,
      }),
      (error: unknown) => (
        error instanceof AppError
        && error.code === 'SESSION_FILE_NOT_FOUND'
        && error.statusCode === 404
      ),
    );
  } finally {
    if (previousContextWindow === undefined) {
      delete process.env.CONTEXT_WINDOW;
    } else {
      process.env.CONTEXT_WINDOW = previousContextWindow;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
