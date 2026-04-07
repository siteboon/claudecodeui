import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppError } from '@/shared/utils/app-error.js';
import { llmService } from '@/modules/llm/services/llm.service.js';
import { CursorProvider } from '@/modules/llm/providers/cursor.provider.js';
import { GeminiProvider } from '@/modules/llm/providers/gemini.provider.js';
import { CodexProvider } from '@/modules/llm/providers/codex.provider.js';
import { ClaudeProvider } from '@/modules/llm/providers/claude.provider.js';

const asyncEvents = async function* (events: unknown[]) {
  for (const event of events) {
    yield event;
  }
};

// This test covers Cursor start/resume command construction, including yolo/model/resume flags.
test('cursor provider builds start/resume CLI invocations correctly', () => {
  const provider = new CursorProvider() as any;

  const start = provider.createCliInvocation({
    prompt: 'build feature',
    sessionId: 'cursor-session-1',
    isResume: false,
    model: 'composer-2',
    allowYolo: true,
    workspacePath: '/tmp/workspace',
  });
  assert.equal(start.command, 'cursor-agent');
  assert.deepEqual(start.args, [
    '--print',
    '--trust',
    '--output-format',
    'stream-json',
    '--yolo',
    '--model',
    'composer-2',
    'build feature',
  ]);

  const resume = provider.createCliInvocation({
    prompt: 'continue',
    sessionId: 'cursor-session-1',
    isResume: true,
    workspacePath: '/tmp/workspace',
  });
  assert.equal(resume.command, 'cursor-agent');
  assert.deepEqual(resume.args, [
    '--print',
    '--trust',
    '--output-format',
    'stream-json',
    '--resume',
    'cursor-session-1',
    'continue',
  ]);
});

// This test covers Cursor model-list parsing, including ANSI stripping and current/default flags.
test('cursor provider parses model list output into normalized models', async () => {
  const provider = new CursorProvider() as any;

  provider.runCommandForOutput = async () => [
    '\u001b[32mAvailable models\u001b[0m',
    'auto - Auto (current)',
    'composer-2-fast - Composer 2 Fast (default)',
    'Tip: use --model',
  ].join('\n');

  const models = await provider.listModels();
  assert.equal(models.length, 2);
  assert.deepEqual(models[0], {
    value: 'auto',
    displayName: 'auto',
    description: 'Auto',
    current: true,
    default: false,
    supportsThinkingModes: false,
    supportedThinkingModes: [],
  });
  assert.equal(models[1].value, 'composer-2-fast');
  assert.equal(models[1].default, true);
});

// This test covers Gemini start/resume CLI construction and curated model list contract.
test('gemini provider builds start/resume CLI invocations and exposes curated models', async () => {
  const provider = new GeminiProvider() as any;

  const start = provider.createCliInvocation({
    prompt: 'explain architecture',
    sessionId: 'gemini-session-1',
    isResume: false,
    model: 'gemini-2.5-pro',
    workspacePath: '/tmp/workspace',
  });
  assert.equal(start.command, 'gemini');
  assert.deepEqual(start.args, [
    '--prompt',
    'explain architecture',
    '--output-format',
    'stream-json',
    '--model',
    'gemini-2.5-pro',
  ]);

  const resume = provider.createCliInvocation({
    prompt: 'continue',
    sessionId: 'gemini-session-1',
    isResume: true,
    workspacePath: '/tmp/workspace',
  });
  assert.deepEqual(resume.args, [
    '--prompt',
    'continue',
    '--output-format',
    'stream-json',
    '--resume',
    'gemini-session-1',
  ]);

  const models = await provider.listModels();
  assert.ok(models.some((model: { value?: string }) => model.value === 'gemini-2.5-pro'));
});

// This test covers Codex start/resume behavior and abort-controller based stop behavior.
test('codex provider start/resume use correct SDK thread methods and stop aborts signal', async () => {
  const provider = new CodexProvider() as any;

  const calls: Array<{ fn: 'start' | 'resume'; sessionId?: string; options: Record<string, unknown> }> = [];
  let capturedSignal: AbortSignal | undefined;

  const fakeThread = {
    async runStreamed(_prompt: string, options?: { signal?: AbortSignal }) {
      capturedSignal = options?.signal;
      return { events: asyncEvents([{ type: 'chunk' }]) };
    },
  };

  provider.loadCodexSdkModule = async () => ({
    Codex: class {
      startThread(options?: Record<string, unknown>) {
        calls.push({ fn: 'start', options: options ?? {} });
        return fakeThread;
      }

      resumeThread(sessionId: string, options?: Record<string, unknown>) {
        calls.push({ fn: 'resume', sessionId, options: options ?? {} });
        return fakeThread;
      }
    },
  });

  const startExec = await provider.createSdkExecution({
    prompt: 'start codex',
    sessionId: 'codex-session-1',
    isResume: false,
    model: 'gpt-5.4',
    thinkingMode: 'high',
    workspacePath: '/tmp/workspace',
  });
  assert.equal(calls[0]?.fn, 'start');
  assert.equal(calls[0]?.options.model, 'gpt-5.4');
  assert.equal(calls[0]?.options.modelReasoningEffort, 'high');
  assert.equal(calls[0]?.options.workingDirectory, '/tmp/workspace');

  assert.equal(await startExec.stop(), true);
  assert.equal(capturedSignal?.aborted, true);

  await provider.createSdkExecution({
    prompt: 'resume codex',
    sessionId: 'codex-session-1',
    isResume: true,
    workspacePath: '/tmp/workspace',
  });
  assert.equal(calls[1]?.fn, 'resume');
  assert.equal(calls[1]?.sessionId, 'codex-session-1');
});

// This test covers Codex model-list loading from ~/.codex/models_cache.json and model-shape mapping.
test('codex provider reads models_cache.json and maps model metadata', async () => {
  const provider = new CodexProvider();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-models-'));
  const codexDir = path.join(tempRoot, '.codex');
  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(
    path.join(codexDir, 'models_cache.json'),
    JSON.stringify({
      models: [
        {
          slug: 'gpt-5.4',
          display_name: 'GPT-5.4',
          description: 'Latest frontier agentic coding model.',
          priority: 1,
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'medium' },
            { effort: 'high' },
          ],
        },
      ],
    }),
    'utf8',
  );

  const originalHomeDir = os.homedir;
  (os as any).homedir = () => tempRoot;

  try {
    const models = await provider.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0]?.value, 'gpt-5.4');
    assert.equal(models[0]?.default, true);
    assert.deepEqual(models[0]?.supportedThinkingModes, ['low', 'medium', 'high']);
  } finally {
    (os as any).homedir = originalHomeDir;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// This test covers explicit start/resume payload control for model/thinking without implicit persistence.
test('codex provider does not persist model/thinking between launches', async () => {
  const provider = new CodexProvider() as any;
  const threadOptionsHistory: Record<string, unknown>[] = [];

  provider.loadCodexSdkModule = async () => ({
    Codex: class {
      startThread(options?: Record<string, unknown>) {
        threadOptionsHistory.push(options ?? {});
        return {
          async runStreamed() {
            return { events: asyncEvents([]) };
          },
        };
      }

      resumeThread() {
        return {
          async runStreamed() {
            return { events: asyncEvents([]) };
          },
        };
      }
    },
  });

  await provider.launchSession({
    prompt: 'explicit launch options',
    sessionId: 'codex-pref-1',
    model: 'gpt-5.4',
    thinkingMode: 'xhigh',
  });

  await provider.launchSession({
    prompt: 'follow-up launch without options',
    sessionId: 'codex-pref-1',
  });

  assert.equal(threadOptionsHistory.length, 2);
  assert.equal((threadOptionsHistory[0] as { model?: string }).model, 'gpt-5.4');
  assert.equal((threadOptionsHistory[0] as { modelReasoningEffort?: string }).modelReasoningEffort, 'xhigh');
  assert.equal((threadOptionsHistory[1] as { model?: string }).model, undefined);
  assert.equal((threadOptionsHistory[1] as { modelReasoningEffort?: string }).modelReasoningEffort, undefined);
});

// This test covers Claude thinking-level mapping, runtime permission handlers, and model/event normalization.
test('claude provider helper mappings match unifier contract', async () => {
  const provider = new ClaudeProvider() as any;

  assert.equal(provider.resolveClaudeEffort(undefined), 'high');
  assert.equal(provider.resolveClaudeEffort('low'), 'low');
  assert.equal(provider.resolveClaudeEffort('not-real'), 'high');

  const allowHandler = provider.resolvePermissionHandler('allow');
  const denyHandler = provider.resolvePermissionHandler('deny');
  const askHandler = provider.resolvePermissionHandler('ask');
  assert.equal(typeof allowHandler, 'function');
  assert.equal(typeof denyHandler, 'function');
  assert.equal(askHandler, undefined);

  const allowResult = await allowHandler?.();
  const denyResult = await denyHandler?.();
  assert.deepEqual(allowResult, { behavior: 'allow' });
  assert.equal(denyResult?.behavior, 'deny');

  const mappedModel = provider.mapModelInfo({
    value: 'default',
    displayName: 'Default',
    description: 'Default Claude model',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
  });
  assert.equal(mappedModel.value, 'default');
  assert.equal(mappedModel.supportsThinkingModes, true);
  assert.deepEqual(mappedModel.supportedThinkingModes, ['low', 'medium', 'high', 'max']);

  const mappedEvent = provider.mapSdkEvent({ type: 'message', subtype: 'delta' });
  assert.equal(mappedEvent?.message, 'message:delta');
});

// This test covers service-level capability validation for runtime permissions and thinking mode support.
test('llmService rejects unsupported runtime permission and thinking mode combinations', async () => {
  await assert.rejects(
    llmService.startSession('cursor', {
      prompt: 'hello',
      runtimePermissionMode: 'allow',
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'RUNTIME_PERMISSION_NOT_SUPPORTED' &&
      error.statusCode === 400,
  );

  await assert.rejects(
    llmService.startSession('cursor', {
      prompt: 'hello',
      thinkingMode: 'high',
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'THINKING_MODE_NOT_SUPPORTED' &&
      error.statusCode === 400,
  );
});
