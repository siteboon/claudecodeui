/**
 * Antigravity Quota Provider Tests
 *
 * Exercises quota fetching, parsing, in-memory caching, and error resilience.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { IProvider } from '@/shared/interfaces.js';

import {
  fetchAntigravityQuota,
  resetAntigravityQuotaCache,
} from '../list/antigravity/antigravity-quota.provider.js';
import { createProviderTokenUsageService } from '../services/provider-token-usage.service.js';

const mockAgyUsageOutput = JSON.stringify({
  command: {
    name: 'usage',
    data: {
      description: 'Test quota description',
      groups: [
        {
          name: 'Gemini Models',
          description: 'Models: Gemini Flash, Gemini Pro',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              description: 'Weekly refresh',
              window: 'weekly',
              remaining_fraction: 0.564,
              reset_time: '2026-09-04T08:36:58Z',
            },
            {
              id: 'gemini-5h',
              name: 'Five Hour Limit Remaining',
              description: '5-hour refresh',
              window: '5h',
              remaining_fraction: 0.755,
              reset_time: '2026-09-03T04:14:40Z',
            },
          ],
        },
        {
          name: 'Claude and GPT models',
          description: 'Models: Claude Opus, Claude Sonnet',
          buckets: [
            {
              id: '3p-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 0.545,
              reset_time: '2026-09-04T02:30:53Z',
            },
            {
              id: '3p-5h',
              name: 'Five Hour Limit Remaining',
              window: '5h',
              remaining_fraction: 1.0,
              reset_time: '2026-09-03T05:15:12Z',
            },
          ],
        },
      ],
    },
  },
});

test('fetchAntigravityQuota parses agy CLI output into normalized groups and buckets', async () => {
  resetAntigravityQuotaCache();

  let executedCommand: string[] = [];
  const result = await fetchAntigravityQuota(
    {},
    {
      resolveEnginePath: () => '/bin/agy',
      runCommand: async (_execPath, args) => {
        executedCommand = args;
        return { stdout: mockAgyUsageOutput, stderr: '' };
      },
      now: () => 100_000,
    },
  );

  assert.ok(result);
  assert.equal(executedCommand.join(' '), '--output-format json --print /usage');
  assert.equal(result.groups.length, 2);

  const geminiGroup = result.groups[0];
  assert.equal(geminiGroup.name, 'Gemini Models');
  assert.equal(geminiGroup.buckets.length, 2);
  assert.equal(geminiGroup.buckets[0].id, 'gemini-weekly');
  assert.equal(geminiGroup.buckets[0].window, 'weekly');
  assert.equal(geminiGroup.buckets[0].remainingFraction, 0.564);
  assert.equal(geminiGroup.buckets[0].resetTime, '2026-09-04T08:36:58Z');

  assert.equal(geminiGroup.buckets[1].id, 'gemini-5h');
  assert.equal(geminiGroup.buckets[1].window, '5h');
  assert.equal(geminiGroup.buckets[1].remainingFraction, 0.755);
});

test('fetchAntigravityQuota caches response and does not re-invoke agy CLI within TTL', async () => {
  resetAntigravityQuotaCache();

  let callCount = 0;
  const deps = {
    resolveEnginePath: () => '/bin/agy',
    runCommand: async () => {
      callCount += 1;
      return { stdout: mockAgyUsageOutput, stderr: '' };
    },
    now: () => 1_000_000,
  };

  const first = await fetchAntigravityQuota({}, deps);
  const second = await fetchAntigravityQuota({}, deps);

  assert.equal(callCount, 1);
  assert.deepEqual(first, second);

  // With forceRefresh = true, it should invoke CLI again
  const refreshed = await fetchAntigravityQuota({ forceRefresh: true }, deps);
  assert.equal(callCount, 2);
  assert.ok(refreshed);
});

test('fetchAntigravityQuota returns null gracefully on execution failure or missing binary', async () => {
  resetAntigravityQuotaCache();

  const missingBinary = await fetchAntigravityQuota(
    {},
    {
      resolveEnginePath: () => null,
      runCommand: async () => {
        throw new Error('Should not run');
      },
      now: () => 1_000_000,
    },
  );
  assert.equal(missingBinary, null);

  const commandError = await fetchAntigravityQuota(
    {},
    {
      resolveEnginePath: () => '/bin/agy',
      runCommand: async () => {
        throw new Error('Command failed: agy exit 1');
      },
      now: () => 1_000_000,
    },
  );
  assert.equal(commandError, null);
});

test('providerTokenUsageService routes getProviderQuota correctly by provider', async () => {
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
    resolveProvider: (provider: string) => ({
      auth: provider === 'antigravity' ? { getQuota: async () => quota } : {},
      sessions: {},
    }) as unknown as Pick<IProvider, 'sessions' | 'auth'>,
  });

  const antigravityQuota = await service.getProviderQuota('antigravity');
  assert.ok(antigravityQuota);
  assert.equal(antigravityQuota.groups[0].name, 'Gemini Models');

  const claudeQuota = await service.getProviderQuota('claude');
  assert.equal(claudeQuota, null);
});
