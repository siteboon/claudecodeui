import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderQuotaCache } from '../utils.js';

test('provider quota cache keeps a newer forced refresh when an older read finishes last', async () => {
  const cache = createProviderQuotaCache<string>(120_000);
  let resolveOlder!: (value: string) => void;
  let resolveNewer!: (value: string) => void;
  const olderValue = new Promise<string>((resolve) => { resolveOlder = resolve; });
  const newerValue = new Promise<string>((resolve) => { resolveNewer = resolve; });

  const olderRead = cache.get({}, () => olderValue, () => 1_000);
  const newerRead = cache.get({ forceRefresh: true }, () => newerValue, () => 1_000);

  resolveNewer('newer');
  assert.equal(await newerRead, 'newer');
  resolveOlder('older');
  assert.equal(await olderRead, 'older');

  let fallbackLoads = 0;
  const cachedValue = await cache.get(
    {},
    async () => {
      fallbackLoads += 1;
      return 'unexpected';
    },
    () => 1_001,
  );
  assert.equal(cachedValue, 'newer');
  assert.equal(fallbackLoads, 0);
});

test('provider quota cache propagates loader failures and caches successful null reads', async () => {
  const cache = createProviderQuotaCache<string>(120_000);
  await assert.rejects(
    () => cache.get({}, async () => { throw new Error('unavailable'); }, () => 1_000),
    /unavailable/,
  );

  let nullLoads = 0;
  assert.equal(await cache.get({}, async () => {
    nullLoads += 1;
    return null;
  }, () => 2_000), null);
  assert.equal(await cache.get({}, async () => {
    nullLoads += 1;
    return 'unexpected';
  }, () => 2_001), null);
  assert.equal(nullLoads, 1);
});
