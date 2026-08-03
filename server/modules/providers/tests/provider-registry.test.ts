import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PiProvider } from '@/modules/providers/list/pi/pi.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { AppError } from '@/shared/utils.js';

describe('providerRegistry', () => {
  it('throws UNSUPPORTED_PROVIDER for an unregistered provider', () => {
    try {
      providerRegistry.resolveProvider('does-not-exist');
      assert.fail('expected resolveProvider to throw');
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'UNSUPPORTED_PROVIDER');
      assert.equal(error.statusCode, 400);
    }
  });

  it('resolves pi to a PiProvider instance exposing its facets', () => {
    const resolved = providerRegistry.resolveProvider('pi');

    assert.ok(resolved instanceof PiProvider);
    assert.equal(resolved.id, 'pi');
    assert.ok(resolved.runtime);
    assert.ok(resolved.models);
    assert.ok(resolved.mcp);
    assert.ok(resolved.auth);
    assert.ok(resolved.skills);
    assert.ok(resolved.sessions);
    assert.ok(resolved.sessionSynchronizer);
  });
});
