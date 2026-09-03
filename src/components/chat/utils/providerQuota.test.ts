import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProviderQuotaUrl, resolveQuotaProvider } from './providerQuota';

test('resolveQuotaProvider enables only providers with account quota adapters', () => {
  assert.equal(resolveQuotaProvider('antigravity'), 'antigravity');
  assert.equal(resolveQuotaProvider('codex'), 'codex');
  assert.equal(resolveQuotaProvider('claude'), null);
  assert.equal(resolveQuotaProvider(undefined), null);
});

test('buildProviderQuotaUrl addresses the active provider and optional refresh', () => {
  assert.equal(buildProviderQuotaUrl('codex'), '/api/providers/quota?provider=codex');
  assert.equal(
    buildProviderQuotaUrl('antigravity', true),
    '/api/providers/quota?provider=antigravity&refresh=true',
  );
});
