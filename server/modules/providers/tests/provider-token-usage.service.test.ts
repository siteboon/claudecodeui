import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  createProviderTokenUsageService,
  summarizeClaudeTokenUsage,
} from '@/modules/providers/services/provider-token-usage.service.js';
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
    forked_from_session_id: null,
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

test('the Claude summarizer reads the newest assistant turn, not the whole conversation', () => {
  const entries = [
    { type: 'assistant', message: { usage: { input_tokens: 5, cache_read_input_tokens: 1000, output_tokens: 50 } } },
    { type: 'user', message: { role: 'user', content: 'next' } },
    // The newest turn's prompt is the whole context, so its cache_read already
    // includes everything before it. Summing turns would double-count.
    { type: 'assistant', message: { usage: { input_tokens: 3, cache_read_input_tokens: 4000, cache_creation_input_tokens: 100, output_tokens: 80 } } },
  ];

  assert.deepEqual(summarizeClaudeTokenUsage(entries, '200000'), {
    used: 4183,
    total: 200_000,
    inputTokens: 4103,
    outputTokens: 80,
    cacheReadTokens: 4000,
    cacheCreationTokens: 100,
    cacheTokens: 4100,
    breakdown: { input: 4103, output: 80 },
  });
});

test('the Claude summarizer skips synthetic rows that carry an all-zero usage block', () => {
  // Interrupts, API errors and "No response requested." are written as
  // assistant rows with a fully zeroed usage block. Reading one as the newest
  // turn dropped the composer counter to 0 until the next turn pushed it back.
  const entries = [
    { type: 'assistant', message: { usage: { input_tokens: 3, cache_read_input_tokens: 4000, output_tokens: 80 } } },
    {
      type: 'assistant',
      message: {
        model: '<synthetic>',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
  ];

  assert.equal(summarizeClaudeTokenUsage(entries, '200000').used, 4083);
});

test('the Claude summarizer skips a subagent sidechain turn', () => {
  // A sidechain turn reports the subagent's own context window. Reading it
  // made the counter drop to the subagent's number mid-run.
  const entries = [
    { type: 'assistant', message: { usage: { input_tokens: 3, cache_read_input_tokens: 4000, output_tokens: 80 } } },
    {
      type: 'assistant',
      isSidechain: true,
      message: { usage: { input_tokens: 10, cache_read_input_tokens: 900, output_tokens: 5 } },
    },
  ];

  assert.equal(summarizeClaudeTokenUsage(entries, '200000').used, 4083);
});

test('the Claude summarizer reports zero for a transcript with no assistant turn yet', () => {
  const usage = summarizeClaudeTokenUsage([{ type: 'user', message: { role: 'user', content: 'hi' } }], '200000');

  assert.equal(usage.used, 0);
  assert.equal(usage.total, 200_000);
});
