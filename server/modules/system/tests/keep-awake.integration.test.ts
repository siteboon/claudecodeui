import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

/**
 * Drives the real keepAwakeService singleton from system.module.ts (its PATH
 * lookup, spawn, process-group kill, WSL check and app_config storage), where
 * keep-awake.service.test.ts injects fakes for all of them.
 *
 * The module is imported only once the environment is pinned: IS_PLATFORM is
 * read from VITE_IS_PLATFORM when shared/utils loads, and the database opens
 * DATABASE_PATH on first use. A developer's shell may export either.
 */

type SystemModule = typeof import('../system.module.js');
type DatabaseModule = typeof import('@/modules/database/index.js');

type ProcessEntry = { pid: number; command: string; parentPid: number; groupId: number };

const KEEP_AWAKE_SETTINGS_KEY = 'keep_awake_settings';

// Spawning systemd-inhibit and reading process groups from /proc is Linux-only,
// and the singleton reports WSL as unsupported.
const skipProcessTests = process.platform !== 'linux' || /microsoft/i.test(os.release())
  ? 'needs Linux outside WSL'
  : false;

// Like the real systemd-inhibit: runs the wrapped command as its child, waits for
// it, and does not trap SIGTERM. A helper stopped by pid alone (not by its process
// group) would leave the watchdog shell and its sleep running.
const STUB_SYSTEMD_INHIBIT = `#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    --*) shift ;;
    *) break ;;
  esac
done
"$@"
`;

const savedEnvironment = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  PATH: process.env.PATH,
  VITE_IS_PLATFORM: process.env.VITE_IS_PLATFORM,
};

let tempDirectory = '';
let stubPath = '';
let keepAwakeService: SystemModule['keepAwakeService'];
let appConfigDb: DatabaseModule['appConfigDb'];
let closeConnection: DatabaseModule['closeConnection'] | undefined;

function restoreEnvironmentVariable(name: keyof typeof savedEnvironment): void {
  const value = savedEnvironment[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** Every live (not yet reaped) process, read from /proc. */
function listLiveProcesses(): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) {
      continue;
    }
    let stat: string;
    try {
      stat = readFileSync(`/proc/${name}/stat`, 'utf8');
    } catch {
      continue; // Exited while we were listing.
    }
    // The command sits in parentheses and may contain spaces; the fields after it are fixed.
    const commandEnd = stat.lastIndexOf(')');
    const [state, parentPid, groupId] = stat.slice(commandEnd + 2).split(' ');
    if (state === 'Z') {
      continue; // Already exited, only waiting for its parent to reap it.
    }
    entries.push({
      pid: Number(name),
      command: stat.slice(stat.indexOf('(') + 1, commandEnd),
      parentPid: Number(parentPid),
      groupId: Number(groupId),
    });
  }
  return entries;
}

/** The helper this process spawned plus everything in its process group. */
function findHelperGroup(): ProcessEntry[] {
  const processes = listLiveProcesses();
  const helper = processes.find((entry) => entry.parentPid === process.pid && entry.command === 'systemd-inhibit');
  return helper ? processes.filter((entry) => entry.groupId === helper.pid) : [];
}

function listGroupMembers(groupId: number): ProcessEntry[] {
  return listLiveProcesses().filter((entry) => entry.groupId === groupId);
}

async function waitUntil<T>(read: () => T, isDone: (value: T) => boolean, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = read();
  while (!isDone(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = read();
  }
  return value;
}

/** Turns the setting on with the stub first on PATH and takes one hold. */
function holdWithStub(): () => void {
  process.env.PATH = `${path.dirname(stubPath)}${path.delimiter}${savedEnvironment.PATH ?? ''}`;
  keepAwakeService.setEnabled(true);
  return keepAwakeService.acquire();
}

/** Waits for systemd-inhibit, its watchdog shell and that shell's sleep, and returns their process group. */
async function waitForHelperGroup(): Promise<number> {
  const group = await waitUntil(findHelperGroup, (members) => members.length === 3);
  assert.deepEqual(group.map((member) => member.command).sort(), ['sh', 'sleep', 'systemd-inhibit']);
  return group[0].groupId;
}

/** Last-resort cleanup so a failing assertion never leaves processes behind. */
function cleanUpHold(release: () => void, groupId: number | undefined): void {
  release();
  if (groupId !== undefined) {
    try {
      process.kill(-groupId, 'SIGKILL');
    } catch {
      // Nothing left to kill.
    }
  }
  restoreEnvironmentVariable('PATH');
}

before(async () => {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'keep-awake-integration-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  // An existing file, so the database is never seeded from a legacy install-directory copy.
  await writeFile(databasePath, '');
  process.env.DATABASE_PATH = databasePath;
  delete process.env.VITE_IS_PLATFORM;

  stubPath = path.join(tempDirectory, 'bin', 'systemd-inhibit');
  await mkdir(path.dirname(stubPath));
  await writeFile(stubPath, STUB_SYSTEMD_INHIBIT);
  await chmod(stubPath, 0o755);

  ({ keepAwakeService } = await import('../system.module.js'));
  ({ appConfigDb, closeConnection } = await import('@/modules/database/index.js'));
});

after(async () => {
  keepAwakeService?.shutdown();
  closeConnection?.();
  restoreEnvironmentVariable('DATABASE_PATH');
  restoreEnvironmentVariable('PATH');
  restoreEnvironmentVariable('VITE_IS_PLATFORM');
  await rm(tempDirectory, { recursive: true, force: true });
});

test('only a saved boolean true turns the setting on', () => {
  keepAwakeService.initialize();
  assert.equal(keepAwakeService.getStatus().enabled, false, 'nothing saved yet');

  const savedValues: Array<[string, boolean]> = [
    ['{"enabled":true}', true],
    ['{"enabled":false}', false],
    ['{"enabled":"true"}', false],
    ['{"enabled":1}', false],
    ['{}', false],
    ['true', false],
    ['null', false],
    ['not json', false],
  ];
  for (const [savedValue, expected] of savedValues) {
    appConfigDb.set(KEEP_AWAKE_SETTINGS_KEY, savedValue);
    keepAwakeService.initialize();
    assert.equal(keepAwakeService.getStatus().enabled, expected, savedValue);
  }

  keepAwakeService.setEnabled(true);
  assert.equal(appConfigDb.get(KEEP_AWAKE_SETTINGS_KEY), '{"enabled":true}');
  keepAwakeService.setEnabled(false);
  assert.equal(appConfigDb.get(KEEP_AWAKE_SETTINGS_KEY), '{"enabled":false}');
});

test('Linux support needs an executable systemd-inhibit on PATH and no WSL kernel', { skip: skipProcessTests }, async (t) => {
  const notExecutableDirectory = path.join(tempDirectory, 'not-executable');
  await mkdir(notExecutableDirectory);
  await writeFile(path.join(notExecutableDirectory, 'systemd-inhibit'), STUB_SYSTEMD_INHIBIT, { mode: 0o644 });

  try {
    process.env.PATH = path.join(tempDirectory, 'empty');
    assert.equal(keepAwakeService.getStatus().supported, false, 'not on PATH');

    process.env.PATH = notExecutableDirectory;
    assert.equal(keepAwakeService.getStatus().supported, false, 'on PATH but not executable');

    process.env.PATH = path.dirname(stubPath);
    assert.equal(keepAwakeService.getStatus().supported, true, 'executable on PATH');

    const kernelRelease = t.mock.method(os, 'release', () => '5.15.153.1-microsoft-standard-WSL2');
    assert.equal(keepAwakeService.getStatus().supported, false, 'WSL 2');
    kernelRelease.mock.mockImplementation(() => '4.4.0-19041-Microsoft');
    assert.equal(keepAwakeService.getStatus().supported, false, 'WSL 1');
  } finally {
    restoreEnvironmentVariable('PATH');
  }
});

test('releasing the last hold stops systemd-inhibit together with its watchdog', { skip: skipProcessTests, timeout: 5000 }, async () => {
  const release = holdWithStub();
  let groupId: number | undefined;
  try {
    const helperGroupId = await waitForHelperGroup();
    groupId = helperGroupId;
    release();

    assert.deepEqual(await waitUntil(() => listGroupMembers(helperGroupId), (members) => members.length === 0), []);
  } finally {
    cleanUpHold(release, groupId);
  }
});

// Last: shutdown is final for the singleton.
test('shutdown stops a helper that is still holding the computer awake', { skip: skipProcessTests, timeout: 5000 }, async () => {
  const release = holdWithStub();
  let groupId: number | undefined;
  try {
    const helperGroupId = await waitForHelperGroup();
    groupId = helperGroupId;
    keepAwakeService.shutdown();

    assert.deepEqual(await waitUntil(() => listGroupMembers(helperGroupId), (members) => members.length === 0), []);
  } finally {
    cleanUpHold(release, groupId);
  }
});
