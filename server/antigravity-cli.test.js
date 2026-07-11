import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveAntigravityPermissionArgs, spawnAntigravity } from './antigravity-cli.js';

const findEnvKey = (name) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

async function createFakeAntigravityExecutable(binDir) {
  const scriptPath = path.join(binDir, 'agy.js');
  await writeFile(scriptPath, `
const fs = require('node:fs');
const capturePath = process.env.AGY_ARGS_CAPTURE;
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify({
    args: process.argv.slice(2),
    cwd: process.cwd(),
  }));
}
console.log('assistant response');
`, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'agy.cmd');
    await writeFile(commandPath, '@echo off\r\nnode "%~dp0agy.js" %*\r\n', 'utf8');
    return;
  }

  const commandPath = path.join(binDir, 'agy');
  await writeFile(commandPath, '#!/bin/sh\nnode "$(dirname "$0")/agy.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

test('resolveAntigravityPermissionArgs maps UI permission modes onto agy controls', () => {
  assert.deepEqual(resolveAntigravityPermissionArgs('plan'), ['--mode', 'plan']);
  assert.deepEqual(resolveAntigravityPermissionArgs('acceptEdits'), ['--mode', 'accept-edits']);
  assert.deepEqual(resolveAntigravityPermissionArgs('bypassPermissions'), ['--dangerously-skip-permissions']);
  assert.deepEqual(resolveAntigravityPermissionArgs('default'), []);
  assert.deepEqual(resolveAntigravityPermissionArgs(undefined), []);
});

test('spawnAntigravity uses app session id as conversation id for new sessions', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-cli-live-'));
  const argsCapturePath = path.join(tempRoot, 'agy-args.json');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousArgsCapture = process.env.AGY_ARGS_CAPTURE;
  const messages = [];
  const writer = {
    userId: null,
    sessionId: null,
    send(message) {
      messages.push(message);
    },
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    },
  };

  try {
    await createFakeAntigravityExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    process.env.AGY_ARGS_CAPTURE = argsCapturePath;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    await spawnAntigravity('Hi', {
      cwd: tempRoot,
      appSessionId: 'app-session-1',
      permissionMode: 'acceptEdits',
    }, writer);

    const sessionCreated = messages.find((message) => message.kind === 'session_created');
    const assistantDelta = messages.find((message) =>
      message.kind === 'stream_delta' && message.content === 'assistant response',
    );
    const complete = messages.find((message) => message.kind === 'complete');

    assert.equal(writer.sessionId, 'app-session-1');
    assert.equal(sessionCreated?.newSessionId, 'app-session-1');
    assert.equal(assistantDelta?.sessionId, 'app-session-1');
    assert.equal(complete?.sessionId, 'app-session-1');
    assert.equal(messages.some((message) => message.kind === 'error'), false);

    const capture = JSON.parse(await readFile(argsCapturePath, 'utf8'));
    assert.deepEqual(capture.args.slice(0, 3), ['--print', '--conversation', 'app-session-1']);
    assert.ok(capture.args.includes('--mode'));
    assert.ok(capture.args.includes('accept-edits'));
    assert.equal(capture.args[capture.args.length - 1], 'Hi');
    assert.equal(capture.cwd, tempRoot);
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

    if (previousArgsCapture === undefined) {
      delete process.env.AGY_ARGS_CAPTURE;
    } else {
      process.env.AGY_ARGS_CAPTURE = previousArgsCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});
