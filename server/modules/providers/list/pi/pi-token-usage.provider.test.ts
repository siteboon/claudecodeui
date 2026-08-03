import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PiTokenUsageProvider } from './pi-token-usage.provider.js';
import type { PiUsage } from './pi-session-store.provider.js';

function completeUsage(overrides: Partial<PiUsage> = {}): PiUsage {
  return {
    input: 10,
    output: 20,
    cacheRead: 3,
    cacheWrite: 5,
    totalTokens: 30,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  };
}

// T22: snapshot has a last valid usage -> pass it through unchanged.
test('T22 returns the last valid usage from the snapshot', () => {
  const usage = completeUsage();
  const provider = new PiTokenUsageProvider({
    load: () => ({ lastUsage: usage }),
  });

  const result = provider.getTokenUsage('/tmp/session.jsonl');

  assert.deepEqual(result, {
    used: 30,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 3,
    cacheCreationTokens: 5,
    cacheTokens: 8,
    breakdown: { input: 10, output: 20 },
  });
});

// T23: no qualifying usage -> null, not another provider's default.
test('T23 returns null when the snapshot has no valid usage', () => {
  const provider = new PiTokenUsageProvider({
    load: () => ({ lastUsage: null }),
  });

  assert.equal(provider.getTokenUsage('/tmp/session.jsonl'), null);
});
