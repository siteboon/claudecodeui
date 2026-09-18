import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteLocalBranch } from '../git-branch.service.js';

test('deleteLocalBranch uses safe deletion by default', async () => {
  const commands: string[][] = [];
  const output = await deleteLocalBranch({
    projectPath: '/workspace/repo',
    branch: 'feature/safe-delete',
    force: false,
    runCommand: async (_command, args) => {
      commands.push(args);
      return {
        stdout: args.includes('--show-current') ? 'main\n' : 'Deleted branch feature/safe-delete.\n',
        stderr: '',
      };
    },
  });

  assert.equal(output, 'Deleted branch feature/safe-delete.\n');
  assert.deepEqual(commands, [
    ['branch', '--show-current'],
    ['branch', '-d', '--', 'feature/safe-delete'],
  ]);
});

test('deleteLocalBranch uses force deletion only when requested', async () => {
  const commands: string[][] = [];
  await deleteLocalBranch({
    projectPath: '/workspace/repo',
    branch: 'feature/unmerged',
    force: true,
    runCommand: async (_command, args) => {
      commands.push(args);
      return { stdout: args.includes('--show-current') ? 'main\n' : '', stderr: '' };
    },
  });

  assert.deepEqual(commands, [
    ['branch', '--show-current'],
    ['branch', '-D', '--', 'feature/unmerged'],
  ]);
});

test('deleteLocalBranch refuses to delete the current branch even when forced', async () => {
  await assert.rejects(
    deleteLocalBranch({
      projectPath: '/workspace/repo',
      branch: 'feature/current',
      force: true,
      runCommand: async () => ({ stdout: 'feature/current\n', stderr: '' }),
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GIT_CURRENT_BRANCH_DELETE');
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      return true;
    },
  );
});
