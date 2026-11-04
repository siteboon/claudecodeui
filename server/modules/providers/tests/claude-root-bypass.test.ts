import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { AnyRecord, NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/** Capture real runtime options at the SDK seam without starting a CLI or resuming a conversation. */
async function captureOptions(input: AnyRecord) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-root-bypass-'));
  const sent: NormalizedMessage[] = [];
  let captured: AnyRecord | undefined;
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
    createQuery: ({ prompt, options }) => {
      captured = options;
      void (async () => { for await (const _message of prompt) { /* Drain held input. */ } })();
      return Object.assign((async function* () {})(), { interrupt: async () => {} }) as never;
    },
  };
  try {
    await queryClaudeSDK('hello', { cwd, ...input }, {
      send: (message: NormalizedMessage) => { sent.push(message); }, userId: null,
    } as never, context);
    assert.ok(captured, 'runtime must reach the SDK');
    assert.equal(sent.some(message => message.kind === 'error'), false);
    return { options: captured, sent };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

for (const input of [
  { permissionMode: 'bypassPermissions' },
  { toolsSettings: { skipPermissions: true } },
]) {
  test(`root bypass uses SDK callbacks: ${JSON.stringify(input)}`, { skip: !process.getuid }, async t => {
    t.mock.method(process as { getuid: () => number }, 'getuid', () => 0);
    const { options, sent } = await captureOptions(input);
    assert.equal(options.permissionMode, 'default');
    assert.notEqual(options.permissionMode, 'dontAsk', 'dontAsk denies tools before canUseTool');
    const command = { command: 'printf hello' };
    assert.deepEqual(await options.canUseTool('Bash', command), { behavior: 'allow', updatedInput: command });
    assert.equal(sent.some(message => message.kind === 'permission_request'), false);

    for (const tool of ['AskUserQuestion', 'ExitPlanMode']) {
      const controller = new AbortController();
      const pending = options.canUseTool(tool, {}, { signal: controller.signal });
      assert.ok(sent.some(message => message.kind === 'permission_request' && message.toolName === tool));
      controller.abort();
      assert.equal((await pending).behavior, 'deny');
    }
  });
}

test('non-root bypass keeps the native permission mode', { skip: !process.getuid }, async t => {
  t.mock.method(process as { getuid: () => number }, 'getuid', () => 1000);
  for (const input of [{ permissionMode: 'bypassPermissions' }, { toolsSettings: { skipPermissions: true } }]) {
    const { options } = await captureOptions(input);
    assert.equal(options.permissionMode, 'bypassPermissions');
  }
});

test('root plan and explicit non-bypass modes keep their approval behavior', { skip: !process.getuid }, async t => {
  t.mock.method(process as { getuid: () => number }, 'getuid', () => 0);
  for (const mode of ['plan', 'acceptEdits', 'default']) {
    const { options, sent } = await captureOptions({
      permissionMode: mode,
      toolsSettings: { skipPermissions: mode === 'plan', disallowedTools: ['Bash'] },
    });
    assert.equal(options.permissionMode, mode === 'default' ? undefined : mode);
    assert.equal((await options.canUseTool('Bash', { command: 'printf hello' })).behavior, 'deny');
    assert.equal(sent.some(message => message.kind === 'permission_request'), false);
  }
});
