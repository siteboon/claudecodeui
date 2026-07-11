import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AntigravityProviderAuth } from './antigravity-auth.provider.js';

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

async function createFakeAntigravityExecutable(binDir: string) {
  const scriptPath = path.join(binDir, 'agy.js');
  await writeFile(scriptPath, `
const command = process.argv[2];
if (command === '--version') {
  console.log('1.2.3');
  process.exit(0);
}
if (command === 'models') {
  console.log('Gemini Test Model');
  process.exit(0);
}
process.exit(1);
`, 'utf8');

  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, 'agy.cmd'), '@echo off\r\nnode "%~dp0agy.js" %*\r\n', 'utf8');
    return;
  }

  const commandPath = path.join(binDir, 'agy');
  await writeFile(commandPath, '#!/bin/sh\nnode "$(dirname "$0")/agy.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

test('Antigravity auth finds agy in npm global prefix bin even when PATH omits it', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-auth-'));
  const binDir = path.join(tempRoot, 'bin');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousNpmPrefix = process.env.npm_config_prefix;

  try {
    await mkdir(binDir);
    await createFakeAntigravityExecutable(binDir);

    process.env[pathKey] = '/usr/bin';
    process.env.npm_config_prefix = tempRoot;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    const status = await new AntigravityProviderAuth().getStatus();

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, true);
    assert.equal(status.method, 'agy');
  } finally {
    if (previousPath === undefined) {
      delete process.env[pathKey];
    } else {
      process.env[pathKey] = previousPath;
    }

    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }

    if (previousNpmPrefix === undefined) {
      delete process.env.npm_config_prefix;
    } else {
      process.env.npm_config_prefix = previousNpmPrefix;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});
