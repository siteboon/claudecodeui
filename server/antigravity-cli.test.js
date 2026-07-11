import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const conversationsDir = process.env.ANTIGRAVITY_CONVERSATIONS_DIR;
const fakeConversationId = process.env.AGY_FAKE_CONVERSATION_ID;
if (conversationsDir && fakeConversationId) {
  fs.mkdirSync(conversationsDir, { recursive: true });
  fs.writeFileSync(require('node:path').join(conversationsDir, fakeConversationId + '.db'), '');
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

test('spawnAntigravity starts new sessions without passing app id as agy conversation id', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-cli-live-'));
  const binDir = path.join(tempRoot, 'bin');
  const conversationsDir = path.join(tempRoot, 'conversations');
  const argsCapturePath = path.join(tempRoot, 'agy-args.json');
  const fakeConversationId = 'agy-native-session-1';
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousArgsCapture = process.env.AGY_ARGS_CAPTURE;
  const previousNpmPrefix = process.env.npm_config_prefix;
  const previousConversationsDir = process.env.ANTIGRAVITY_CONVERSATIONS_DIR;
  const previousFakeConversationId = process.env.AGY_FAKE_CONVERSATION_ID;
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
    await mkdir(binDir);
    await createFakeAntigravityExecutable(binDir);
    process.env[pathKey] = `${binDir}${path.delimiter}${previousPath || ''}`;
    process.env.npm_config_prefix = tempRoot;
    process.env.AGY_ARGS_CAPTURE = argsCapturePath;
    process.env.ANTIGRAVITY_CONVERSATIONS_DIR = conversationsDir;
    process.env.AGY_FAKE_CONVERSATION_ID = fakeConversationId;
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

    assert.equal(writer.sessionId, fakeConversationId);
    assert.equal(sessionCreated?.newSessionId, fakeConversationId);
    assert.equal(assistantDelta?.sessionId, fakeConversationId);
    assert.equal(complete?.sessionId, fakeConversationId);
    assert.equal(messages.some((message) => message.kind === 'error'), false);

    const capture = JSON.parse(await readFile(argsCapturePath, 'utf8'));
    assert.equal(capture.args.includes('--conversation'), false);
    assert.ok(capture.args.includes('--mode'));
    assert.ok(capture.args.includes('accept-edits'));
    assert.deepEqual(capture.args.slice(-2), ['--print', 'Hi']);
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

    if (previousNpmPrefix === undefined) {
      delete process.env.npm_config_prefix;
    } else {
      process.env.npm_config_prefix = previousNpmPrefix;
    }

    if (previousConversationsDir === undefined) {
      delete process.env.ANTIGRAVITY_CONVERSATIONS_DIR;
    } else {
      process.env.ANTIGRAVITY_CONVERSATIONS_DIR = previousConversationsDir;
    }

    if (previousFakeConversationId === undefined) {
      delete process.env.AGY_FAKE_CONVERSATION_ID;
    } else {
      process.env.AGY_FAKE_CONVERSATION_ID = previousFakeConversationId;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('spawnAntigravity resumes existing provider conversation ids with --conversation', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'antigravity-cli-resume-'));
  const binDir = path.join(tempRoot, 'bin');
  const conversationsDir = path.join(tempRoot, 'conversations');
  const argsCapturePath = path.join(tempRoot, 'agy-args.json');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousArgsCapture = process.env.AGY_ARGS_CAPTURE;
  const previousNpmPrefix = process.env.npm_config_prefix;
  const previousConversationsDir = process.env.ANTIGRAVITY_CONVERSATIONS_DIR;
  const previousFakeConversationId = process.env.AGY_FAKE_CONVERSATION_ID;
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
    await mkdir(binDir);
    await createFakeAntigravityExecutable(binDir);
    process.env[pathKey] = `${binDir}${path.delimiter}${previousPath || ''}`;
    process.env.npm_config_prefix = tempRoot;
    process.env.AGY_ARGS_CAPTURE = argsCapturePath;
    process.env.ANTIGRAVITY_CONVERSATIONS_DIR = conversationsDir;
    delete process.env.AGY_FAKE_CONVERSATION_ID;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    await spawnAntigravity('Continue', {
      cwd: tempRoot,
      appSessionId: 'app-session-1',
      sessionId: 'agy-existing-session',
    }, writer);

    const capture = JSON.parse(await readFile(argsCapturePath, 'utf8'));
    const conversationIndex = capture.args.indexOf('--conversation');

    assert.notEqual(conversationIndex, -1);
    assert.equal(capture.args[conversationIndex + 1], 'agy-existing-session');
    assert.deepEqual(capture.args.slice(-2), ['--print', 'Continue']);
    assert.equal(writer.sessionId, 'agy-existing-session');
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

    if (previousNpmPrefix === undefined) {
      delete process.env.npm_config_prefix;
    } else {
      process.env.npm_config_prefix = previousNpmPrefix;
    }

    if (previousConversationsDir === undefined) {
      delete process.env.ANTIGRAVITY_CONVERSATIONS_DIR;
    } else {
      process.env.ANTIGRAVITY_CONVERSATIONS_DIR = previousConversationsDir;
    }

    if (previousFakeConversationId === undefined) {
      delete process.env.AGY_FAKE_CONVERSATION_ID;
    } else {
      process.env.AGY_FAKE_CONVERSATION_ID = previousFakeConversationId;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});
