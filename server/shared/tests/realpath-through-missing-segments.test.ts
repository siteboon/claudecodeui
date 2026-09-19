import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { AppError, realpathThroughMissingSegments } from '@/shared/utils.js';

function createErrnoError(code: string, candidatePath: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${candidatePath}`), { code });
}

const root = path.parse(path.resolve('workspace')).root;
const realWorkspace = path.join(root, 'real', 'workspace');

test('an ancestor the process may not look into is walked past, as a missing one is', async () => {
  // EPERM is what Windows reports for a directory without traverse rights;
  // Linux says EACCES. Either way the operation itself fails on it later.
  const realpathCalls: string[] = [];
  const lstatCalls: string[] = [];
  const resolved = await realpathThroughMissingSegments(path.join(root, 'workspace', 'locked', 'new', 'project'), {
    realpath: async (candidatePath) => {
      realpathCalls.push(candidatePath);
      if (candidatePath === path.join(root, 'workspace')) {
        return realWorkspace;
      }
      throw createErrnoError(candidatePath === path.join(root, 'workspace', 'locked') ? 'EACCES' : 'EPERM', candidatePath);
    },
    lstat: async (candidatePath) => {
      lstatCalls.push(candidatePath);
      throw createErrnoError('ENOENT', candidatePath);
    },
  });

  assert.equal(resolved, path.join(realWorkspace, 'locked', 'new', 'project'));
  assert.deepEqual(realpathCalls, [
    path.join(root, 'workspace', 'locked', 'new', 'project'),
    path.join(root, 'workspace', 'locked', 'new'),
    path.join(root, 'workspace', 'locked'),
    path.join(root, 'workspace'),
  ]);
  // Only a missing segment is checked for being a dangling link; a
  // permission failure says nothing about that.
  assert.deepEqual(lstatCalls, []);
});

test('a path that is missing up to and including the filesystem root fails with that error', async () => {
  const realpathCalls: string[] = [];
  const missingEverywhere = {
    realpath: async (candidatePath: string) => {
      realpathCalls.push(candidatePath);
      throw createErrnoError('ENOENT', candidatePath);
    },
    lstat: async (candidatePath: string) => {
      throw createErrnoError('ENOENT', candidatePath);
    },
  };

  await assert.rejects(
    realpathThroughMissingSegments(path.join(root, 'gone', 'project'), missingEverywhere),
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
      && (error as Error).message === `ENOENT: ${root}`,
  );
  // The root is its own parent; the walk asks about it once and stops.
  assert.deepEqual(realpathCalls, [path.join(root, 'gone', 'project'), path.join(root, 'gone'), root]);
});

test('a dangling symlink is refused rather than passed off as a segment still to be created', async () => {
  const danglingLink = path.join(root, 'workspace', 'dangling');

  await assert.rejects(
    realpathThroughMissingSegments(path.join(danglingLink, 'project'), {
      realpath: async (candidatePath) => {
        if (candidatePath === path.join(root, 'workspace')) {
          return realWorkspace;
        }
        throw createErrnoError('ENOENT', candidatePath);
      },
      lstat: async (candidatePath) => {
        if (candidatePath === danglingLink) {
          return {};
        }
        throw createErrnoError('ENOENT', candidatePath);
      },
    }),
    (error: unknown) => error instanceof AppError
      && error.code === 'SYMLINK_TARGET_MISSING'
      && error.statusCode === 403
      && error.message === `Symbolic link target does not exist: ${danglingLink}`,
  );
});
