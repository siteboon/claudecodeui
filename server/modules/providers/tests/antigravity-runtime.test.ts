import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { AntigravitySessionsProvider } from '@/modules/providers/list/antigravity/antigravity-sessions.provider.js';
import { createAntigravityRuntime, resolveAntigravityPermissionArgs } from '@/modules/providers/list/antigravity/antigravity-runtime.provider.js';
import type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/index.js';
import type { SideQuestionRequest } from '@/shared/types.js';

const sessionsProvider = new AntigravitySessionsProvider();
function createRuntimeContext(overrides: Partial<ProviderRuntimeContext> = {}): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async (_sessionId, requestedModel) => requestedModel || undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: (raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    ...overrides,
  };
}
type FakeProcess = EventEmitter & {
  stdin: PassThrough; stdout: PassThrough; stderr: PassThrough;
  signals: Array<NodeJS.Signals | undefined>;
  kill(signal?: NodeJS.Signals): boolean;
};
function createFakeProcess(autoClose = true): FakeProcess {
  const child = new EventEmitter() as FakeProcess;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (autoClose) queueMicrotask(() => child.emit('close', null, signal));
    return true;
  };
  return child;
}
function emitEvent(child: FakeProcess, event: AnyRecord): void {
  child.stdout.write(`${JSON.stringify(event)}\n`);
}
function emitInit(child: FakeProcess, id = 'native-id'): void {
  emitEvent(child, { event: 'init', conversation_id: id, init: { cwd: '/workspace' } });
}
function emitDelta(child: FakeProcess, text: string): void {
  emitEvent(child, { event: 'step_update', step_update: { step_type: 'agent_response', text_delta: text } });
}
function finish(child: FakeProcess, id = 'native-id', response = ''): void {
  emitEvent(child, { event: 'result', result: { conversation_id: id, status: 'SUCCESS', response } });
  child.emit('close', 0, null);
}
function createWriter(onMessage?: (message: AnyRecord) => void) {
  const messages: AnyRecord[] = [];
  let id: string | null = null;
  const writer: ProviderRuntimeWriter = {
    userId: null,
    send(data) { const message = data as AnyRecord; messages.push(message); onMessage?.(message); },
    setSessionId(sessionId) { id = sessionId; },
  };
  return { writer, messages, getProviderSessionId: () => id };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function sideQuestion(overrides: Partial<SideQuestionRequest> = {}): SideQuestionRequest {
  return {
    appSessionId: 'parent-app', providerSessionId: 'parent-native', projectPath: '/workspace',
    question: 'Which file was discussed?', model: 'agy-model', signal: new AbortController().signal,
    ...overrides,
  };
}

test('AGY side questions stream on an independent native snapshot with enforced read-only settings', async () => {
  const child = createFakeProcess();
  let disposed = false;
  let args: string[] = [];
  let stdin = '';
  child.stdin.on('data', (data) => { stdin += String(data); });
  const runtime = createAntigravityRuntime({
    forkProvider: { forkSideQuestion: async (input) => {
      assert.equal(input.providerSessionId, 'parent-native');
      return { providerSessionId: 'side-native', jsonlPath: '/side/transcript.jsonl', workingDirectory: '/isolated-agent', agentName: 'readonly-agent', dispose: async () => { disposed = true; } };
    } },
    spawnProcess: (_command, flags) => { args = flags; return child as never; },
  });
  const chunks: string[] = [];
  const pending = runtime.askSideQuestion!(sideQuestion(), { delta: (text) => chunks.push(text) }, createRuntimeContext());
  await tick();
  assert.equal(args[args.indexOf('--conversation') + 1], 'side-native');
  assert.equal(args[args.indexOf('--model') + 1], 'agy-model');
  assert.equal(args[args.indexOf('--mode') + 1], 'plan');
  assert.equal(args[args.indexOf('--agent') + 1], 'readonly-agent');
  assert.equal(args[args.indexOf('--add-dir') + 1], '/workspace');
  assert.ok(args.includes('--disable-slash-commands'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.deepEqual(settings.permissions.deny, ['write_file(*)', 'command(*)', 'unsandboxed(*)', 'mcp(*)', 'read_url(*)', 'execute_url(*)']);
  assert.equal(settings.toolPermission, 'strict');
  assert.match(JSON.parse(stdin).message.content, /Side conversation boundary/);
  assert.match(JSON.parse(stdin).message.content, /Which file was discussed/);
  assert.equal(runtime.abort('parent-app'), false, 'side questions never claim the parent process slot');
  emitEvent(child, { event: 'step_update', step_update: { conversation_id: 'side-native', step_type: 'agent_response', text_delta: 'src/main.ts' } });
  finish(child, 'side-native', 'src/main.ts');
  assert.deepEqual(await pending, { status: 'done', answer: 'src/main.ts' });
  assert.deepEqual(chunks, ['src/main.ts']);
  assert.equal(disposed, true);
});

test('dismissing an AGY side question retains its snapshot until the process closes and leaves the parent running', async () => {
  const parent = createFakeProcess();
  const side = createFakeProcess(false);
  let calls = 0;
  let disposed = false;
  const controller = new AbortController();
  const runtime = createAntigravityRuntime({
    forkProvider: { forkSideQuestion: async () => ({
      providerSessionId: 'side-native', jsonlPath: '/side/transcript.jsonl', workingDirectory: '/isolated-agent', agentName: 'readonly-agent', dispose: async () => { disposed = true; },
    }) },
    spawnProcess: () => (++calls === 1 ? parent : side) as never,
  });
  const main = runtime.run('continue', { sessionId: 'parent-app' }, createWriter().writer,
    createRuntimeContext({ resolveProviderSessionId: () => 'parent-native' }));
  await tick();
  const chunks: string[] = [];
  const pending = runtime.askSideQuestion!(sideQuestion({ signal: controller.signal }), { delta: (text) => chunks.push(text) }, createRuntimeContext());
  await tick();
  controller.abort();
  await tick();
  assert.deepEqual(side.signals, ['SIGTERM']);
  assert.deepEqual(parent.signals, []);
  assert.equal(disposed, false);
  emitEvent(side, { event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'late' } });
  side.emit('close', null, 'SIGTERM');
  assert.equal((await pending).status, 'error');
  assert.equal(disposed, true);
  assert.deepEqual(chunks, []);
  finish(parent, 'parent-native');
  await main;
});

test('AGY side-question startup failures and dismiss during snapshot always dispose the owned copy', async () => {
  for (const failure of ['dismiss', 'spawn', 'model'] as const) {
    const controller = new AbortController();
    let disposed = false;
    let forked = false;
    const runtime = createAntigravityRuntime({
      forkProvider: { forkSideQuestion: async () => {
        forked = true;
        if (failure === 'dismiss') controller.abort();
        return { providerSessionId: 'side-native', jsonlPath: '/side/transcript.jsonl', workingDirectory: '/isolated-agent', agentName: 'readonly-agent', dispose: async () => { disposed = true; } };
      } },
      spawnProcess: () => { throw new Error('spawn failed'); },
    });
    const outcome = await runtime.askSideQuestion!(sideQuestion({ signal: controller.signal }), { delta() {} }, createRuntimeContext({
      resolveResumeModel: async () => { if (failure === 'model') throw new Error('model failed'); return 'agy-model'; },
    }));
    assert.equal(outcome.status, 'error');
    assert.equal(disposed, forked);
  }
});

test('Antigravity permission modes map to native controls', () => {
  assert.deepEqual(resolveAntigravityPermissionArgs('plan'), ['--mode', 'plan']);
  assert.deepEqual(resolveAntigravityPermissionArgs('acceptEdits'), ['--mode', 'accept-edits']);
  assert.deepEqual(resolveAntigravityPermissionArgs('bypassPermissions'), ['--dangerously-skip-permissions']);
  assert.deepEqual(resolveAntigravityPermissionArgs('default'), []);
});

test('AGY binds init before exit and streams split NDJSON without repeating result text', async () => {
  const child = createFakeProcess();
  let args: string[] = [];
  let cwd = '';
  const runtime = createAntigravityRuntime({ spawnProcess: (_command, values, options) => {
    args = values; cwd = options.cwd!; return child as never;
  } });
  const output = createWriter();
  let completed = false;
  const run = runtime.run('Hi', { cwd: '/workspace', sessionId: 'app', permissionMode: 'acceptEdits' },
    output.writer, createRuntimeContext()).then(() => { completed = true; });
  await tick();
  const init = JSON.stringify({ event: 'init', conversation_id: 'own-id' }) + '\n';
  child.stdout.write(init.slice(0, 19)); child.stdout.write(init.slice(19));
  emitDelta(child, 'assistant '); emitDelta(child, 'response');
  assert.equal(output.getProviderSessionId(), 'own-id');
  assert.equal(completed, false);
  finish(child, 'own-id', 'assistant response'); await run;
  assert.equal(output.messages.filter((m) => m.kind === 'stream_delta').map((m) => m.content).join(''), 'assistant response');
  assert.equal(output.messages.filter((m) => m.kind === 'session_created').length, 1);
  assert.equal(output.messages.filter((m) => m.kind === 'complete').length, 1);
  assert.deepEqual(args, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--mode', 'accept-edits']);
  assert.equal(cwd, '/workspace');
  assert.deepEqual(JSON.parse(child.stdin.read().toString()), { event: 'user', message: { content: 'Hi' } });
});

test('fresh runs overlap and ignore another conversation appearing on disk mid-run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-concurrent-'));
  const children: FakeProcess[] = [];
  const runtime = createAntigravityRuntime({ spawnProcess: () => {
    const child = createFakeProcess(); children.push(child); return child as never;
  } });
  const first = createWriter(); const second = createWriter();
  try {
    const runA = runtime.run('first', { sessionId: 'app-a' }, first.writer, createRuntimeContext());
    await tick(); emitInit(children[0], 'native-a');
    const runB = runtime.run('second', { sessionId: 'app-b' }, second.writer, createRuntimeContext());
    await tick();
    assert.equal(children.length, 2, 'a long first turn must not block another new chat');
    const foreign = path.join(root, 'brain', 'foreign', '.system_generated', 'logs');
    await mkdir(foreign, { recursive: true });
    await writeFile(path.join(foreign, 'transcript.jsonl'), JSON.stringify({ source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'first' }));
    emitInit(children[1], 'native-b'); finish(children[1], 'native-b'); await runB;
    assert.equal(first.getProviderSessionId(), 'native-a');
    finish(children[0], 'native-a'); await runA;
    assert.equal(second.getProviderSessionId(), 'native-b');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stream parser preserves split UTF-8 and filters control tags, excluding successful stderr', async () => {
  const child = createFakeProcess();
  const runtime = createAntigravityRuntime({ spawnProcess: () => child as never });
  const output = createWriter();
  const run = runtime.run('Hi', {}, output.writer, createRuntimeContext()); await tick(); emitInit(child);
  const event = JSON.stringify({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: '한🙂字<WAITING_FOR_E' } }) + '\n';
  for (const byte of Buffer.from(event)) child.stdout.write(Buffer.from([byte]));
  emitDelta(child, 'VENTS></WAITING_FOR_EVENTS> done');
  child.stderr.write('diagnostic '.repeat(20000));
  finish(child); await run;
  assert.equal(output.messages.filter((m) => m.kind === 'stream_delta').map((m) => m.content).join(''), '한🙂字 done');
  assert.equal(output.messages.some((m) => String(m.content).includes('diagnostic')), false);
});

test('failure diagnostics are bounded and never appear as assistant text', async () => {
  const child = createFakeProcess();
  const runtime = createAntigravityRuntime({ spawnProcess: () => child as never });
  const output = createWriter();
  const run = runtime.run('Hi', {}, output.writer, createRuntimeContext());
  const rejection = assert.rejects(run, /tail diagnostic/); await tick(); emitInit(child);
  child.stderr.write('x'.repeat(200000)); child.stderr.write('tail diagnostic'); child.emit('close', 1, null);
  await rejection;
  const errors = output.messages.filter((m) => m.kind === 'error');
  assert.equal(errors.length, 1); assert.ok(String(errors[0].content).length < 66000);
  assert.equal(output.messages.some((m) => m.kind === 'stream_delta'), false);
});

test('a result-only response is retained and a failing result cannot be reported successful', async () => {
  for (const status of ['SUCCESS', 'ERROR']) {
    const child = createFakeProcess();
    const runtime = createAntigravityRuntime({ spawnProcess: () => child as never });
    const output = createWriter();
    const run = runtime.run('Hi', {}, output.writer, createRuntimeContext());
    const checked = status === 'ERROR' ? assert.rejects(run, /quota/) : run;
    await tick(); emitInit(child);
    emitEvent(child, { event: 'result', result: { conversation_id: 'native-id', status, response: 'answer', error: 'quota' } });
    child.emit('close', 0, null); await checked;
    assert.equal(output.messages.find((m) => m.kind === 'complete')?.exitCode, status === 'SUCCESS' ? 0 : 1);
    assert.equal(output.messages.filter((m) => m.kind === 'stream_delta').map((m) => m.content).join(''), status === 'SUCCESS' ? 'answer' : '');
  }
});

test('abort retains a stubborn process through SIGTERM and escalates to SIGKILL', async () => {
  const child = createFakeProcess(false);
  const runtime = createAntigravityRuntime({ spawnProcess: () => child as never, abortTimeoutMs: 20 });
  const output = createWriter(); const run = runtime.run('wait', { sessionId: 'app' }, output.writer, createRuntimeContext());
  await tick(); assert.equal(await runtime.abort('app'), true); assert.equal(await runtime.abort('app'), true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(await runtime.abort('app'), true, 'still tracked until exit');
  child.emit('exit', null, 'SIGKILL'); child.emit('close', null, 'SIGKILL'); await run;
  assert.equal(await runtime.abort('app'), false);
  assert.equal(output.messages.some((m) => m.kind === 'complete'), false);
});

test('an aborted old process exiting cannot erase its replacement or kill it later', async () => {
  const children = [createFakeProcess(false), createFakeProcess(false)]; let index = 0;
  const runtime = createAntigravityRuntime({ spawnProcess: () => children[index++] as never, abortTimeoutMs: 20 });
  const oldRun = runtime.run('old', { sessionId: 'same' }, createWriter().writer, createRuntimeContext());
  await tick(); await runtime.abort('same');
  const newRun = runtime.run('new', { sessionId: 'same' }, createWriter().writer, createRuntimeContext());
  await tick(); children[0].emit('exit', null, 'SIGTERM'); children[0].emit('close', null, 'SIGTERM'); await oldRun;
  assert.equal(await runtime.abort('same'), true); assert.deepEqual(children[1].signals, ['SIGTERM']);
  children[1].emit('close', null, 'SIGTERM'); await newRun;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(children[0].signals, ['SIGTERM']); assert.deepEqual(children[1].signals, ['SIGTERM']);
});

test('abort during model lookup prevents a subprocess starting', async () => {
  let resolveModel!: (value: undefined) => void;
  const runtime = createAntigravityRuntime({ spawnProcess: () => { throw new Error('must not spawn'); } });
  const run = runtime.run('wait', { sessionId: 'startup' }, createWriter().writer, createRuntimeContext({
    resolveResumeModel: () => new Promise((resolve) => { resolveModel = resolve; }),
  }));
  assert.equal(await runtime.abort('startup'), true); resolveModel(undefined); await run;
});

for (const failure of ['model', 'spawn', 'error', 'probe']) {
  test(`AGY reports one terminal lifecycle and recovers after ${failure} failure`, async () => {
    let fail = true;
    const runtime = createAntigravityRuntime({ spawnProcess: () => {
      if (fail && failure === 'spawn') throw new Error('spawn failed');
      const child = createFakeProcess();
      queueMicrotask(() => {
        if (fail && failure === 'error') child.emit('error', new Error('spawn failed'));
        if (fail && failure === 'probe') child.emit('close', 127, null);
        else { emitInit(child); finish(child); }
      });
      return child as never;
    } });
    const context = createRuntimeContext({
      resolveResumeModel: async () => { if (fail && failure === 'model') throw new Error('model failed'); return undefined; },
      isProviderInstalled: async () => { if (fail && failure === 'probe') throw new Error('probe failed'); return true; },
    });
    const output = createWriter();
    await assert.rejects(runtime.run('fail', { sessionId: 'app' }, output.writer, context));
    assert.equal(output.messages.filter((m) => m.kind === 'error').length, 1);
    assert.equal(output.messages.filter((m) => m.kind === 'complete').length, 1);
    fail = false; await runtime.run('recover', { sessionId: 'app' }, createWriter().writer, context);
  });
}

test('AGY resumes only its specified native id and refuses mismatched output ids', async () => {
  const child = createFakeProcess(); let args: string[] = [];
  const runtime = createAntigravityRuntime({ spawnProcess: (_command, values) => { args = values; return child as never; } });
  const output = createWriter();
  const run = runtime.run('continue', { sessionId: 'app' }, output.writer, createRuntimeContext({ resolveProviderSessionId: () => 'existing' }));
  const checked = assert.rejects(run, /inconsistent/); await tick();
  assert.equal(args[args.indexOf('--conversation') + 1], 'existing');
  emitInit(child, 'foreign'); await checked;
  assert.equal(output.getProviderSessionId(), 'existing');
});

test('missing protocol metadata fails closed instead of guessing a conversation', async () => {
  const child = createFakeProcess();
  const runtime = createAntigravityRuntime({ spawnProcess: () => child as never });
  const run = runtime.run('Hi', {}, createWriter().writer, createRuntimeContext());
  const checked = assert.rejects(run, /stream-json/); await tick(); child.emit('close', 0, null); await checked;
});

test('configured executable receives multiline leading-dash prompt only on stdin', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-stdin-'));
  const previous = process.env.AGY_CLI_PATH;
  try {
    const executable = path.join(root, 'fake agy');
    await writeFile(executable, `#!${process.execPath}\nlet input = '';\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data', chunk => input += chunk);\nprocess.stdin.on('end', () => {\n const prompt = JSON.parse(input).message.content;\n if (process.argv.some(arg => arg.includes('secret prompt'))) process.exit(9);\n console.log(JSON.stringify({event:'init', conversation_id:'stdin-native'}));\n console.log(JSON.stringify({event:'result', result:{conversation_id:'stdin-native',status:'SUCCESS',response:prompt}}));\n});\n`);
    await chmod(executable, 0o755); process.env.AGY_CLI_PATH = `"${executable}"`;
    const output = createWriter(); const prompt = '-secret prompt\nsecond line';
    await createAntigravityRuntime().run(prompt, {}, output.writer, createRuntimeContext());
    assert.equal(output.messages.find((m) => m.kind === 'stream_delta')?.content, prompt);
  } finally {
    if (previous === undefined) delete process.env.AGY_CLI_PATH; else process.env.AGY_CLI_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});
