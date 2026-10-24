import assert from 'node:assert/strict';
import test from 'node:test';

import { createClaudePlanUsageService } from '@/modules/providers/services/claude-plan-usage.service.js';

/**
 * Plan usage is read from a short-lived CLI process that is sent no prompt.
 * These script the SDK query to check the mapping, the cache, and that the
 * process is always let go.
 */

const RAW = {
  subscription_type: 'pro',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 69, resets_at: '2026-10-24T13:19:59+00:00' },
    seven_day: { utilization: 27, resets_at: '2026-10-29T17:59:59+00:00' },
  },
};

function harness(raw: unknown = RAW) {
  let clock = 1_000_000;
  const calls: Array<Record<string, unknown>> = [];
  let released = 0;
  const service = createClaudePlanUsageService({
    now: () => clock,
    createQuery: ({ prompt, options }) => {
      calls.push(options);
      void (async () => {
        for await (const _message of prompt) { /* nothing is ever sent */ }
        released += 1;
      })();
      return Object.assign((async function* () { /* no messages */ })(), {
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => raw as never,
      });
    },
  });
  return { service, calls, released: () => released, advance: (ms: number) => { clock += ms; } };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 10); });

test('plan usage maps the 5-hour and weekly windows and lets the process go', async () => {
  const { service, calls, released } = harness();
  const usage = await service.getPlanUsage();

  assert.equal(usage.available, true);
  assert.equal(usage.subscriptionType, 'pro');
  assert.deepEqual(usage.fiveHour, { utilization: 69, resetsAt: '2026-10-24T13:19:59+00:00' });
  assert.deepEqual(usage.sevenDay, { utilization: 27, resetsAt: '2026-10-29T17:59:59+00:00' });
  assert.equal(calls.length, 1);
  await settle();
  assert.equal(released(), 1, 'stdin is closed so the CLI exits');
});

test('plan usage is cached for a minute, and a refresh reuses only a very fresh read', async () => {
  const { service, calls, advance } = harness();
  await service.getPlanUsage();
  advance(30_000);
  await service.getPlanUsage();
  assert.equal(calls.length, 1, 'within the minute');

  await service.getPlanUsage({ refresh: true });
  assert.equal(calls.length, 2, 'a refresh after 10 s reads again');
  advance(2_000);
  await service.getPlanUsage({ refresh: true });
  assert.equal(calls.length, 2, 'repeated clicks do not start a process each');

  advance(61_000);
  await service.getPlanUsage();
  assert.equal(calls.length, 3, 'after the minute');
});

test('a login without plan limits reports unavailable', async () => {
  const { service } = harness({ subscription_type: null, rate_limits_available: false, rate_limits: null });
  const usage = await service.getPlanUsage();
  assert.equal(usage.available, false);
  assert.equal(usage.fiveHour, null);
});
