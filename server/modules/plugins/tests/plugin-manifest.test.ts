import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '../plugin-registry.service.js';

/**
 * `alwaysMount` decides whether a third-party bundle is attached to the shell
 * for the whole app session instead of only while its tab is open, so the
 * registry must never infer it — only an explicit boolean opts in.
 */

const baseManifest = {
  name: 'demo',
  displayName: 'Demo',
  entry: 'dist/index.js',
};

test('a manifest without alwaysMount is valid and opts out', () => {
  assert.equal(validateManifest({ ...baseManifest }).valid, true);
});

test('alwaysMount must be a boolean when present', () => {
  for (const value of ['true', 1, null, {}, []]) {
    const result = validateManifest({ ...baseManifest, alwaysMount: value });
    assert.equal(result.valid, false, `accepted ${JSON.stringify(value)}`);
    assert.match(String(result.error), /alwaysMount must be a boolean/);
  }

  for (const value of [true, false]) {
    assert.equal(validateManifest({ ...baseManifest, alwaysMount: value }).valid, true);
  }
});
