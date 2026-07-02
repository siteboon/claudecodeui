import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./CommandPalette.tsx', import.meta.url));

test('command palette does not expose shell navigation', () => {
  const source = readFileSync(sourcePath, 'utf8');

  assert.doesNotMatch(source, /id:\s*'shell'|Go to Shell|shell terminal console/);
});
