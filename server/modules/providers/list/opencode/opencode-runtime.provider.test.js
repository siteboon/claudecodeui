import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  opencodeRuntime,
  resolveOpenCodePermissionOptions,
} from './opencode-runtime.provider.js';
import { OpenCodeSessionsProvider } from './opencode-sessions.provider.js';

const sessionsProvider = new OpenCodeSessionsProvider();
const runtimeContext = {
  resolveProviderSessionId: (sessionId) => sessionId || null,
  resolveResumeModel: async (_sessionId, requestedModel) => requestedModel || undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  normalizeMessage: (raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId),
  isProviderInstalled: async () => true,
};

const findEnvKey = (name) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

async function createFakeOpenCodeExecutable(binDir) {
  const scriptPath = path.join(binDir, 'opencode.js');
  await writeFile(scriptPath, `
const capturePath = process.env.OPENCODE_ARGS_CAPTURE;
if (capturePath) {
  require('node:fs').writeFileSync(capturePath, JSON.stringify({
    args: process.argv.slice(2),
    permissionEnv: process.env.OPENCODE_PERMISSION ?? null,
  }));
}

const events = [
  { type: 'text', sessionID: 'open-live-1', text: 'assistant response' },
  { type: 'step_finish', sessionID: 'open-live-1' },
];

for (const event of events) {
  console.log(JSON.stringify(event));
}
`, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'opencode.cmd');
    await writeFile(commandPath, '@echo off\r\nnode "%~dp0opencode.js" %*\r\n', 'utf8');
    return;
  }

  const commandPath = path.join(binDir, 'opencode');
  await writeFile(commandPath, '#!/bin/sh\nnode "$(dirname "$0")/opencode.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

test('spawnOpenCode emits session_created before normalized live messages for new sessions', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-live-'));
  const argsCapturePath = path.join(tempRoot, 'opencode-args.json');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousArgsCapture = process.env.OPENCODE_ARGS_CAPTURE;
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
    await createFakeOpenCodeExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    process.env.OPENCODE_ARGS_CAPTURE = argsCapturePath;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    await opencodeRuntime.run('Hi', { cwd: tempRoot }, writer, runtimeContext);

    const sessionCreatedIndex = messages.findIndex((message) => message.kind === 'session_created');
    const assistantDeltaIndex = messages.findIndex((message) =>
      message.kind === 'stream_delta' && message.content === 'assistant response',
    );
    const streamEnd = messages.find((message) => message.kind === 'stream_end');
    const complete = messages.find((message) => message.kind === 'complete');

    assert.notEqual(sessionCreatedIndex, -1);
    assert.notEqual(assistantDeltaIndex, -1);
    assert.ok(sessionCreatedIndex < assistantDeltaIndex);
    assert.equal(messages[sessionCreatedIndex].newSessionId, 'open-live-1');
    assert.equal(writer.sessionId, 'open-live-1');
    assert.equal(streamEnd?.sessionId, 'open-live-1');
    assert.equal(complete?.sessionId, 'open-live-1');
    assert.equal(messages.some((message) => message.kind === 'error'), false);

    const capture = JSON.parse(await readFile(argsCapturePath, 'utf8'));
    const launchedArgs = capture.args;
    assert.ok(Array.isArray(launchedArgs));
    assert.deepEqual(launchedArgs.slice(0, 4), ['run', '--format', 'json', '--dir']);
    assert.equal(launchedArgs[4], tempRoot);
    // No permission mode requested → no permission flags and no env override.
    assert.equal(launchedArgs.includes('--auto'), false);
    assert.equal(launchedArgs.includes('--agent'), false);
    assert.equal(capture.permissionEnv, null);
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
      delete process.env.OPENCODE_ARGS_CAPTURE;
    } else {
      process.env.OPENCODE_ARGS_CAPTURE = previousArgsCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('resolveOpenCodePermissionOptions maps UI permission modes onto OpenCode controls', () => {
  assert.deepEqual(resolveOpenCodePermissionOptions('plan'), {
    args: ['--agent', 'plan'],
    env: {},
  });
  assert.deepEqual(resolveOpenCodePermissionOptions('bypassPermissions'), {
    args: ['--auto'],
    env: {},
  });
  assert.deepEqual(resolveOpenCodePermissionOptions('acceptEdits'), {
    args: [],
    env: { OPENCODE_PERMISSION: '{"edit":"allow"}' },
  });
  // default and anything unknown leave the user's own opencode config in charge.
  assert.deepEqual(resolveOpenCodePermissionOptions('default'), { args: [], env: {} });
  assert.deepEqual(resolveOpenCodePermissionOptions(undefined), { args: [], env: {} });
});

test('spawnOpenCode passes permission mode flags and env to the CLI', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-perms-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousArgsCapture = process.env.OPENCODE_ARGS_CAPTURE;
  const writer = {
    userId: null,
    sessionId: null,
    send() {},
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    },
  };

  try {
    await createFakeOpenCodeExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    const scenarios = [
      {
        permissionMode: 'plan',
        expectArgs: ['--agent', 'plan'],
        expectPermissionEnv: null,
      },
      {
        permissionMode: 'bypassPermissions',
        expectArgs: ['--auto'],
        expectPermissionEnv: null,
      },
      {
        permissionMode: 'acceptEdits',
        expectArgs: [],
        expectPermissionEnv: '{"edit":"allow"}',
      },
    ];

    for (const scenario of scenarios) {
      const argsCapturePath = path.join(tempRoot, `opencode-args-${scenario.permissionMode}.json`);
      process.env.OPENCODE_ARGS_CAPTURE = argsCapturePath;

      await opencodeRuntime.run(
        'Hi',
        { cwd: tempRoot, permissionMode: scenario.permissionMode },
        writer,
        runtimeContext,
      );

      const capture = JSON.parse(await readFile(argsCapturePath, 'utf8'));
      for (const expectedArg of scenario.expectArgs) {
        assert.ok(
          capture.args.includes(expectedArg),
          `${scenario.permissionMode}: expected "${expectedArg}" in ${JSON.stringify(capture.args)}`,
        );
      }
      // The prompt stays the last positional argument, after any permission flags.
      assert.equal(capture.args[capture.args.length - 1], 'Hi');
      assert.equal(capture.permissionEnv, scenario.expectPermissionEnv);
    }
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
      delete process.env.OPENCODE_ARGS_CAPTURE;
    } else {
      process.env.OPENCODE_ARGS_CAPTURE = previousArgsCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});
