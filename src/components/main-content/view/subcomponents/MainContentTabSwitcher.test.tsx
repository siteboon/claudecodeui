import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./MainContentTabSwitcher.tsx', import.meta.url));

test('main content tab switcher does not expose the web shell tab', () => {
  const source = readFileSync(sourcePath, 'utf8');

  assert.doesNotMatch(source, /id:\s*'shell'|tabs\.shell|Terminal/);
});
