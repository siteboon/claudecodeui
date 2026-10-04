import assert from 'node:assert/strict';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createKeepAwakeService } from '../keep-awake.service.js';

type KeepAwakeDependencies = Parameters<typeof createKeepAwakeService>[0];

type FakeHelper = EventEmitter & {
  pid: number;
  killCount: number;
  unrefCount: number;
  kill: () => boolean;
  unref: () => void;
};

type SpawnCall = { command: string; args: string[]; options: SpawnOptions; helper: FakeHelper };

const SERVER_PID = 4242;

function createHarness(overrides: Partial<KeepAwakeDependencies> = {}, savedEnabled = true) {
  const spawnCalls: SpawnCall[] = [];
  const killedGroups: number[] = [];
  const savedValues: boolean[] = [];
  const warnings: string[] = [];
  let nextPid = 9000;

  const dependencies: KeepAwakeDependencies = {
    platform: 'darwin',
    serverPid: SERVER_PID,
    isPlatform: false,
    commandExists: () => true,
    spawnProcess(command, args, options) {
      const helper = new EventEmitter() as FakeHelper;
      helper.pid = nextPid++;
      helper.killCount = 0;
      helper.unrefCount = 0;
      helper.kill = () => {
        helper.killCount += 1;
        return true;
      };
      helper.unref = () => {
        helper.unrefCount += 1;
      };
      spawnCalls.push({ command, args, options, helper });
      return helper as unknown as ChildProcess;
    },
    killProcessGroup(pid) {
      killedGroups.push(pid);
    },
    readEnabled: () => savedEnabled,
    writeEnabled(enabled) {
      savedValues.push(enabled);
    },
    logInfo: () => undefined,
    logWarn(message) {
      warnings.push(message);
    },
    ...overrides,
  };

  const service = createKeepAwakeService(dependencies);
  return { service, spawnCalls, killedGroups, savedValues, warnings };
}

test('spawns nothing until the saved setting is loaded, and nothing while it is off', () => {
  const beforeInitialize = createHarness();
  beforeInitialize.service.acquire()();
  assert.equal(beforeInitialize.spawnCalls.length, 0);

  const disabled = createHarness({}, false);
  disabled.service.initialize();
  const release = disabled.service.acquire();
  assert.equal(disabled.spawnCalls.length, 0);
  assert.deepEqual(disabled.service.getStatus(), { enabled: false, supported: true, active: false });
  release();
  assert.equal(disabled.spawnCalls.length, 0);
});

test('concurrent runs share one helper that stops when the last run ends', () => {
  const { service, spawnCalls, killedGroups } = createHarness();
  service.initialize();

  const releaseFirst = service.acquire();
  const releaseSecond = service.acquire();
  assert.equal(spawnCalls.length, 1);
  assert.equal(service.getStatus().active, true);

  releaseFirst();
  // Releasing the same hold again must not count as the second run ending.
  releaseFirst();
  assert.deepEqual(killedGroups, []);
  assert.equal(service.getStatus().active, true);

  releaseSecond();
  assert.deepEqual(killedGroups, [spawnCalls[0].helper.pid]);
  assert.equal(service.getStatus().active, false);

  // The next run starts a fresh helper.
  service.acquire();
  assert.equal(spawnCalls.length, 2);
});

test('macOS holds an idle-sleep assertion with caffeinate tied to the server pid', () => {
  const { service, spawnCalls } = createHarness({ platform: 'darwin' });
  service.initialize();
  service.acquire();

  assert.equal(spawnCalls[0].command, 'caffeinate');
  assert.deepEqual(spawnCalls[0].args, ['-i', '-w', String(SERVER_PID)]);
  assert.equal(spawnCalls[0].options.detached, true);
  assert.equal(spawnCalls[0].options.stdio, 'ignore');
  assert.equal(spawnCalls[0].helper.unrefCount, 1);
});

test('Linux inhibits idle and sleep through systemd-inhibit with a watchdog on the server pid', () => {
  const { service, spawnCalls, killedGroups } = createHarness({
    platform: 'linux',
    commandExists: (command) => command === 'systemd-inhibit',
  });
  service.initialize();
  const release = service.acquire();

  assert.equal(spawnCalls[0].command, 'systemd-inhibit');
  assert.deepEqual(spawnCalls[0].args, [
    '--what=idle:sleep',
    '--who=CloudCLI',
    '--why=An agent is working',
    '--mode=block',
    'sh',
    '-c',
    'while kill -0 "$0" 2>/dev/null; do sleep 5; done',
    String(SERVER_PID),
  ]);
  // Its own process group, so stopping it takes the watchdog down too.
  assert.equal(spawnCalls[0].options.detached, true);

  release();
  assert.deepEqual(killedGroups, [spawnCalls[0].helper.pid]);
});

test('Linux without systemd-inhibit is reported unsupported and spawns nothing', () => {
  const { service, spawnCalls } = createHarness({ platform: 'linux', commandExists: () => false });
  service.initialize();
  service.acquire();

  assert.equal(spawnCalls.length, 0);
  assert.deepEqual(service.getStatus(), { enabled: true, supported: false, active: false });
});

test('Windows holds SetThreadExecutionState in PowerShell until the server pid exits', () => {
  const { service, spawnCalls, killedGroups } = createHarness({ platform: 'win32' });
  service.initialize();
  const release = service.acquire();

  assert.equal(spawnCalls[0].command, 'powershell.exe');
  assert.deepEqual(spawnCalls[0].args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
  const script = spawnCalls[0].args[4];
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483649\)/);
  assert.match(script, new RegExp(`Wait-Process -Id ${SERVER_PID}$`));
  assert.equal(script.includes('"'), false, 'the script must survive Windows argument quoting');
  assert.equal(spawnCalls[0].options.detached, false);
  assert.equal(spawnCalls[0].options.windowsHide, true);

  release();
  assert.deepEqual(killedGroups, []);
  assert.equal(spawnCalls[0].helper.killCount, 1);
});

test('other platforms and hosted instances are unsupported', () => {
  for (const overrides of [{ platform: 'freebsd' as const }, { platform: 'darwin' as const, isPlatform: true }]) {
    const { service, spawnCalls } = createHarness(overrides);
    service.initialize();
    service.acquire();
    assert.equal(spawnCalls.length, 0);
    assert.equal(service.getStatus().supported, false);
  }
});

test('a helper that cannot start is logged and never fails the run', () => {
  const { service, warnings } = createHarness({
    spawnProcess() {
      throw new Error('spawn EACCES');
    },
  });
  service.initialize();

  const release = service.acquire();
  assert.equal(service.getStatus().active, false);
  assert.match(warnings[0], /Could not start caffeinate: spawn EACCES/);
  release();
});

test('a helper missing at spawn time or exiting on its own is dropped and retried by the next run', () => {
  const { service, spawnCalls, warnings } = createHarness();
  service.initialize();

  const releaseFirst = service.acquire();
  spawnCalls[0].helper.emit('error', new Error('spawn caffeinate ENOENT'));
  assert.equal(service.getStatus().active, false);
  assert.match(warnings[0], /caffeinate failed: spawn caffeinate ENOENT/);

  const releaseSecond = service.acquire();
  assert.equal(spawnCalls.length, 2);
  spawnCalls[1].helper.emit('exit', 1, null);
  assert.equal(service.getStatus().active, false);
  assert.match(warnings[1], /caffeinate exited unexpectedly \(code 1\)/);

  releaseFirst();
  // A run is still in progress, so the helper is started again.
  assert.equal(spawnCalls.length, 3);
  releaseSecond();
});

test('a helper that errors again after it was stopped cannot crash the server', () => {
  const { service, spawnCalls, warnings } = createHarness({ platform: 'win32' });
  service.initialize();

  service.acquire()();
  // child.kill() reports a signal it could not deliver as an 'error' event.
  assert.doesNotThrow(() => spawnCalls[0].helper.emit('error', new Error('kill EPERM')));
  assert.doesNotThrow(() => spawnCalls[0].helper.emit('error', new Error('kill EPERM')));
  assert.equal(warnings.length, 2);
});

test('a helper exiting after it was stopped is not reported as a failure', () => {
  const { service, spawnCalls, warnings } = createHarness();
  service.initialize();

  service.acquire()();
  spawnCalls[0].helper.emit('exit', null, 'SIGTERM');
  assert.deepEqual(warnings, []);
});

test('switching the setting applies at once to runs already in progress and is persisted', () => {
  const { service, spawnCalls, killedGroups, savedValues } = createHarness({}, false);
  service.initialize();
  service.acquire();
  assert.equal(spawnCalls.length, 0);

  assert.deepEqual(service.setEnabled(true), { enabled: true, supported: true, active: true });
  assert.equal(spawnCalls.length, 1);

  assert.deepEqual(service.setEnabled(false), { enabled: false, supported: true, active: false });
  assert.deepEqual(killedGroups, [spawnCalls[0].helper.pid]);
  assert.deepEqual(savedValues, [true, false]);
});

test('a setting that fails to save leaves the current state untouched', () => {
  const { service, spawnCalls } = createHarness({
    writeEnabled() {
      throw new Error('database is locked');
    },
  }, false);
  service.initialize();
  service.acquire();

  assert.throws(() => service.setEnabled(true), /database is locked/);
  assert.equal(service.getStatus().enabled, false);
  assert.equal(spawnCalls.length, 0);
});

test('shutdown stops the helper and nothing starts afterwards', () => {
  const { service, spawnCalls, killedGroups } = createHarness();
  service.initialize();
  const release = service.acquire();

  service.shutdown();
  assert.deepEqual(killedGroups, [spawnCalls[0].helper.pid]);

  service.acquire();
  release();
  assert.equal(spawnCalls.length, 1);
});

test('a hold that is never released lapses instead of keeping the computer awake forever', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, spawnCalls, killedGroups, warnings } = createHarness({ maxHoldMs: 1000 });
  service.initialize();

  const release = service.acquire();
  t.mock.timers.tick(999);
  assert.equal(service.getStatus().active, true);

  t.mock.timers.tick(1);
  assert.equal(service.getStatus().active, false);
  assert.deepEqual(killedGroups, [spawnCalls[0].helper.pid]);
  assert.match(warnings[0], /held this computer awake for too long/);

  // The run settling later is a harmless no-op.
  release();
  assert.equal(spawnCalls.length, 1);
});

test('a released hold cancels its lapse timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, warnings } = createHarness({ maxHoldMs: 1000 });
  service.initialize();

  service.acquire()();
  t.mock.timers.tick(5000);
  assert.deepEqual(warnings, []);
});
