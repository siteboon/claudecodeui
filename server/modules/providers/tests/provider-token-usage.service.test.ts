import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';
import type { IProvider } from '@/shared/interfaces.js';
import type {
  ProviderSessionUsageInput,
  ProviderTokenUsageResult,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

function createSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'app-session',
    provider: 'claude',
    provider_session_id: 'provider-session',
    project_path: null,
    jsonl_path: null,
    custom_name: null,
    model: null,
    effort: null,
    isArchived: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function stubProvider(
  sessions: Partial<IProvider['sessions']> = {},
  auth: Partial<IProvider['auth']> = {},
): Pick<IProvider, 'sessions' | 'auth'> {
  return {
    sessions: {
      normalizeMessage: () => [],
      fetchHistory: async () => ({ messages: [], total: 0, hasMore: false, offset: 0, limit: null }),
      ...sessions,
    },
    auth: auth as IProvider['auth'],
  } as Pick<IProvider, 'sessions' | 'auth'>;
}

test('token usage dispatches to the provider sessions facet with the mapped session identity', async () => {
  const usage: ProviderTokenUsageResult = {
    used: 42,
    inputTokens: 30,
    outputTokens: 12,
    breakdown: { input: 30, output: 12 },
  };
  const seenInputs: ProviderSessionUsageInput[] = [];

  const service = createProviderTokenUsageService({
    getSessionById: () => createSessionRow({
      provider: 'zcode',
      provider_session_id: 'sess_native',
      jsonl_path: '/data/transcript.jsonl',
      project_path: '/workspaces/demo',
    }),
    resolveProvider: () => stubProvider({
      getTokenUsage: async (input) => {
        seenInputs.push(input);
        return usage;
      },
    }),
  });

  assert.deepEqual(await service.getSessionTokenUsage('app-session'), usage);
  assert.deepEqual(seenInputs[0], {
    appSessionId: 'app-session',
    nativeSessionId: 'sess_native',
    jsonlPath: '/data/transcript.jsonl',
    projectPath: '/workspaces/demo',
  });
});

test('token usage falls back to the app session id when no native id is recorded', async () => {
  const service = createProviderTokenUsageService({
    getSessionById: () => createSessionRow({ provider_session_id: null }),
    resolveProvider: () => stubProvider({
      getTokenUsage: async (input) => {
        assert.equal(input.nativeSessionId, 'app-session');
        return { used: 1, inputTokens: 1, outputTokens: 0, breakdown: { input: 1, output: 0 } };
      },
    }),
  });

  await service.getSessionTokenUsage('app-session');
});

test('providers without a getTokenUsage facet answer with an explicit unsupported result', async () => {
  const service = createProviderTokenUsageService({
    getSessionById: () => createSessionRow({ provider: 'cursor' }),
    resolveProvider: () => stubProvider(),
  });

  const result = await service.getSessionTokenUsage('app-session');

  assert.equal(result.unsupported, true);
  assert.equal(result.used, 0);
  assert.equal(result.total, 0);
  assert.match(result.message ?? '', /cursor/);
});

test('token usage reports SESSION_NOT_FOUND for an unknown app session id', async () => {
  const service = createProviderTokenUsageService({ getSessionById: () => null });

  await assert.rejects(
    () => service.getSessionTokenUsage('missing-session'),
    (error: unknown) => (
      error instanceof AppError
      && error.code === 'SESSION_NOT_FOUND'
      && error.statusCode === 404
    ),
  );
});

test('quota dispatches to the provider auth facet', async () => {
  const quota = {
    groups: [
      {
        name: 'Gemini Models',
        buckets: [
          {
            id: 'gemini-5h',
            name: 'Five Hour Limit Remaining',
            window: '5h',
            remainingFraction: 0.8,
          },
        ],
      },
    ],
    updatedAt: '2026-09-03T08:00:00.000Z',
  };

  const service = createProviderTokenUsageService({
    resolveProvider: (provider) => stubProvider(
      {},
      provider === 'antigravity' ? { getQuota: async () => quota } : {},
    ),
  });

  const antigravityQuota = await service.getProviderQuota('antigravity');
  assert.ok(antigravityQuota);
  assert.equal(antigravityQuota.groups[0].name, 'Gemini Models');

  const claudeQuota = await service.getProviderQuota('claude');
  assert.equal(claudeQuota, null);
});
