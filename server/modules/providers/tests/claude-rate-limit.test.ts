import assert from 'node:assert/strict';
import test from 'node:test';

import { extractRateLimit } from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * The account's subscription quota rides the same stream as everything else and
 * used to fall into the unknown branch and vanish. These pin the shape that
 * reaches the client, including the two things the SDK's published types do not
 * say: `unifiedWindows` exists, and `utilization` is a fraction.
 *
 * Payload captured from `claude 2.1.272`, `--print --output-format stream-json`.
 */
const CAPTURED_EVENT = {
  type: 'rate_limit_event',
  session_id: 's-1',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: 1789745400,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    overageDisabledReason: 'org_level_disabled',
    isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 0.17, resetsAt: 1789745400 },
      seven_day: { utilization: 0.06, resetsAt: 1790323200 },
    },
  },
};

test('reports every window the event carries, not just the active one', () => {
  const info = extractRateLimit(CAPTURED_EVENT);

  assert.ok(info);
  assert.equal(info.activeWindow, 'five_hour');
  assert.deepEqual(info.windows, [
    { type: 'five_hour', utilization: 0.17, resetsAt: 1789745400 },
    { type: 'seven_day', utilization: 0.06, resetsAt: 1790323200 },
  ]);
});

test('keeps utilization as the fraction the SDK sends', () => {
  const info = extractRateLimit(CAPTURED_EVENT);

  // Not 17. The ×100 belongs to the display, and doing it twice is how a 17%
  // window would read as full.
  assert.equal(info?.windows[0].utilization, 0.17);
});

test('carries the overage state through', () => {
  const info = extractRateLimit(CAPTURED_EVENT);

  assert.deepEqual(info?.overage, {
    status: 'rejected',
    resetsAt: null,
    disabledReason: 'org_level_disabled',
    inUse: false,
  });
});

test('falls back to the flat pair when unifiedWindows is absent', () => {
  // `unifiedWindows` is not in the SDK's `SDKRateLimitInfo`, so a build that
  // drops it must still produce the window it does name.
  const info = extractRateLimit({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed_warning',
      rateLimitType: 'seven_day',
      utilization: 0.83,
      resetsAt: 1790323200,
    },
  });

  assert.equal(info?.status, 'allowed_warning');
  assert.deepEqual(info?.windows, [
    { type: 'seven_day', utilization: 0.83, resetsAt: 1790323200 },
  ]);
});

test('ignores every other frame on the stream', () => {
  assert.equal(extractRateLimit({ type: 'assistant', message: { usage: {} } }), null);
  assert.equal(extractRateLimit({ type: 'rate_limit_event' }), null);
  assert.equal(extractRateLimit({ type: 'result', subtype: 'success' }), null);
});
