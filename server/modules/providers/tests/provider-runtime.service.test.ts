import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';

function createRuntime(overrides: Partial<IProviderRuntime> = {}): IProviderRuntime {
  return {
    async run() {
      return undefined;
    },
    abort() {
      return false;
    },
    ...overrides,
  };
}

test('dispatches runs and aborts through the resolved provider runtime', async () => {
  const calls: unknown[][] = [];
  const runtime = createRuntime({
    async run(command, options, writer) {
      calls.push(['run', command, options, writer]);
      return 'complete';
    },
    async abort(sessionId) {
      calls.push(['abort', sessionId]);
      return true;
    },
  });
  const resolvedProviders: string[] = [];
  const service = createProviderRuntimeService({
    hasRuntime: (provider) => provider === 'claude',
    listRuntimes: () => [runtime],
    resolveRuntime(provider) {
      resolvedProviders.push(provider);
      return runtime;
    },
  });
  const writer = { send() {} };

  assert.equal(service.hasRuntime('claude'), true);
  assert.equal(service.hasRuntime('unknown'), false);
  assert.equal(await service.getRunner('claude')('hello', { model: 'sonnet' }, writer), 'complete');
  assert.equal(await service.abort('claude', 'session-1'), true);
  assert.deepEqual(resolvedProviders, ['claude', 'claude']);
  assert.deepEqual(calls, [
    ['run', 'hello', { model: 'sonnet' }, writer],
    ['abort', 'session-1'],
  ]);
});

test('routes permission decisions and pending requests through capable runtimes', () => {
  const decisions: unknown[][] = [];
  const claudeRuntime = createRuntime({
    permissions: {
      resolve(requestId, decision) {
        decisions.push([requestId, decision]);
      },
      listPending(sessionId) {
        return [{ requestId: 'request-1', sessionId }];
      },
    },
  });
  const runtimes: Partial<Record<LLMProvider, IProviderRuntime>> = {
    claude: claudeRuntime,
    cursor: createRuntime(),
  };
  const service = createProviderRuntimeService({
    hasRuntime: (provider) => provider in runtimes,
    listRuntimes: () => Object.values(runtimes),
    resolveRuntime(provider) {
      const runtime = runtimes[provider as LLMProvider];
      if (!runtime) {
        throw new Error(`Missing runtime: ${provider}`);
      }
      return runtime;
    },
  });
  const decision = { allow: true, message: 'approved' };

  service.resolveToolApproval('request-1', decision);

  assert.deepEqual(decisions, [['request-1', decision]]);
  assert.deepEqual(service.getPendingApprovalsForSession('session-1'), [
    { requestId: 'request-1', sessionId: 'session-1' },
  ]);
});
