import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, chmod, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

import { kiroRuntime } from '../kiro-runtime.provider.js';

const environmentKeys = ['KIRO_PATH', 'KIRO_TEST_SCENARIO', 'KIRO_TEST_LOG'] as const;
const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
let directory: string;
let executable: string;
let events: NormalizedMessage[];
let mappedIds: string[];

const context: ProviderRuntimeContext = {
  resolveProviderSessionId: (id) => id === 'app-existing' ? 'native-existing' : null,
  resolveResumeModel: async (_id, model) => model || undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'auto' }),
  normalizeMessage: () => [],
  isProviderInstalled: async () => true,
};
const writer = {
  send: (message: unknown) => events.push(message as NormalizedMessage),
  setSessionId: (id: string) => mappedIds.push(id),
};

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'kiro-runtime-'));
  const script = path.join(directory, 'fake-acp.cjs');
  await copyFile(new URL('./fixtures/fake-acp.cjs', import.meta.url), script);
  await chmod(script, 0o755);
  executable = script;
  if (process.platform === 'win32') {
    executable = path.join(directory, 'fake-acp.cmd');
    await writeFile(executable, `@"${process.execPath}" "${script}" %*\r\n`);
  }
  process.env.KIRO_TEST_LOG = path.join(directory, 'requests.jsonl');
});

beforeEach(async () => {
  events = [];
  mappedIds = [];
  process.env.KIRO_PATH = executable;
  process.env.KIRO_TEST_SCENARIO = 'success';
  await writeFile(process.env.KIRO_TEST_LOG!, '');
});

after(async () => {
  for (const key of environmentKeys) {
    const value = previousEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(directory, { recursive: true, force: true });
});

async function requests(): Promise<Array<Record<string, any>>> {
  return (await readFile(process.env.KIRO_TEST_LOG!, 'utf8'))
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function waitForMethod(method: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await requests()).some((request) => request.method === method)) return;
    await delay(10);
  }
  assert.fail(`No ${method} request received`);
}

test('new app sessions create native sessions and stream coherent text/tool events', async () => {
  await kiroRuntime.run('hello', { sessionId: 'app-new', cwd: directory, model: 'auto' }, writer, context);
  const frames = await requests();
  assert.deepEqual(frames[0].args, ['acp', '--trust-all-tools', '--model', 'auto']);
  assert.deepEqual(frames.slice(1).map((frame) => frame.method), ['initialize', 'session/new', 'session/prompt']);
  assert.equal(frames.at(-1)!.params.sessionId, 'native-session');
  assert.deepEqual(mappedIds, ['native-session']); // Never persist a temporary id.
  assert.deepEqual(events.filter((event) => event.kind === 'stream_delta').map((event) => event.content), ['Hello ', 'world', 'Done.']);
  assert.equal(events.filter((event) => event.kind === 'stream_end').length, 2);
  assert.deepEqual(events.filter((event) => event.kind !== 'session_created').map((event) => event.kind), [
    'stream_delta', 'stream_delta', 'stream_end', 'tool_use', 'tool_result',
    'stream_delta', 'stream_end', 'complete',
  ]);
  const results = events.filter((event) => event.kind === 'tool_result');
  assert.equal(results.length, 1);
  assert.equal(results[0].content, 'file.txt');
  const complete = events.filter((event) => event.kind === 'complete');
  assert.equal(complete.length, 1);
  assert.equal(complete[0].success, true);
  assert.equal(complete[0].sessionId, 'app-new');
});

test('resume resolves the native id, switches model, and suppresses replayed history', async () => {
  await kiroRuntime.run('continue', { sessionId: 'app-existing', cwd: directory, model: 'claude-sonnet-4.6' }, writer, context);
  const frames = await requests();
  assert.deepEqual(frames.slice(1).map((frame) => frame.method), [
    'initialize', 'session/load', 'session/set_model', 'session/prompt',
  ]);
  assert.equal(frames[2].params.sessionId, 'native-existing');
  assert.deepEqual(frames[3].params, { sessionId: 'native-existing', modelId: 'claude-sonnet-4.6' });
  assert.equal(frames[4].params.sessionId, 'native-existing');
  assert.deepEqual(mappedIds, []);
  assert.ok(events.every((event) => !String(event.content).includes('replayed history')));
});

for (const scenario of ['rpc-error', 'missing-id']) {
  test(`${scenario} rejects and emits exactly one failed completion`, async () => {
    process.env.KIRO_TEST_SCENARIO = scenario;
    await assert.rejects(kiroRuntime.run('hello', { sessionId: 'app-new', cwd: directory }, writer, context));
    assert.equal(events.filter((event) => event.kind === 'error').length, 1);
    const complete = events.filter((event) => event.kind === 'complete');
    assert.equal(complete.length, 1);
    assert.equal(complete[0].success, false);
    if (scenario === 'missing-id') assert.ok(!(await requests()).some((frame) => frame.method === 'session/prompt'));
  });
}

test('missing executable reports a failure and releases the active session', async () => {
  process.env.KIRO_PATH = path.join(directory, 'missing-executable');
  await assert.rejects(kiroRuntime.run('hello', { sessionId: 'app-new', cwd: directory }, writer, context), /not installed/);
  assert.equal(events.filter((event) => event.kind === 'complete').length, 1);
  assert.equal(kiroRuntime.abort('app-new'), false);
});

for (const scenario of ['early-abort', 'abort-prompt', 'ignore-term']) {
  test(`abort by app id during ${scenario} releases the process without a duplicate completion`, {
    timeout: 10000,
    skip: scenario === 'ignore-term' && process.platform === 'win32',
  }, async () => {
    process.env.KIRO_TEST_SCENARIO = scenario;
    const running = kiroRuntime.run('hello', { sessionId: 'app-new', cwd: directory }, writer, context);
    await waitForMethod(scenario === 'abort-prompt' ? 'session/prompt' : 'initialize');
    assert.equal(kiroRuntime.abort('app-new'), true);
    await running;
    assert.equal(kiroRuntime.abort('app-new'), false);
    assert.equal(events.filter((event) => event.kind === 'complete').length, 0);
    assert.equal(events.filter((event) => event.kind === 'error').length, 0);
  });
}
