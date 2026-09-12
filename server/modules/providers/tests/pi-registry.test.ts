import assert from 'node:assert/strict';
import test from 'node:test';

import { providerRegistry } from '@/modules/providers/provider.registry.js';

test('pi is a registered provider', () => {
  const provider = providerRegistry.resolveProvider('pi');
  assert.equal(provider.id, 'pi');
  assert.equal(providerRegistry.listProviders().length, 5);
});

test('resolveProvider throws for unknown provider', () => {
  assert.throws(() => providerRegistry.resolveProvider('nope'), /Unsupported provider/);
});
