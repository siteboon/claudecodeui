import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('invalid runtime profiles fail startup before opening the server or applying the database schema', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'invalid-profile-startup-'));
  const appRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const databasePath = path.join(root, 'auth.db');

  try {
    const result = spawnSync(process.execPath, [
      path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      '--tsconfig', path.join(appRoot, 'server', 'tsconfig.json'),
      path.join(appRoot, 'server', 'index.ts'),
    ], {
      cwd: appRoot,
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        XDG_CONFIG_HOME: path.join(root, '.config'),
        DATABASE_PATH: databasePath,
        CLOUDCLI_RUNTIME_PROFILES: '{invalid-json',
        CLAUDE_CONFIG_DIR: path.join(root, '.claude'),
        CODEX_HOME: path.join(root, '.codex'),
        VITE_IS_PLATFORM: 'false',
        HOST: '127.0.0.1',
        SERVER_PORT: '0',
      },
      encoding: 'utf8',
      timeout: 20_000,
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Failed to start server/);
    assert.match(result.stderr, /INVALID_RUNTIME_PROFILES_CONFIGURATION/);
    assert.doesNotMatch(result.stdout, /CloudCLI Server - Ready/);
    assert.doesNotMatch(result.stdout, /Database schema applied|Database migrations completed successfully/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
