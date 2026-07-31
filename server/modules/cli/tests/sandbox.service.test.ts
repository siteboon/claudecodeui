import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandboxCommandService } from '../sandbox.service.js';

test('creates a sandbox through injected filesystem, subprocess, and clock adapters', async () => {
  const commands: string[][] = [];
  const detachedCommands: string[][] = [];
  const waits: number[] = [];
  const service = createSandboxCommandService({
    homeDirectory: '/home/user',
    fileSystem: {
      pathExists: (candidatePath) => candidatePath === '/home/user/project',
    },
    output: { log: () => undefined, error: () => undefined },
    runSandboxCommand: (argumentsList) => {
      commands.push(argumentsList);
      return argumentsList[0] === 'secret' ? 'anthropic' : '';
    },
    spawnDetachedSandbox: (argumentsList) => detachedCommands.push(argumentsList),
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  const exitCode = await service.execute(['~/project']);

  assert.equal(exitCode, 0);
  assert.deepEqual(detachedCommands, [[
    'run',
    '--template',
    'docker.io/cloudcliai/sandbox:claude-code',
    '--name',
    'project',
    'claude',
    '/home/user/project',
  ]]);
  assert.deepEqual(waits, [5_000]);
  assert.ok(commands.some((argumentsList) => argumentsList[0] === 'ports'));
});

test('does not spawn when the workspace does not exist', async () => {
  let detachedCalls = 0;
  const service = createSandboxCommandService({
    homeDirectory: '/home/user',
    fileSystem: {
      pathExists: () => false,
    },
    output: { log: () => undefined, error: () => undefined },
    runSandboxCommand: () => '',
    spawnDetachedSandbox: () => {
      detachedCalls += 1;
    },
    wait: async () => undefined,
  });

  const exitCode = await service.execute(['/missing']);

  assert.equal(exitCode, 1);
  assert.equal(detachedCalls, 0);
});
