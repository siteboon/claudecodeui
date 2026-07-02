import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./config.js', import.meta.url));

test('defaults the interface language to Simplified Chinese when no saved language exists', () => {
  const source = readFileSync(sourcePath, 'utf8');

  assert.match(source, /const DEFAULT_LANGUAGE = 'zh-CN';/);
  assert.doesNotMatch(source, /return 'en';\s*\}\s*catch/);
});
