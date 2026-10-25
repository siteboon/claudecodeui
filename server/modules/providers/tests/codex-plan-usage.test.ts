import assert from 'node:assert/strict';
import test from 'node:test';

import { createCodexPlanUsageService } from '@/modules/providers/services/codex-plan-usage.service.js';

const snapshot = {
  primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_800_000_000 },
  secondary: { usedPercent: 17, windowDurationMins: 10_080, resetsAt: 1_800_100_000 },
};

test('Codex plan usage maps five-hour and weekly windows, including reset timestamps', async () => {
  const service = createCodexPlanUsageService({
    readRateLimits: async () => snapshot,
    now: () => 1_000_000,
  });

  assert.deepEqual(await service.getPlanUsage(), {
    available: true,
    subscriptionType: null,
    fiveHour: { utilization: 42, resetsAt: '2027-01-15T08:00:00.000Z' },
    sevenDay: { utilization: 17, resetsAt: '2027-01-16T11:46:40.000Z' },
    fetchedAt: '1970-01-01T00:16:40.000Z',
  });
});

test('Codex plan usage caches reads and reports missing plan windows', async () => {
  let now = 1_000_000;
  let calls = 0;
  const service = createCodexPlanUsageService({
    readRateLimits: async () => {
      calls += 1;
      return { primary: null, secondary: null };
    },
    now: () => now,
  });

  const first = await service.getPlanUsage();
  assert.equal(first.available, false);
  assert.equal(first.fiveHour, null);
  await service.getPlanUsage();
  assert.equal(calls, 1);
  now += 11_000;
  await service.getPlanUsage({ refresh: true });
  assert.equal(calls, 2);
});

test('Codex plan usage uses window durations when the server changes their order', async () => {
  const service = createCodexPlanUsageService({
    readRateLimits: async () => ({ primary: snapshot.secondary, secondary: snapshot.primary }),
    now: () => 1_000_000,
  });

  const usage = await service.getPlanUsage();
  assert.equal(usage.fiveHour?.utilization, 42);
  assert.equal(usage.sevenDay?.utilization, 17);
});
