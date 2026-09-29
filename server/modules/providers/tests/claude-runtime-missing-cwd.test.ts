import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

async function runWithCwd(cwd: string): Promise<{ sent: NormalizedMessage[]; queryStarted: boolean }> {
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

  await queryClaudeSDK('hello', { sessionId: 'app-missing-cwd', cwd }, writer as never, context);
  return { sent, queryStarted };
}

function errorContent(sent: NormalizedMessage[]): string {
  const error = sent.find((message) => message.kind === 'error');
  assert.ok(error, 'an error reaches the client');
  assert.ok(sent.some((message) => message.kind === 'complete'), 'the turn still completes');
  return String(error.content);
}

test('a missing project folder is reported by name and never reaches the SDK', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-missing-cwd-'));
  const cwd = path.join(parent, 'moved-away');
  try {
    const { sent, queryStarted } = await runWithCwd(cwd);
    assert.equal(queryStarted, false);
    const content = errorContent(sent);
    assert.match(content, /project folder does not exist/);
    assert.ok(content.includes(cwd), 'the error names the missing folder');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('a project path that is a file is reported as not a folder', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-missing-cwd-'));
  const cwd = path.join(parent, 'notes.md');
  await writeFile(cwd, '');
  try {
    const { sent, queryStarted } = await runWithCwd(cwd);
    assert.equal(queryStarted, false);
    assert.match(errorContent(sent), /not a folder/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
