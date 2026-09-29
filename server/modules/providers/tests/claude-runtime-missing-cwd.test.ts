import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * A project folder that was moved or renamed leaves its sessions pointing at a
 * cwd that is gone. The SDK would report that spawn failure as "native binary
 * not found", so the runtime has to name the missing folder before it starts.
 */

test('a missing project folder is reported by name and never reaches the SDK', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-missing-cwd-'));
  const cwd = path.join(parent, 'moved-away');
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  let queryStarted = false;
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery: () => {
      queryStarted = true;
      throw new Error('the SDK must not be started');
    },
  };

  try {
    await queryClaudeSDK('hello', { sessionId: 'app-missing-cwd', cwd }, writer as never, context);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }

  assert.equal(queryStarted, false);
  const error = sent.find((message) => message.kind === 'error');
  assert.ok(error, 'an error reaches the client');
  assert.match(String(error.content), /project folder no longer exists/);
  assert.ok(String(error.content).includes(cwd), 'the error names the missing folder');
  assert.ok(sent.some((message) => message.kind === 'complete'), 'the turn still completes');
});
