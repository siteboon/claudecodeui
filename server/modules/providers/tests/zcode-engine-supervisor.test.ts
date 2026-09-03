import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';

import {
  EngineSupervisor,
  type EngineSupervisorOptions,
} from '@/modules/providers/list/zcode/zcode-engine-supervisor.js';

type FakeProcess = {
  proc: ChildProcess;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdinWrites: string[];
  stdinEnded: () => boolean;
  exit: (code: number | null, signal?: NodeJS.Signals | null) => void;
};

function makeFakeProcess(): FakeProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdinWrites: string[] = [];
  let stdinEnded = false;

  (proc as unknown as { stdout: EventEmitter }).stdout = stdout;
  (proc as unknown as { stderr: EventEmitter }).stderr = stderr;
  (proc as unknown as { stdin: unknown }).stdin = {
    write: (line: string, _encoding: string, callback?: () => void) => {
      stdinWrites.push(line);
      callback?.();
    },
    end: () => {
      stdinEnded = true;
    },
  };
  (proc as unknown as { killed: boolean }).killed = false;
  (proc as unknown as { kill: () => void }).kill = () => {
    (proc as unknown as { killed: boolean }).killed = true;
  };

  return {
    proc,
    stdout,
    stderr,
    stdinWrites,
    stdinEnded: () => stdinEnded,
    exit: (code, signal) => {
      (proc as unknown as { killed: boolean }).killed = true;
      proc.emit('exit', code, signal ?? null);
    },
  };
}

function createSupervisor(
  options: EngineSupervisorOptions,
  processes: FakeProcess[],
  extraDependencies: Record<string, unknown> = {},
): EngineSupervisor {
  return new EngineSupervisor(
    { restartBackoffBaseMs: 1, maxBackoffMs: 4, stableUptimeMs: 60_000, ...options },
    {
      resolveEnginePath: () => '/opt/engines/zcode.cjs',
      spawnProcess: () => {
        const proc = makeFakeProcess();
        processes.push(proc);
        return proc.proc;
      },
      ...extraDependencies,
    },
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('ensureRunning spawns the engine lazily and reuses the live process', async () => {
  const processes: FakeProcess[] = [];
  const supervisor = createSupervisor({}, processes);

  await supervisor.ensureRunning();
  await supervisor.ensureRunning();

  assert.equal(processes.length, 1);
});

test('ensureRunning rejects when the engine is not installed', async () => {
  const supervisor = new EngineSupervisor({}, {
    resolveEnginePath: () => null,
    spawnProcess: () => makeFakeProcess().proc,
  });

  await assert.rejects(() => supervisor.ensureRunning(), /ZCode engine not found/);
});

test('crashes notify subscribers and demand accelerates the scheduled restart', async () => {
  const processes: FakeProcess[] = [];
  const supervisor = createSupervisor({ restartBackoffBaseMs: 60_000 }, processes);
  const crashes: Array<{ code: number | null }> = [];
  supervisor.onCrash((info) => crashes.push({ code: info.code }));

  await supervisor.ensureRunning();
  processes[0].exit(1);

  assert.equal(crashes.length, 1);
  assert.equal(crashes[0].code, 1);

  // Without demand the restart would wait out the 60s backoff; a request
  // accelerates it immediately.
  await supervisor.ensureRunning();
  assert.equal(processes.length, 2);
});

test('the circuit breaker refuses to revive a crash-looping engine', async () => {
  const processes: FakeProcess[] = [];
  const supervisor = createSupervisor({ maxRestartsPerMinute: 2 }, processes);

  // Three spawns in quick succession: the third crash trips the breaker.
  await supervisor.ensureRunning();
  for (let i = 0; i < 2; i += 1) {
    processes[processes.length - 1].exit(1);
    await wait(10);
    await supervisor.ensureRunning();
  }
  processes[processes.length - 1].exit(1);
  await wait(10);

  assert.equal(processes.length, 3);
  await assert.rejects(() => supervisor.ensureRunning(), /crash-looping/);
});

test('shutdown cancels a scheduled restart so no engine spawns afterwards', async () => {
  const processes: FakeProcess[] = [];
  const supervisor = createSupervisor({ restartBackoffBaseMs: 50 }, processes);

  await supervisor.ensureRunning();
  processes[0].exit(1);

  await supervisor.shutdown();
  await wait(120);

  assert.equal(processes.length, 1);
});

test('shutdown resets state so the supervisor is reusable', async () => {
  const processes: FakeProcess[] = [];
  const supervisor = createSupervisor({}, processes);

  await supervisor.ensureRunning();
  await supervisor.shutdown();

  await supervisor.ensureRunning();
  assert.equal(processes.length, 2);
});

test('stdout lines are framed and partial lines are buffered', async () => {
  const processes: FakeProcess[] = [];
  const supervisor = createSupervisor({}, processes);
  const lines: string[] = [];
  supervisor.onLine((line) => lines.push(line));

  await supervisor.ensureRunning();

  processes[0].stdout.emit('data', Buffer.from('{"id":1}\n{"id":2}\n{"id":3'));
  assert.deepEqual(lines, ['{"id":1}', '{"id":2}']);

  processes[0].stdout.emit('data', Buffer.from('}\n'));
  assert.deepEqual(lines, ['{"id":1}', '{"id":2}', '{"id":3}']);
});

test('writeLine writes to the engine stdin and shutdown closes it', async () => {
  const processes: FakeProcess[] = [];
  const supervisor = createSupervisor({}, processes);

  await supervisor.ensureRunning();
  supervisor.writeLine('{"id":1,"method":"session/subscribe"}\n');
  assert.equal(processes[0].stdinWrites.length, 1);

  await supervisor.shutdown();
  assert.equal(processes[0].stdinEnded(), true);
});
