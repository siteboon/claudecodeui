import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type CrewAIRunner,
  createCrewAIRunner,
  type CrewAIRunCallbacks,
} from '@/services/crewai-runner.service.js';

function makeNoopCallbacks(): CrewAIRunCallbacks {
  return {
    onAgentOutput: () => {},
    onCrewComplete: () => {},
    onCrewError: () => {},
  };
}

test('createCrewAIRunner returns a runner with no active runs', () => {
  const runner = createCrewAIRunner();
  assert.deepEqual(runner.getActiveRunIds(), []);
});

test('startRun rejects invalid config', async () => {
  const runner = createCrewAIRunner();
  const result = await runner.startRun(
    { mode: 'local', localProjectPath: '' },
    { projectPath: '.', inputs: {} },
    makeNoopCallbacks(),
  );
  assert.equal(result.success, false);
  assert.ok(result.error?.includes('localProjectPath'));
});

test('startRun tracks the run as active', async () => {
  let spawnedCommand = '';
  const runner = createCrewAIRunner({
    spawn: (cmd, args, opts) => {
      spawnedCommand = cmd;
      return {
        pid: 1234,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => cb(0), 50);
          }
        },
        kill: () => true,
      };
    },
  });

  const result = await runner.startRun(
    { mode: 'local', localProjectPath: '.' },
    { projectPath: '.', inputs: {} },
    makeNoopCallbacks(),
  );

  assert.equal(result.success, true);
  assert.ok(result.runId);
  assert.equal(spawnedCommand, 'uv');
  assert.ok(runner.getActiveRunIds().includes(result.runId!));
});

test('run is removed from active list after process exits', async () => {
  let closeCallback: ((code: number) => void) | null = null;
  const runner = createCrewAIRunner({
    spawn: () => ({
      pid: 5678,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') closeCallback = cb;
      },
      kill: () => true,
    }),
  });

  const completedPromise = new Promise<void>((resolve) => {
    runner.startRun(
      { mode: 'local', localProjectPath: '.' },
      { projectPath: '.', inputs: {} },
      { onAgentOutput: () => {}, onCrewComplete: () => resolve(), onCrewError: () => {} },
    );
  });

  assert.equal(runner.getActiveRunIds().length, 1);

  closeCallback!(0);
  await completedPromise;
  assert.deepEqual(runner.getActiveRunIds(), []);
});

test('abortRun kills the process and removes from active list', async () => {
  let killed = false;
  let closeCallback: ((code: number) => void) | null = null;
  const runner = createCrewAIRunner({
    spawn: () => ({
      pid: 9999,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') closeCallback = cb;
      },
      kill: () => { killed = true; return true; },
    }),
  });

  const result = await runner.startRun(
    { mode: 'local', localProjectPath: '.' },
    { projectPath: '.', inputs: {} },
    makeNoopCallbacks(),
  );

  const aborted = runner.abortRun(result.runId!);
  assert.equal(aborted, true);
  assert.equal(killed, true);
});

test('abortRun returns false for unknown runId', () => {
  const runner = createCrewAIRunner();
  assert.equal(runner.abortRun('nonexistent'), false);
});

test('isRunActive returns true for active runs', async () => {
  const runner = createCrewAIRunner({
    spawn: () => ({
      pid: 1111,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: () => {},
      kill: () => true,
    }),
  });

  const result = await runner.startRun(
    { mode: 'local', localProjectPath: '.' },
    { projectPath: '.', inputs: {} },
    makeNoopCallbacks(),
  );

  assert.equal(runner.isRunActive(result.runId!), true);
  assert.equal(runner.isRunActive('unknown'), false);
});

test('onAgentOutput callback receives parsed agent data from stdout', async () => {
  const agentOutputs: Array<{ agentRole: string; task: string; output: string }> = [];
  let stdoutCallback: ((data: Buffer) => void) | null = null;
  let closeCallback: ((code: number) => void) | null = null;

  const runner = createCrewAIRunner({
    spawn: () => ({
      pid: 2222,
      stdout: {
        on: (event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') stdoutCallback = cb;
        },
      },
      stderr: { on: () => {} },
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') closeCallback = cb;
      },
      kill: () => true,
    }),
  });

  const completedPromise = new Promise<void>((resolve) => {
    runner.startRun(
      { mode: 'local', localProjectPath: '.' },
      { projectPath: '.', inputs: {} },
      {
        onAgentOutput: (o) => agentOutputs.push(o),
        onCrewComplete: () => resolve(),
        onCrewError: () => {},
      },
    );
  });

  stdoutCallback!(Buffer.from('# Agent: Researcher\n## Task: Research topic\nFound relevant data\n'));
  closeCallback!(0);
  await completedPromise;

  assert.equal(agentOutputs.length, 1);
  assert.equal(agentOutputs[0].agentRole, 'Researcher');
  assert.equal(agentOutputs[0].task, 'Research topic');
});

test('onCrewError callback fires on non-zero exit code', async () => {
  let closeCallback: ((code: number) => void) | null = null;
  let errorMsg = '';

  const runner = createCrewAIRunner({
    spawn: () => ({
      pid: 3333,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') closeCallback = cb;
      },
      kill: () => true,
    }),
  });

  const errorPromise = new Promise<void>((resolve) => {
    runner.startRun(
      { mode: 'local', localProjectPath: '.' },
      { projectPath: '.', inputs: {} },
      {
        onAgentOutput: () => {},
        onCrewComplete: () => {},
        onCrewError: (err) => { errorMsg = err; resolve(); },
      },
    );
  });

  closeCallback!(1);
  await errorPromise;

  assert.ok(errorMsg.includes('exit code 1'));
});
