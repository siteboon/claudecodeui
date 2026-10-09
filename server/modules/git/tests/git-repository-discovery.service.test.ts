import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { discoverRepositories } from '../git-repository-discovery.service.js';

type FakeTree = Record<string, string[]>;

function createFileSystem(tree: FakeTree, repositoryRoots: string[]) {
  const readDirectories: string[] = [];
  const repositories = new Set(repositoryRoots.map((root) => path.join(root, '.git')));
  return {
    readDirectories,
    fileSystem: {
      async readdir(directoryPath: string) {
        readDirectories.push(directoryPath);
        const names = tree[directoryPath];
        if (!names) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        return names.map((name) => ({
          name,
          isDirectory: () => !name.includes('.txt'),
        }));
      },
      async access(candidatePath: string) {
        if (!repositories.has(candidatePath)) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
      },
    },
  };
}

test('discoverRepositories lists the root and nested repositories without entering them', async () => {
  const root = path.resolve('/workspace');
  const { fileSystem, readDirectories } = createFileSystem({
    [root]: ['zeta', 'alpha', 'node_modules', '.hidden', 'notes.txt', 'group'],
    [path.join(root, 'group')]: ['inner', 'deeper'],
    [path.join(root, 'group', 'deeper')]: ['too-deep'],
    [path.join(root, 'alpha')]: ['should-not-be-read'],
  }, [root, path.join(root, 'alpha'), path.join(root, 'zeta'), path.join(root, 'group', 'inner'), path.join(root, 'group', 'deeper', 'too-deep')]);

  const repositories = await discoverRepositories(root, fileSystem);

  assert.deepEqual(repositories, [
    { path: '', name: 'workspace' },
    { path: 'alpha', name: 'alpha' },
    { path: 'group/inner', name: 'inner' },
    { path: 'zeta', name: 'zeta' },
  ]);
  assert.equal(readDirectories.includes(path.join(root, 'alpha')), false);
  assert.equal(readDirectories.includes(path.join(root, 'node_modules')), false);
  assert.equal(readDirectories.includes(path.join(root, '.hidden')), false);
  // Two levels down is where the scan stops, so a third level is neither read nor found.
  assert.equal(readDirectories.includes(path.join(root, 'group', 'deeper')), false);
  assert.equal(readDirectories.includes(path.join(root, 'group', 'deeper', 'too-deep')), false);
});

test('discoverRepositories omits a project root that is not a repository', async () => {
  const root = path.resolve('/workspace');
  const { fileSystem } = createFileSystem({ [root]: ['only'] }, [path.join(root, 'only')]);

  assert.deepEqual(await discoverRepositories(root, fileSystem), [{ path: 'only', name: 'only' }]);
});
