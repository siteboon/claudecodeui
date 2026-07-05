import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('SidebarContent follows the resizable sidebar slot width', async () => {
  const source = await readFile(new URL('./SidebarContent.tsx', import.meta.url), 'utf8');

  assert.equal(source.includes('md:w-72'), false);
  assert.equal(source.includes('w-full min-w-0'), true);
});
