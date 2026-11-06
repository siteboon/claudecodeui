import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '../plugin-registry.service.js';

const baseManifest = { name: 'demo', displayName: 'Demo', entry: 'index.js' };

test('a manifest without global assets stays valid', () => {
  assert.deepEqual(validateManifest(baseManifest), { valid: true });
});

test('scripts and styles accept relative paths inside the plugin', () => {
  const result = validateManifest({ ...baseManifest, scripts: ['dist/global.js'], styles: ['theme.css'] });
  assert.deepEqual(result, { valid: true });
});

test('scripts and styles must be arrays of non-empty strings', () => {
  for (const field of ['scripts', 'styles']) {
    for (const value of ['global.js', [42], [''], { path: 'global.js' }]) {
      const result = validateManifest({ ...baseManifest, [field]: value });
      assert.equal(result.valid, false, `${field}: ${JSON.stringify(value)}`);
      assert.match(result.error ?? '', new RegExp(`^${field} must be an array`));
    }
  }
});

test('scripts and styles reject paths that leave the plugin directory', () => {
  for (const field of ['scripts', 'styles']) {
    for (const value of ['../other/global.js', '/etc/passwd', 'dist/../../global.js']) {
      const result = validateManifest({ ...baseManifest, [field]: ['ok.js', value] });
      assert.equal(result.valid, false, `${field}: ${value}`);
      assert.match(result.error ?? '', /relative path without "\.\."/);
    }
  }
});
