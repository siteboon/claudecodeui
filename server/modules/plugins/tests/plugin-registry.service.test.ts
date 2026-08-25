import assert from 'node:assert/strict';
import test from 'node:test';

import { installPluginFromGit } from '../plugin-registry.service.js';

// Smoke tests for the URL pre-checks in the registry. The end-to-end
// swap-failure path is exercised by integration tests elsewhere because
// injecting a controlled failure of `fs.renameSync` requires an fs mock
// framework that this codebase does not currently depend on.

test('installPluginFromGit rejects file:// URLs', async () => {
  await assert.rejects(
    async () => installPluginFromGit('file:///tmp/local'),
    (error: unknown) => error instanceof Error && /Invalid URL/.test(error.message),
  );
});

test('installPluginFromGit rejects URLs that begin with option prefixes', async () => {
  await assert.rejects(
    async () => installPluginFromGit('--upload-pack=malicious'),
    (error: unknown) => error instanceof Error && /Invalid URL/.test(error.message),
  );
});

test('installPluginFromGit rejects non-HTTPS, non-SSH URLs', async () => {
  await assert.rejects(
    async () => installPluginFromGit('http://example.com/repo.git'),
    (error: unknown) => error instanceof Error && /Invalid URL/.test(error.message),
  );
});
