import assert from 'node:assert/strict';
import fs, { mkdtempSync, rmSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, mock } from 'node:test';

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

// The service checks that the bundled binary exists once per lookup; spy for the
// whole process so the count covers every search in this file, in any order.
const existsSyncSpy = mock.method(fs, 'existsSync');
const countBundledRipgrepLookups = () =>
  existsSyncSpy.mock.calls.filter((call) => call.arguments[0] === bundledRipgrepPath).length;

before(() => createFakeRipgrepExecutable(bundledRipgrepDirectory, bundledRipgrepLogPath));
after(() => {
  mock.restoreAll();
  rmSync(bundledRipgrepDirectory, { recursive: true, force: true });
});

const loadSearchService = () => import('@/modules/providers/services/session-conversations-search.service.js');

// First in the file, so these concurrent searches make the process's first
// lookup. An `rg` is on PATH too, so that lookup has to choose between them.
test('conversation search looks up the ripgrep binary once per process, even for concurrent searches', async () => {
  const { searchConversations } = await loadSearchService();

  await withSearchFixture(async ({ binDir, tempDirectory }) => {
    const pathRipgrepLogPath = path.join(tempDirectory, 'path-rg-invocations.log');
    await createFakeRipgrepExecutable(binDir, pathRipgrepLogPath);

    const results = await Promise.all([
      searchConversations('release planning'),
      searchConversations('planning'),
    ]);

    assert.deepEqual(results.map((result) => result.totalMatches), [1, 1]);
    // Three ripgrep runs (one per query word) and any from other tests share
    // a single lookup.
    assert.equal(countBundledRipgrepLookups(), 1);
    assert.equal((await readRipgrepSearchPatterns(bundledRipgrepLogPath)).length, 3);
    assert.deepEqual(await readRipgrepSearchPatterns(pathRipgrepLogPath), []);
  });
});

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

test('an ENOENT from the bundled binary is not reported as a missing rg on PATH', async () => {
  const { searchConversations } = await loadSearchService();

  await withSearchFixture(async ({ binDir, tempDirectory }) => {
    const pathRipgrepLogPath = path.join(tempDirectory, 'path-rg-invocations.log');
    await createFakeRipgrepExecutable(binDir, pathRipgrepLogPath);
    // The first search settles the lookup on the bundled binary; it then
    // disappears, e.g. node_modules is reinstalled under a running server.
    assert.equal((await searchConversations('release')).totalMatches, 1);
    const movedBundledRipgrepPath = `${bundledRipgrepPath}.moved`;
    await rename(bundledRipgrepPath, movedBundledRipgrepPath);

    try {
      await assert.rejects(searchConversations('release'), (error: NodeJS.ErrnoException) => {
        assert.equal(error.code, 'ENOENT');
        assert.doesNotMatch(error.message, /no `rg` executable was found on PATH/);
        return true;
      });
      assert.deepEqual(await readRipgrepSearchPatterns(pathRipgrepLogPath), []);
    } finally {
      await rename(movedBundledRipgrepPath, bundledRipgrepPath);
    }
  });
});
