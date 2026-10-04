import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import {
  createFakeRipgrepExecutable,
  readRipgrepSearchPatterns,
  withSearchFixture,
} from '@/modules/providers/tests/session-conversations-search-ripgrep.fixture.js';

// A normal install: @vscode/ripgrep resolves to a binary that exists on disk.
// Resolve the package to a module exporting a fake bundled `rg` before the
// search service first loads it, so this whole file runs with that binary. The
// service memoizes its choice per process, which is why the layout without a
// bundled binary lives in session-conversations-search-ripgrep.test.ts.
const bundledRipgrepDirectory = mkdtempSync(path.join(os.tmpdir(), 'conversation-search-bundled-rg-'));
const bundledRipgrepPath = path.join(bundledRipgrepDirectory, process.platform === 'win32' ? 'rg.cmd' : 'rg');
const bundledRipgrepLogPath = path.join(bundledRipgrepDirectory, 'rg-invocations.log');
const bundledRipgrepModuleUrl = `data:text/javascript,${encodeURIComponent(
  `export const rgPath = ${JSON.stringify(bundledRipgrepPath)};`,
)}`;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@vscode/ripgrep') {
    return { shortCircuit: true, url: ${JSON.stringify(bundledRipgrepModuleUrl)} };
  }
  return nextResolve(specifier, context);
}
`)}`);

before(() => createFakeRipgrepExecutable(bundledRipgrepDirectory, bundledRipgrepLogPath));
after(() => rmSync(bundledRipgrepDirectory, { recursive: true, force: true }));

const loadSearchService = () => import('@/modules/providers/services/session-conversations-search.service.js');

test('conversation search spawns the bundled ripgrep binary even when rg is also on PATH', async () => {
  const { searchConversations } = await loadSearchService();

  await withSearchFixture(async ({ binDir, tempDirectory }) => {
    await rm(bundledRipgrepLogPath, { force: true });
    const pathRipgrepLogPath = path.join(tempDirectory, 'path-rg-invocations.log');
    await createFakeRipgrepExecutable(binDir, pathRipgrepLogPath);

    const result = await searchConversations('release planning');

    assert.equal(result.totalMatches, 1);
    assert.deepEqual(await readRipgrepSearchPatterns(bundledRipgrepLogPath), ['release', 'planning']);
    // A system ripgrep is only the fallback for installs without a bundled one.
    assert.deepEqual(await readRipgrepSearchPatterns(pathRipgrepLogPath), []);
  });
});
