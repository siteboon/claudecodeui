import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AntigravityProviderAuth } from '@/modules/providers/list/antigravity/antigravity-auth.provider.js';

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

async function createFakeAntigravityExecutable(binDir: string) {
  const scriptPath = path.join(binDir, 'agy.js');
  await writeFile(scriptPath, `
const fs = require('node:fs');
const command = process.argv[2];
if (command === '--version') {
  console.log('1.2.3');
  process.exit(0);
}
if (command === 'models') {
  const statePath = ${JSON.stringify(path.join(binDir, 'model-probe.json'))};
  const state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
    : { stdout: 'gemini-test\\tGemini Test Model\\n', exitCode: 0 };
  if (state.stdout) process.stdout.write(state.stdout);
  if (state.stderr) process.stderr.write(state.stderr);
  process.exit(state.exitCode);
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

test('Antigravity auth uses AGY_CLI_PATH for installation and model probes', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-auth-'));
  const binDir = path.join(tempRoot, 'bin');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousNpmPrefix = process.env.npm_config_prefix;
  const previousAgyCliPath = process.env.AGY_CLI_PATH;

  try {
    await mkdir(binDir);
    await createFakeAntigravityExecutable(binDir);

    process.env[pathKey] = '/usr/bin';
    process.env.AGY_CLI_PATH = path.join(binDir, process.platform === 'win32' ? 'agy.cmd' : 'agy');
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

    if (previousAgyCliPath === undefined) {
      delete process.env.AGY_CLI_PATH;
    } else {
      process.env.AGY_CLI_PATH = previousAgyCliPath;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity auth recovers from eligibility failures and rejects an empty model probe', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-eligibility-'));
  const previousPath = process.env.AGY_CLI_PATH;

  try {
    await createFakeAntigravityExecutable(tempRoot);
    process.env.AGY_CLI_PATH = path.join(tempRoot, process.platform === 'win32' ? 'agy.cmd' : 'agy');
    const statePath = path.join(tempRoot, 'model-probe.json');
    const adapter = new AntigravityProviderAuth();
    for (const probe of [
      { stdout: '', stderr: 'Account ineligible: Your current account is not eligible for Antigravity.', exitCode: 1 },
      { stdout: 'Account ineligible: Verify your account.', stderr: '', exitCode: 0 },
    ]) {
      await writeFile(statePath, JSON.stringify(probe), 'utf8');
      const status = await adapter.getStatus();
      assert.equal(status.installed, true);
      assert.equal(status.authenticated, false);
      assert.match(status.error!, /account is not eligible/i);
    }

    await writeFile(statePath, JSON.stringify({ stdout: '', exitCode: 0 }), 'utf8');
    assert.equal((await adapter.getStatus()).authenticated, false);

    await writeFile(statePath, JSON.stringify({
      stdout: 'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n', exitCode: 0,
    }), 'utf8');
    const recovered = await adapter.getStatus();
    assert.equal(recovered.authenticated, true);
    assert.equal(recovered.method, 'agy');
    assert.equal(recovered.error, undefined);
  } finally {
    if (previousPath === undefined) delete process.env.AGY_CLI_PATH;
    else process.env.AGY_CLI_PATH = previousPath;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
