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
import { readObjectRecord } from '@/shared/utils.js';

import { AntigravityRuntimeProvider } from '../list/antigravity/antigravity-runtime.provider.js';
import { AntigravitySessionsProvider } from '../list/antigravity/antigravity-sessions.provider.js';

const stubDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agy-stub-'));
const stubPath = path.join(stubDir, 'agy');
const argsFilePath = path.join(stubDir, 'args.txt');

const stubScript = `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.env.AGY_ARGS_FILE, process.argv.slice(2).join('\\n') + '\\n');
const mode = process.env.AGY_STUB_MODE;
if (mode === 'sleep') {
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
} else if (mode === 'fail') {
  console.error('agy: quota exceeded for project');
  process.exit(1);
} else if (mode === 'error-result') {
  console.log(JSON.stringify({ event: 'init', conversation_id: 'stub-conv-err', init: { cwd: '/tmp' } }));
  console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'stub-conv-err', status: 'ERROR', error: 'model overloaded' } }));
} else if (mode === 'noisy') {
  console.log('connecting to backend...');
  console.log(JSON.stringify({ event: 'init', conversation_id: 'stub-conv-noisy', init: { cwd: '/tmp' } }));
  console.log(JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'stub-conv-noisy', step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'OK' } }));
  console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'stub-conv-noisy', status: 'SUCCESS', usage: { total_tokens: 7 } } }));
} else if (mode === 'explosive') {
  console.log(JSON.stringify({ event: 'init', conversation_id: 'stub-conv-boom', init: { cwd: '/tmp' } }));
  console.log(JSON.stringify({ event: 'explosive', payload: true }));
  console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'stub-conv-boom', status: 'SUCCESS', usage: { total_tokens: 1 } } }));
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
  getProviderModels: async () => ({
    OPTIONS: [
      {
        value: 'gemini-3.7-flash',
        label: 'Gemini 3.7 Flash',
        effort: {
          default: 'high',
          values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
          encoding: 'model-suffix',
        },
      },
      {
        value: 'gemini-3.1-pro',
        label: 'Gemini 3.1 Pro',
        effort: {
          default: 'high',
          values: [{ value: 'low' }, { value: 'high' }],
          encoding: 'model-suffix',
        },
      },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
      { value: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
    ],
    DEFAULT: 'gemini-3.7-flash',
  }),
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

test('runtime declares the project directory as an explicit agy workspace', async () => {
  const runtime = new AntigravityRuntimeProvider();
  const { writer } = createWriter();
  // Real directories: spawn fails with ENOENT when cwd does not exist.
  const workspaceA = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agy-ws-a-'));
  const workspaceB = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agy-ws-b-'));

  // agy's print mode ignores the spawn cwd for its shell tool (it lands in
  // ~/.gemini/antigravity-cli/scratch), so the project must also arrive via
  // --add-dir. The cwd option wins over projectPath, mirroring spawn cwd.
  await fs.rm(argsFilePath, { force: true });
  await runtime.run(
    'hello',
    { sessionId: 'sess-workspace', projectPath: workspaceB, cwd: workspaceA },
    writer,
    context,
  );
  let args = await readRecordedArgs();
  const addDirIndex = args.indexOf('--add-dir');
  assert.notEqual(addDirIndex, -1, `expected --add-dir in ${JSON.stringify(args)}`);
  assert.equal(args[addDirIndex + 1], workspaceA, '--add-dir must carry the explicit cwd');

  await fs.rm(argsFilePath, { force: true });
  await runtime.run('hello', { sessionId: 'sess-workspace-2' }, writer, context);
  args = await readRecordedArgs();
  assert.ok(!args.includes('--add-dir'), 'no workspace flag without an explicit project directory');

  await fs.rm(workspaceA, { recursive: true, force: true });
  await fs.rm(workspaceB, { recursive: true, force: true });
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

test('runtime resolves model selection and reasoning effort into agy arguments', async () => {
  const runtime = new AntigravityRuntimeProvider();

  const scenarios: Array<{
    name: string;
    options: { model?: string; effort?: string };
    expectModel: string;
    expectEffort?: string;
  }> = [
    {
      // Legacy saved sessions still carry suffixed ids: rewrite the suffix to
      // the requested effort and never combine both channels.
      name: 'legacy suffixed id with a conflicting effort rewrites the suffix',
      options: { model: 'gemini-3.7-flash-high', effort: 'medium' },
      expectModel: 'gemini-3.7-flash-medium',
    },
    {
      name: 'legacy suffixed id without an effort keeps its tier',
      options: { model: 'gemini-3.7-flash-low' },
      expectModel: 'gemini-3.7-flash-low',
    },
    {
      name: 'base model with an explicit effort appends the tier',
      options: { model: 'gemini-3.7-flash', effort: 'medium' },
      expectModel: 'gemini-3.7-flash-medium',
    },
    {
      name: 'base model without an effort falls back to the family default tier',
      options: { model: 'gemini-3.7-flash' },
      expectModel: 'gemini-3.7-flash-high',
    },
    {
      // The UI does not offer it, but a stale row can request a tier the
      // family lacks; the default tier keeps the id valid.
      name: 'effort outside the family tiers snaps to the default tier',
      options: { model: 'gemini-3.1-pro', effort: 'medium' },
      expectModel: 'gemini-3.1-pro-high',
    },
    {
      // Same guard for a legacy suffixed id whose tier set has since
      // narrowed: the row's model + effort must not combine into an id agy
      // never offered.
      name: 'legacy suffixed id with an unavailable effort snaps to the default tier',
      options: { model: 'gemini-3.1-pro-high', effort: 'medium' },
      expectModel: 'gemini-3.1-pro-high',
    },
    {
      // Claude passthroughs and the fixed-tier gpt-oss row have no
      // adjustable tiers: a stale effort choice must be dropped and the id
      // must never be rewritten into something agy does not offer.
      name: 'cataloged model without effort support drops a stale effort',
      options: { model: 'claude-sonnet-4-6', effort: 'high' },
      expectModel: 'claude-sonnet-4-6',
    },
    {
      name: 'fixed-tier suffixed model keeps its real id',
      options: { model: 'gpt-oss-120b-medium', effort: 'high' },
      expectModel: 'gpt-oss-120b-medium',
    },
    {
      name: 'unknown custom model keeps its id and uses --effort',
      options: { model: 'my-custom-gpt', effort: 'low' },
      expectModel: 'my-custom-gpt',
      expectEffort: 'low',
    },
  ];

  for (const scenario of scenarios) {
    await fs.rm(argsFilePath, { force: true });
    const { writer } = createWriter();
    await runtime.run('hello', { sessionId: `sess-effort-${scenario.name}`, ...scenario.options }, writer, context);

    const args = await readRecordedArgs();
    const modelIndex = args.indexOf('--model');
    assert.ok(modelIndex !== -1, `${scenario.name}: expected --model in ${JSON.stringify(args)}`);
    assert.equal(args[modelIndex + 1], scenario.expectModel, scenario.name);
    if (scenario.expectEffort) {
      const effortIndex = args.indexOf('--effort');
      assert.ok(effortIndex !== -1, `${scenario.name}: expected --effort in ${JSON.stringify(args)}`);
      assert.equal(args[effortIndex + 1], scenario.expectEffort, scenario.name);
    } else {
      assert.ok(!args.includes('--effort'), `${scenario.name}: --effort must not appear in ${JSON.stringify(args)}`);
    }
  }
});

test('runtime degrades to flag-based effort when the catalog lookup fails', async () => {
  const runtime = new AntigravityRuntimeProvider();
  const brokenContext: ProviderRuntimeContext = {
    ...context,
    getProviderModels: async () => {
      throw new Error('catalog unavailable');
    },
  };

  await fs.rm(argsFilePath, { force: true });
  const { writer } = createWriter();
  await runtime.run('hello', { sessionId: 'sess-effort-catalog-down', model: 'gemini-3.7-flash', effort: 'medium' }, writer, brokenContext);

  const args = await readRecordedArgs();
  const modelIndex = args.indexOf('--model');
  assert.equal(args[modelIndex + 1], 'gemini-3.7-flash');
  const effortIndex = args.indexOf('--effort');
  assert.ok(effortIndex !== -1, `expected --effort fallback in ${JSON.stringify(args)}`);
  assert.equal(args[effortIndex + 1], 'medium');
});


test('runtime surfaces stderr from a failed run as an error message', async () => {
  const runtime = new AntigravityRuntimeProvider();
  await fs.rm(argsFilePath, { force: true });
  process.env.AGY_STUB_MODE = 'fail';
  try {
    const { messages, writer } = createWriter();
    await assert.rejects(
      runtime.run('hello', { sessionId: 'sess-stderr' }, writer, context),
      /quota exceeded/,
      'the rejection reason must carry the stderr tail',
    );

    const error = messages.find((msg) => msg.kind === 'error');
    assert.ok(error, 'an error message must reach the writer');
    assert.match(String(error?.content), /quota exceeded/);
    const complete = messages.find((msg) => msg.kind === 'complete');
    assert.equal(complete?.exitCode, 1);
  } finally {
    delete process.env.AGY_STUB_MODE;
  }
});

test('runtime reports provider error results even with a zero exit code', async () => {
  const runtime = new AntigravityRuntimeProvider();
  await fs.rm(argsFilePath, { force: true });
  process.env.AGY_STUB_MODE = 'error-result';
  try {
    const { messages, writer } = createWriter();
    const result = await runtime.run('hello', { sessionId: 'sess-err-result' }, writer, context);

    const error = messages.find((msg) => msg.kind === 'error');
    assert.ok(error, 'an ERROR result must surface an error message');
    assert.equal(error?.content, 'model overloaded');
    const complete = messages.find((msg) => msg.kind === 'complete');
    assert.equal(complete?.exitCode, 1);
    assert.deepEqual(result, { sessionId: 'stub-conv-err', success: true });
  } finally {
    delete process.env.AGY_STUB_MODE;
  }
});

test('runtime keeps plain-text stdout as stream deltas', async () => {
  const runtime = new AntigravityRuntimeProvider();
  await fs.rm(argsFilePath, { force: true });
  process.env.AGY_STUB_MODE = 'noisy';
  try {
    const { messages, writer } = createWriter();
    await runtime.run('hello', { sessionId: 'sess-noisy' }, writer, context);

    const delta = messages.find((msg) => msg.kind === 'stream_delta');
    assert.equal(delta?.content, 'connecting to backend...');
    assert.equal(messages.some((msg) => msg.kind === 'error'), false);
  } finally {
    delete process.env.AGY_STUB_MODE;
  }
});

test('runtime reports normalization failures as errors instead of raw text', async () => {
  const runtime = new AntigravityRuntimeProvider();
  await fs.rm(argsFilePath, { force: true });
  process.env.AGY_STUB_MODE = 'explosive';
  try {
    const throwingContext: ProviderRuntimeContext = {
      ...context,
      normalizeMessage: (raw, sessionId) => {
        const record = readObjectRecord(raw);
        if (record?.event === 'explosive') {
          throw new Error('norm boom');
        }
        return context.normalizeMessage(raw, sessionId);
      },
    };
    const { messages, writer } = createWriter();
    await runtime.run('hello', { sessionId: 'sess-explosive' }, writer, throwingContext);

    const error = messages.find((msg) => msg.kind === 'error');
    assert.ok(error, 'a normalization failure must surface an error message');
    assert.match(String(error?.content), /norm boom/);
    // The raw JSON line must NOT be forwarded as assistant text.
    assert.equal(
      messages.some((msg) => msg.kind === 'stream_delta' && String(msg.content).includes('explosive')),
      false,
    );
  } finally {
    delete process.env.AGY_STUB_MODE;
  }
});

test('runtime defaults print-timeout to 30m and allows option override', async () => {
  const runtime = new AntigravityRuntimeProvider();

  // 1. Default timeout
  await fs.rm(argsFilePath, { force: true });
  const { writer: writer1 } = createWriter();
  await runtime.run('hello', { sessionId: 'sess-timeout-default' }, writer1, context);
  let args = await readRecordedArgs();
  const timeoutIndex = args.indexOf('--print-timeout');
  assert.notEqual(timeoutIndex, -1, `expected --print-timeout in ${JSON.stringify(args)}`);
  assert.equal(args[timeoutIndex + 1], '30m', 'default timeout must be 30m');

  // 2. Custom override via options
  await fs.rm(argsFilePath, { force: true });
  const { writer: writer2 } = createWriter();
  await runtime.run(
    'hello',
    { sessionId: 'sess-timeout-override', printTimeout: '45m' },
    writer2,
    context,
  );
  args = await readRecordedArgs();
  const customTimeoutIndex = args.indexOf('--print-timeout');
  assert.notEqual(customTimeoutIndex, -1, `expected --print-timeout in ${JSON.stringify(args)}`);
  assert.equal(args[customTimeoutIndex + 1], '45m', 'explicit printTimeout must be passed through');
});
