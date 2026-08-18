/**
 * Antigravity Runtime Unit Tests
 *
 * Drives the runtime against a stub `agy` executable (injected via
 * CLOUDCLI_ANTIGRAVITY_PATH) that records its argv and replays canned
 * stream-json events, so permission-mode flag mapping, stream normalization
 * and abort handling are verified without the real CLI.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type {
  NormalizedMessage,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

import { AntigravityRuntimeProvider } from '../list/antigravity/antigravity-runtime.provider.js';
import { AntigravitySessionsProvider } from '../list/antigravity/antigravity-sessions.provider.js';

const stubDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agy-stub-'));
const stubPath = path.join(stubDir, 'agy');
const argsFilePath = path.join(stubDir, 'args.txt');

const stubScript = `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.env.AGY_ARGS_FILE, process.argv.slice(2).join('\\n') + '\\n');
if (process.env.AGY_STUB_MODE === 'sleep') {
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
} else {
  console.log(JSON.stringify({ event: 'init', conversation_id: 'stub-conv-1', init: { cwd: '/tmp' } }));
  console.log(JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'stub-conv-1', step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'OK' } }));
  console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'stub-conv-1', status: 'SUCCESS', usage: { total_tokens: 42 } } }));
}
`;

fsSync.writeFileSync(stubPath, stubScript, { mode: 0o755 });

process.env.CLOUDCLI_ANTIGRAVITY_PATH = stubPath;
process.env.AGY_ARGS_FILE = argsFilePath;
delete process.env.AGY_STUB_MODE;

const sessionsProvider = new AntigravitySessionsProvider();

const context: ProviderRuntimeContext = {
  resolveProviderSessionId: () => null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'gemini-3.7-flash-high' }),
  normalizeMessage: (raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId),
  isProviderInstalled: async () => true,
};

const createWriter = (): { messages: NormalizedMessage[]; writer: ProviderRuntimeWriter } => {
  const messages: NormalizedMessage[] = [];
  const writer: ProviderRuntimeWriter = {
    userId: null,
    send: (data: unknown) => messages.push(data as NormalizedMessage),
    setSessionId: () => undefined,
  };
  return { messages, writer };
};

const readRecordedArgs = async (): Promise<string[]> => {
  const content = await fs.readFile(argsFilePath, 'utf8');
  return content.split('\n').filter((line) => line.length > 0);
};

const waitForArgsFile = async (): Promise<void> => {
  for (let i = 0; i < 100; i += 1) {
    try {
      await fs.access(argsFilePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('stub agy did not record args in time');
};

test('runtime maps permissionMode onto agy flags', async () => {
  const runtime = new AntigravityRuntimeProvider();
  const scenarios: Array<{
    permissionMode?: string;
    expected: string[];
    forbidden: string[];
  }> = [
    { permissionMode: 'acceptEdits', expected: ['--mode', 'accept-edits'], forbidden: ['--dangerously-skip-permissions'] },
    { permissionMode: 'plan', expected: ['--mode', 'plan'], forbidden: ['--dangerously-skip-permissions'] },
    { permissionMode: 'bypassPermissions', expected: ['--dangerously-skip-permissions'], forbidden: ['--mode'] },
    { permissionMode: 'default', expected: [], forbidden: ['--mode', '--dangerously-skip-permissions'] },
  ];

  for (const scenario of scenarios) {
    await fs.rm(argsFilePath, { force: true });
    const { writer } = createWriter();
    await runtime.run(
      'hello',
      { sessionId: `sess-${scenario.permissionMode ?? 'none'}`, permissionMode: scenario.permissionMode },
      writer,
      context,
    );

    const args = await readRecordedArgs();
    for (const flag of scenario.expected) {
      assert.ok(args.includes(flag), `${scenario.permissionMode}: expected ${flag} in ${JSON.stringify(args)}`);
    }
    for (const flag of scenario.forbidden) {
      assert.ok(!args.includes(flag), `${scenario.permissionMode}: ${flag} must not appear in ${JSON.stringify(args)}`);
    }
  }
});

test('runtime forces skip-permissions from toolsSettings without duplicates', async () => {
  const runtime = new AntigravityRuntimeProvider();

  await fs.rm(argsFilePath, { force: true });
  const { writer } = createWriter();
  await runtime.run(
    'hello',
    { sessionId: 'sess-skip', permissionMode: 'default', toolsSettings: { skipPermissions: true } },
    writer,
    context,
  );
  let args = await readRecordedArgs();
  assert.equal(args.filter((arg) => arg === '--dangerously-skip-permissions').length, 1);

  // permissionMode bypassPermissions plus the toggle still yields one flag.
  await fs.rm(argsFilePath, { force: true });
  await runtime.run(
    'hello',
    { sessionId: 'sess-skip-2', permissionMode: 'bypassPermissions', toolsSettings: { skipPermissions: true } },
    writer,
    context,
  );
  args = await readRecordedArgs();
  assert.equal(args.filter((arg) => arg === '--dangerously-skip-permissions').length, 1);
});

test('runtime emits one session_created, stream deltas and a token-bearing complete', async () => {
  const runtime = new AntigravityRuntimeProvider();
  const { messages, writer } = createWriter();

  const result = await runtime.run('hello', { sessionId: 'sess-stream' }, writer, context);

  assert.deepEqual(result, { sessionId: 'stub-conv-1', success: true });
  assert.equal(messages.filter((msg) => msg.kind === 'session_created').length, 1);
  const delta = messages.find((msg) => msg.kind === 'stream_delta');
  assert.equal(delta?.content, 'OK');
  const complete = messages.find((msg) => msg.kind === 'complete');
  assert.equal(complete?.tokens, 42);
});

test('abort resolves the run quietly as aborted', async () => {
  const runtime = new AntigravityRuntimeProvider();
  await fs.rm(argsFilePath, { force: true });
  process.env.AGY_STUB_MODE = 'sleep';

  const { messages, writer } = createWriter();
  try {
    const runPromise = runtime.run('hello', { sessionId: 'sess-abort' }, writer, context);
    await waitForArgsFile();

    assert.equal(await runtime.abort('sess-abort'), true);

    const result = await runPromise;
    // The sleeping stub never emits init, so no provider session id is
    // captured and the resolve falls back to the app session id.
    assert.deepEqual(result, { sessionId: 'sess-abort', success: true, aborted: true });
    assert.equal(messages.some((msg) => msg.kind === 'error'), false);
  } finally {
    delete process.env.AGY_STUB_MODE;
  }
});

test('runtime normalizes model with embedded effort suffix and avoids conflicting --effort flag', async () => {
  const runtime = new AntigravityRuntimeProvider();

  // Case 1: model with -high suffix and effort medium -> model becomes -medium, no --effort flag
  await fs.rm(argsFilePath, { force: true });
  const { writer: writer1 } = createWriter();
  await runtime.run(
    'hello',
    { sessionId: 'sess-effort-1', model: 'gemini-3.7-flash-high', effort: 'medium' },
    writer1,
    context,
  );
  let args = await readRecordedArgs();
  assert.ok(args.includes('--model'));
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.7-flash-medium');
  assert.ok(!args.includes('--effort'), '--effort flag should be omitted when model encodes effort');

  // Case 2: model without effort suffix (e.g. claude-sonnet-4-6) -> passes model and --effort flag
  await fs.rm(argsFilePath, { force: true });
  const { writer: writer2 } = createWriter();
  await runtime.run(
    'hello',
    { sessionId: 'sess-effort-2', model: 'claude-sonnet-4-6', effort: 'high' },
    writer2,
    context,
  );
  args = await readRecordedArgs();
  assert.ok(args.includes('--model'));
  assert.equal(args[args.indexOf('--model') + 1], 'claude-sonnet-4-6');
  assert.ok(args.includes('--effort'));
  assert.equal(args[args.indexOf('--effort') + 1], 'high');
});

