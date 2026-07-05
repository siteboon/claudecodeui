import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('shell socket close does not clear terminal output during reconnect', async () => {
  const source = await readFile(new URL('./useShellConnection.ts', import.meta.url), 'utf8');
  const onCloseBlock = source.match(/socket\.onclose = \(\) => \{[\s\S]*?\n\s*\};/)?.[0] ?? '';

  assert.notEqual(onCloseBlock, '');
  assert.equal(onCloseBlock.includes('clearTerminalScreen'), false);
});
