import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPluginsDir,
  installPluginFromGit,
  updatePluginFromGit,
} from '../plugin-registry.service.js';

type ChildProcessLike = EventEmitter & {
  stderr: EventEmitter;
  kill: () => boolean;
};

function createFakeChild(): ChildProcessLike {
  const child = new EventEmitter() as ChildProcessLike;
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}

function uniquePluginName(prefix: string): string {
  return `test-${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function removePlugin(name: string): void {
  fs.rmSync(path.join(getPluginsDir(), name), { recursive: true, force: true });
}

test('installPluginFromGit passes --include=dev to npm install', async () => {
  const pluginName = uniquePluginName('install');
  const npmInstallArgs: string[][] = [];
  const commands: string[] = [];

  try {
    const manifest = {
      name: pluginName,
      displayName: 'Test Plugin',
      entry: 'index.js',
    };

    const spawnProcess = (command: string, args: string[]) => {
      commands.push(command);
      const child = createFakeChild();

      if (command === 'git') {
        const tempDir = args.at(-1)!;
        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));
        fs.writeFileSync(
          path.join(tempDir, 'package.json'),
          JSON.stringify({ name: pluginName, version: '1.0.0' }),
        );
      }

      if (command === 'npm') {
        npmInstallArgs.push(args);
      }

      queueMicrotask(() => child.emit('close', 0));
      return child;
    };

    await installPluginFromGit(
      `https://example.test/${pluginName}.git`,
      spawnProcess,
    );

    assert.deepEqual(npmInstallArgs, [
      ['install', '--ignore-scripts', '--include=dev'],
    ]);
    assert.deepEqual(commands, ['git', 'npm']);
  } finally {
    removePlugin(pluginName);
  }
});

test('updatePluginFromGit passes --include=dev to npm install', async () => {
  const pluginName = uniquePluginName('update');
  const pluginDir = path.join(getPluginsDir(), pluginName);
  const npmInstallArgs: string[][] = [];
  const commands: string[] = [];

  try {
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify({
        name: pluginName,
        displayName: 'Test Plugin',
        entry: 'index.js',
      }),
    );
    fs.writeFileSync(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({ name: pluginName, version: '1.0.0' }),
    );

    const spawnProcess = (command: string, args: string[]) => {
      commands.push(command);
      const child = createFakeChild();

      if (command === 'npm') {
        npmInstallArgs.push(args);
      }

      queueMicrotask(() => child.emit('close', 0));
      return child;
    };

    await updatePluginFromGit(pluginName, spawnProcess);

    assert.deepEqual(npmInstallArgs, [
      ['install', '--ignore-scripts', '--include=dev'],
    ]);
    assert.deepEqual(commands, ['git', 'npm']);
  } finally {
    removePlugin(pluginName);
  }
});
