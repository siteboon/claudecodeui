import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import spawn from 'cross-spawn';
import express from 'express';

import { createGitRouter } from '@/modules/git/git.routes.js';

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
};

/**
 * Runs the real `/diff` route against a real repository, so the whole chain the
 * Changes tab uses is exercised: the route resolves the file, shells out to
 * `git diff`, and shapes the text the diff viewer renders.
 */
async function fetchFileDiff(repoPath: string, file: string): Promise<{ diff: string }> {
  const unexpectedProvider = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  const router = createGitRouter({
    fileSystem: fs,
    spawnProcess: spawn,
    resolveProjectPathById: () => repoPath,
    queryClaude: unexpectedProvider,
    queryCursor: unexpectedProvider,
  });
  const app = express().use(express.json()).use('/api/git', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/git/diff?project=project-1&file=${encodeURIComponent(file)}`,
    );
    assert.equal(response.status, 200);
    return await response.json() as { diff: string };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Regression guard: the Changes tab dropped every hunk line whose own content
 * starts with `--` or `++`, because the header filter matched those content
 * lines (git prefixes a deletion with `-` and an addition with `+`, so YAML
 * `---` separators, SQL `--` comments and `++i` become `---`/`+++` lines) and
 * the filter ran on hunk lines too, not only on the file header.
 */
test('GET /diff keeps hunk lines whose own content starts with --- or +++', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-git-diff-'));
  try {
    git(repoPath, 'init', '-q');
    git(repoPath, 'config', 'core.autocrlf', 'false');
    git(repoPath, 'config', 'user.email', 'diff-test@example.test');
    git(repoPath, 'config', 'user.name', 'Diff Test');
    await fs.writeFile(path.join(repoPath, 'q.sql'), '-- old comment\nSELECT 1;\nint i = 0;\n');
    git(repoPath, 'add', '.');
    git(repoPath, 'commit', '-q', '-m', 'init');
    await fs.writeFile(path.join(repoPath, 'q.sql'), '++i;\nSELECT 2;\nint i = 1;\n');

    const { diff } = await fetchFileDiff(repoPath, 'q.sql');

    // The two colliding content lines: a deleted `-- old comment` and an added
    // `++i;`, which git emits as a `--- …` and a `+++…` line inside the hunk.
    // (Line numbers: 0 `@@`, 1 `-`, 2 `-`, 3 `-`, 4 `+`, 5 `+`, 6 `+`.)
    assert.equal(diff, [
      '@@ -1,3 +1,3 @@',
      '--- old comment',
      '-SELECT 1;',
      '-int i = 0;',
      '+++i;',
      '+SELECT 2;',
      '+int i = 1;',
      '',
    ].join('\n'));
    // No file header survives: the viewer draws hunks, and the panel already
    // knows which file this diff belongs to.
    assert.equal(/^diff --git /m.test(diff), false);
    assert.equal(/^--- a\//m.test(diff), false);
    assert.equal(/^\+\+\+ b\//m.test(diff), false);
  } finally {
    await new Promise<void>((resolve) => {
      const cleanup = async () => {
        await fs.rm(repoPath, { recursive: true, force: true });
        resolve();
      };
      void cleanup();
    });
  }
});
