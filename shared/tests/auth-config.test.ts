import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAuthMode } from '../authConfig.js';

test('build and runtime share the same canonical auth flag', () => {
  assert.deepEqual(resolveAuthMode({}), {
    isPlatform: false, disableAuth: false, trustLocalAuthBypass: false,
  });
  for (const flags of [
    { DISABLE_AUTH: 'true' },
    { VITE_DISABLE_AUTH: 'true' },
    { DISABLE_AUTH: 'true', VITE_DISABLE_AUTH: 'true' },
  ]) {
    assert.deepEqual(resolveAuthMode(flags), {
      isPlatform: false, disableAuth: true, trustLocalAuthBypass: true,
    });
  }
  assert.deepEqual(resolveAuthMode({ DISABLE_AUTH: 'false', VITE_DISABLE_AUTH: 'false' }), {
    isPlatform: false, disableAuth: false, trustLocalAuthBypass: false,
  });
  assert.deepEqual(resolveAuthMode({ VITE_IS_PLATFORM: 'true', DISABLE_AUTH: 'false' }), {
    isPlatform: true, disableAuth: false, trustLocalAuthBypass: true,
  });
});

test('conflicting or invalid auth flags are rejected', () => {
  for (const flags of [
    { DISABLE_AUTH: 'true', VITE_DISABLE_AUTH: 'false' },
    { DISABLE_AUTH: 'false', VITE_DISABLE_AUTH: 'true' },
  ]) {
    assert.throws(() => resolveAuthMode(flags), /must match/);
  }
  assert.throws(() => resolveAuthMode({ DISABLE_AUTH: 'yes' }), /must be true or false/);
  assert.throws(() => resolveAuthMode({ VITE_DISABLE_AUTH: '1' }), /must be true or false/);
});
