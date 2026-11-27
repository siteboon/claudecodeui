import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '@/modules/plugins/plugin-registry.service.js';

const base = { name: 'demo', displayName: 'Demo', entry: 'dist/index.js' };

test('toolRenderers accepts exact tool names and trailing-star prefixes', () => {
  assert.deepEqual(validateManifest({ ...base, toolRenderers: ['mcp__demo__run', 'mcp__demo__*'] }), { valid: true });
  assert.deepEqual(validateManifest(base), { valid: true });
});

test('toolRenderers rejects anything else', () => {
  for (const toolRenderers of ['mcp__demo__*', [42], ['*'], ['mcp__*__x'], ['a b'], new Array(51).fill('x')]) {
    assert.equal(validateManifest({ ...base, toolRenderers }).valid, false, JSON.stringify(toolRenderers).slice(0, 40));
  }
});
