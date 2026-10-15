import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CursorProviderAuth } from '@/modules/providers/list/cursor/cursor-auth.provider.js';
import { cursorRuntime } from '@/modules/providers/list/cursor/cursor-runtime.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';
import type { NormalizedMessage } from '@/shared/types.js';

const sessionsProvider = new CursorSessionsProvider();

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

// One stream-json turn, like `cursor-agent -p ... --output-format stream-json` prints it. The
// arguments are recorded so the test can tell the fake really ran.
const FAKE_CURSOR_AGENT_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(__dirname, 'args.json'), JSON.stringify(process.argv.slice(2)));
const out = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
out({ type: 'system', subtype: 'init', session_id: 'cursor-live-1', model: 'fake', cwd: process.cwd() });
out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'fake cursor reply' }] } });
out({ type: 'result', subtype: 'success', session_id: 'cursor-live-1' });
`;

type RuntimeFixture = {
  homeDir: string;
  projectDir: string;
  messages: NormalizedMessage[];
  writer: { userId: null; send: (message: NormalizedMessage) => void; setSessionId: () => void };
};

/**
 * Runs `body` with HOME in a temp folder and a PATH that has no Cursor CLI, like a systemd
 * service whose PATH lacks the installer's ~/.local/bin (#1514).
 */
async function withServiceLikeEnvironment(body: (fixture: RuntimeFixture) => Promise<void>) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-runtime-test-'));
  const homeDir = path.join(rootDir, 'home');
  const projectDir = path.join(rootDir, 'project');
  const emptyPathDir = path.join(rootDir, 'empty-path');
  await Promise.all([homeDir, projectDir, emptyPathDir].map((dir) => mkdir(dir, { recursive: true })));

  const pathKey = findEnvKey('PATH');
  const savedEnv: Record<string, string | undefined> = {
    [pathKey]: process.env[pathKey],
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    CURSOR_CLI_PATH: process.env.CURSOR_CLI_PATH,
  };
  const messages: NormalizedMessage[] = [];
  try {
    process.env[pathKey] = emptyPathDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.LOCALAPPDATA = path.join(homeDir, 'AppData', 'Local');
    delete process.env.CURSOR_CLI_PATH;
    await body({
      homeDir,
      projectDir,
      messages,
      writer: { userId: null, send: (message) => messages.push(message), setSessionId: () => undefined },
    });
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(rootDir, { recursive: true, force: true });
  }
}

// The real install check, as the provider runtime service wires it: the chat error text depends on it.
const cursorAuth = new CursorProviderAuth();
const runtimeContext = {
  resolveProviderSessionId: () => null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  normalizeMessage: (raw: unknown, sessionId: string | null) => sessionsProvider.normalizeMessage(raw, sessionId),
  isProviderInstalled: async () => (await cursorAuth.getStatus()).installed,
};

const posixOnly = { skip: process.platform === 'win32' ? 'POSIX install layout' : false };

/** Writes the fake CLI as `<binDir>/cursor-agent` (POSIX) and returns that folder. */
async function writeFakeCursorAgent(binDir: string) {
  await mkdir(binDir, { recursive: true });
  const scriptPath = path.join(binDir, 'cursor-agent.cjs');
  await writeFile(scriptPath, FAKE_CURSOR_AGENT_SCRIPT, 'utf8');
  const commandPath = path.join(binDir, 'cursor-agent');
  await writeFile(commandPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, 'utf8');
  await chmod(commandPath, 0o755);
  return binDir;
}

async function assertFakeReplyStreamed(messages: NormalizedMessage[], binDir: string) {
  assert.deepEqual(messages.filter((message) => message.kind === 'error'), []);
  assert.ok(
    messages.some((message) => message.kind === 'stream_delta' && message.content === 'fake cursor reply'),
    JSON.stringify(messages),
  );
  const complete = messages.find((message) => message.kind === 'complete');
  assert.equal(complete?.exitCode, 0);
  const launchedArgs = JSON.parse(await readFile(path.join(binDir, 'args.json'), 'utf8'));
  assert.deepEqual(launchedArgs.slice(0, 2), ['-p', 'say hi']);
}

test('a Cursor chat turn runs the CLI from ~/.local/bin when the server PATH lacks it (#1514)', posixOnly, async () => {
  await withServiceLikeEnvironment(async ({ homeDir, projectDir, messages, writer }) => {
    const binDir = await writeFakeCursorAgent(path.join(homeDir, '.local', 'bin'));

    await cursorRuntime.run('say hi', { cwd: projectDir }, writer, runtimeContext);

    await assertFakeReplyStreamed(messages, binDir);
  });
});

test('a relative CURSOR_CLI_PATH runs the file next to the server, not one in the project folder', posixOnly, async () => {
  await withServiceLikeEnvironment(async ({ homeDir, projectDir, messages, writer }) => {
    // The server runs from `serverDir`; the chat process is spawned in `projectDir`, which has no bin/.
    const serverDir = path.join(homeDir, 'server');
    const binDir = await writeFakeCursorAgent(path.join(serverDir, 'bin'));
    const previousCwd = process.cwd();
    process.chdir(serverDir);
    process.env.CURSOR_CLI_PATH = './bin/cursor-agent';
    try {
      await cursorRuntime.run('say hi', { cwd: projectDir }, writer, runtimeContext);
    } finally {
      process.chdir(previousCwd);
    }

    await assertFakeReplyStreamed(messages, binDir);
  });
});

test('a Cursor chat turn without any Cursor CLI says where it looked and how to point at one', async () => {
  await withServiceLikeEnvironment(async ({ projectDir, messages, writer }) => {
    await assert.rejects(cursorRuntime.run('say hi', { cwd: projectDir }, writer, runtimeContext));

    const errors = messages.filter((message) => message.kind === 'error');
    assert.equal(errors.length, 1);
    assert.match(String(errors[0].content), /^Cursor CLI not found\. Looked for cursor-agent on the server's PATH/);
    assert.match(String(errors[0].content), /CURSOR_CLI_PATH/);
    assert.equal(messages.find((message) => message.kind === 'complete')?.exitCode, 1);
  });
});
