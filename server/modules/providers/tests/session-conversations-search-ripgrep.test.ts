import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createFakeRipgrepExecutable,
  readRipgrepSearchPatterns,
  withSearchFixture,
} from '@/modules/providers/tests/session-conversations-search-ripgrep.fixture.js';

// @vscode/ripgrep 1.18+ exports `rgPath` but throws while evaluating it when npm
// installed no `@vscode/ripgrep-<platform>-<arch>` package, and none is published
// for android-arm64 (Termux). Resolve the package to a module that fails the
// same way before the search service is first loaded, so this whole file runs
// on a machine without a bundled ripgrep binary.
const MISSING_PLATFORM_PACKAGE_MESSAGE = 'Could not find @vscode/ripgrep-android-arm64. '
  + 'Ensure optionalDependencies are installed for this platform (android-arm64).';
const throwingRipgrepModuleUrl = `data:text/javascript,${encodeURIComponent(
  `export const rgPath = (() => { throw new Error(${JSON.stringify(MISSING_PLATFORM_PACKAGE_MESSAGE)}); })();`,
)}`;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@vscode/ripgrep') {
    return { shortCircuit: true, url: ${JSON.stringify(throwingRipgrepModuleUrl)} };
  }
  return nextResolve(specifier, context);
}
`)}`);

const loadSearchService = () => import('@/modules/providers/services/session-conversations-search.service.js');

test('search service loads when @vscode/ripgrep throws at import for a missing platform package', async () => {
  await assert.rejects(import('@vscode/ripgrep'), { message: MISSING_PLATFORM_PACKAGE_MESSAGE });

  const searchService = await loadSearchService();

  assert.equal(typeof searchService.searchConversations, 'function');
  assert.equal(await searchService.resolveRipgrepCommand(), 'rg');
});

test('resolveRipgrepCommand keeps the bundled binary only when it exists on disk', async () => {
  const { resolveRipgrepCommand } = await loadSearchService();
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'conversation-search-rgpath-'));

  try {
    const bundledBinary = path.join(tempDirectory, 'rg');
    await writeFile(bundledBinary, '');

    assert.equal(await resolveRipgrepCommand(async () => ({ rgPath: bundledBinary })), bundledBinary);
    // 1.17.x still exports bin/rg when its postinstall download never produced one.
    assert.equal(
      await resolveRipgrepCommand(async () => ({ rgPath: path.join(tempDirectory, 'missing', 'rg') })),
      'rg',
    );
    assert.equal(
      await resolveRipgrepCommand(async () => {
        throw new Error(MISSING_PLATFORM_PACKAGE_MESSAGE);
      }),
      'rg',
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('conversation search uses rg from PATH when no bundled binary is available', async () => {
  const { searchConversations } = await loadSearchService();

  await withSearchFixture(async ({ binDir, tempDirectory }) => {
    const invocationLogPath = path.join(tempDirectory, 'rg-invocations.log');
    await createFakeRipgrepExecutable(binDir, invocationLogPath);

    const result = await searchConversations('release planning');

    assert.equal(result.totalMatches, 1);
    assert.deepEqual(
      result.results.flatMap((project) => project.sessions.map((session) => session.sessionId)),
      ['transcript-session'],
    );
    // One PATH `rg` pass per query word, as with the bundled binary.
    assert.deepEqual(await readRipgrepSearchPatterns(invocationLogPath), ['release', 'planning']);
  });
});

test('conversation search fails with an actionable error when rg is not on PATH either', async () => {
  const { searchConversations } = await loadSearchService();

  await withSearchFixture(async () => {
    const titleResultBatches: Array<Array<{ sessionId: string }>> = [];

    await assert.rejects(
      searchConversations('release planning', 50, null, null, (titleResults) => {
        titleResultBatches.push(titleResults);
      }),
      (error: Error) => {
        // Also reached on supported platforms whose bundled binary was never
        // installed, so the message must not claim the platform has no build.
        const platformLabel = `${process.platform}-${process.arch}`;
        assert.match(
          error.message,
          new RegExp(`@vscode/ripgrep could not provide a ripgrep binary for ${platformLabel} `),
        );
        assert.match(error.message, /no `rg` executable was found on PATH/);
        assert.match(error.message, /pkg install ripgrep/);
        assert.equal((error.cause as NodeJS.ErrnoException | undefined)?.code, 'ENOENT');
        return true;
      },
    );
    // Title matches come from the database, so they still reach the client.
    assert.deepEqual(
      titleResultBatches.map((batch) => batch.map((titleResult) => titleResult.sessionId)),
      [['transcript-session']],
    );
  });
});
