import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createFileTreeService } from '@/modules/file-tree/file-tree.service.js';
import type {
  FileTreeDirectoryEntry,
  FileTreeFileSystem,
  FileTreeIgnoredDirectoriesGateway,
  FileTreeServiceDependencies,
  FileTreeStats,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

function createDirectoryEntry(name: string, directory: boolean): FileTreeDirectoryEntry {
  return {
    name,
    isDirectory: () => directory,
  };
}

/**
 * Adapts a path-keyed listing to the streaming directory contract so tests keep
 * describing directories as plain arrays.
 */
function createDirectoryReader(
  listDirectory: (directoryPath: string) => FileTreeDirectoryEntry[],
): FileTreeFileSystem['openDirectory'] {
  return async function* openDirectory(directoryPath) {
    yield* listDirectory(directoryPath);
  };
}

function createStats(directory: boolean, mode: number): FileTreeStats {
  return {
    size: directory ? 0 : 24,
    mtime: new Date('2026-01-02T03:04:05.000Z'),
    mode,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
  };
}

function createFakeFileSystem(
  overrides: Partial<FileTreeFileSystem> = {},
): FileTreeFileSystem {
  const unexpectedOperation = async (): Promise<never> => {
    throw new Error('Unexpected File Tree filesystem operation');
  };

  return {
    access: unexpectedOperation,
    stat: unexpectedOperation,
    lstat: unexpectedOperation,
    openDirectory: () => ({
      [Symbol.asyncIterator]: () => ({ next: unexpectedOperation }),
    }),
    realpath: unexpectedOperation,
    readTextFile: unexpectedOperation,
    writeTextFile: unexpectedOperation,
    makeDirectory: unexpectedOperation,
    rename: unexpectedOperation,
    removeDirectory: unexpectedOperation,
    unlink: unexpectedOperation,
    copyFile: unexpectedOperation,
    createReadStream: () => Readable.from([]),
    ...overrides,
  };
}

/**
 * Stores the ignored-directory names in memory so tests can assert both what
 * the service reads and what it persists without touching the database.
 */
function createIgnoredDirectoriesGateway(
  storedNames: readonly string[] | null = null,
): FileTreeIgnoredDirectoriesGateway & { written: string[][] } {
  const written: string[][] = [];
  let currentNames = storedNames;

  return {
    written,
    read: () => currentNames,
    write: (directoryNames) => {
      currentNames = [...directoryNames];
      written.push([...directoryNames]);
    },
  };
}

function createDependencies(
  fileSystem: FileTreeFileSystem,
  projectRoot: string,
  ignoredDirectories: FileTreeIgnoredDirectoriesGateway = createIgnoredDirectoriesGateway(),
): FileTreeServiceDependencies {
  return {
    fileSystem,
    projects: {
      getProjectPathById: async () => projectRoot,
    },
    workspace: {
      rootPath: projectRoot,
      validatePath: async (candidatePath) => ({ valid: true, resolvedPath: candidatePath }),
    },
    ignoredDirectories,
    resolveMimeType: () => 'text/plain',
    fileSystemConcurrency: 4,
    logger: { error: () => undefined },
  };
}

test('listProjectFiles builds a sorted tree and skips generated directories', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const sourceDirectory = path.join(projectRoot, 'src');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    openDirectory: createDirectoryReader((directoryPath) => {
      if (directoryPath === projectRoot) {
        return [
          createDirectoryEntry('node_modules', true),
          createDirectoryEntry('README.md', false),
          createDirectoryEntry('src', true),
        ];
      }
      if (directoryPath === sourceDirectory) {
        return [createDirectoryEntry('index.ts', false)];
      }
      return [];
    }),
    lstat: async (candidatePath) => createStats(candidatePath === sourceDirectory, 0o754),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const tree = await service.listProjectFiles('project-1');

  assert.deepEqual(tree.map((entry) => entry.name), ['src', 'README.md']);
  const sourceEntry = tree[0];
  assert.ok(sourceEntry);
  assert.equal(sourceEntry.type, 'directory');
  assert.equal(sourceEntry.permissions, '754');
  assert.equal(sourceEntry.permissionsRwx, 'rwxr-xr--');
  assert.deepEqual(sourceEntry.children?.map((entry) => entry.name), ['index.ts']);
});

test('listProjectFiles excludes gitignored entries only when requested', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const cacheDirectory = path.join(projectRoot, 'cache');
  const sourceDirectory = path.join(projectRoot, 'src');
  const readDirectories: string[] = [];
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readTextFile: async (filePath) => {
      assert.equal(filePath, path.join(projectRoot, '.gitignore'));
      return ['*.log', '!keep.log', 'cache/', 'src/generated.ts'].join('\n');
    },
    openDirectory: createDirectoryReader((directoryPath) => {
      readDirectories.push(directoryPath);
      if (directoryPath === projectRoot) {
        return [
          createDirectoryEntry('.gitignore', false),
          createDirectoryEntry('cache', true),
          createDirectoryEntry('ignored.log', false),
          createDirectoryEntry('keep.log', false),
          createDirectoryEntry('src', true),
        ];
      }
      if (directoryPath === cacheDirectory) {
        return [createDirectoryEntry('cached.txt', false)];
      }
      if (directoryPath === sourceDirectory) {
        return [
          createDirectoryEntry('generated.ts', false),
          createDirectoryEntry('index.ts', false),
        ];
      }
      return [];
    }),
    lstat: async (candidatePath) => createStats(
      candidatePath === cacheDirectory || candidatePath === sourceDirectory,
      0o644,
    ),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const tree = await service.listProjectFiles('project-1', { respectGitignore: true });

  assert.deepEqual(tree.map((entry) => entry.name), ['src', '.gitignore', 'keep.log']);
  assert.deepEqual(tree[0]?.children?.map((entry) => entry.name), ['index.ts']);
  assert.equal(readDirectories.includes(cacheDirectory), false);
});

test('listProjectFiles returns the normal tree when no gitignore exists', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readTextFile: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    openDirectory: createDirectoryReader((directoryPath) => directoryPath === projectRoot
      ? [createDirectoryEntry('debug.log', false)]
      : []),
    lstat: async () => createStats(false, 0o644),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const tree = await service.listProjectFiles('project-1', { respectGitignore: true });

  assert.deepEqual(tree.map((entry) => entry.name), ['debug.log']);
});

test('listProjectFiles rejects a tree that exceeds the server entry limit', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    openDirectory: createDirectoryReader((directoryPath) => directoryPath === projectRoot
      ? Array.from({ length: 10_001 }, (_, index) => createDirectoryEntry(`file-${index}.txt`, false))
      : []),
    lstat: async () => createStats(false, 0o644),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.listProjectFiles('project-1'),
    (error: unknown) => error instanceof AppError
      && error.code === 'FILE_TREE_TOO_LARGE'
      && error.statusCode === 413,
  );
});

test('listProjectFiles abandons a directory stream as soon as the entry limit is passed', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  let streamedEntries = 0;
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    // Endless on purpose: the walk has to stop consuming the stream itself
    // instead of waiting for the directory listing to be materialized.
    openDirectory: async function* (directoryPath) {
      if (directoryPath !== projectRoot) {
        return;
      }
      for (let index = 0; ; index += 1) {
        streamedEntries += 1;
        yield createDirectoryEntry(`file-${index}.txt`, false);
      }
    },
    lstat: async () => createStats(false, 0o644),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.listProjectFiles('project-1'),
    (error: unknown) => error instanceof AppError
      && error.code === 'FILE_TREE_TOO_LARGE'
      && error.statusCode === 413,
  );
  // The budget plus the single entry that proves it was exceeded.
  assert.equal(streamedEntries, 10_001);
});

test('listProjectFiles shares the entry limit across nested directories', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const firstDirectory = path.join(projectRoot, 'first');
  const secondDirectory = path.join(projectRoot, 'second');
  const directoryPaths = new Set([firstDirectory, secondDirectory]);
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    openDirectory: createDirectoryReader((directoryPath) => {
      if (directoryPath === projectRoot) {
        return [
          createDirectoryEntry('first', true),
          createDirectoryEntry('second', true),
        ];
      }
      if (directoryPaths.has(directoryPath)) {
        return Array.from(
          { length: 5_000 },
          (_, index) => createDirectoryEntry(`${path.basename(directoryPath)}-${index}.txt`, false),
        );
      }
      return [];
    }),
    lstat: async (candidatePath) => createStats(directoryPaths.has(candidatePath), 0o644),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.listProjectFiles('project-1'),
    (error: unknown) => error instanceof AppError
      && error.code === 'FILE_TREE_TOO_LARGE'
      && error.statusCode === 413,
  );
});

test('readTextFile rejects traversal before invoking the filesystem adapter', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const readPaths: string[] = [];
  const fileSystem = createFakeFileSystem({
    readTextFile: async (filePath) => {
      readPaths.push(filePath);
      return 'should not be read';
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.readTextFile('project-1', '../secret.txt'),
    (error: unknown) => error instanceof AppError
      && error.code === 'PATH_OUTSIDE_PROJECT'
      && error.statusCode === 403,
  );
  assert.deepEqual(readPaths, []);
});

test('createEntry performs filesystem mutation only through the injected adapter', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const targetPath = path.join(projectRoot, 'notes.txt');
  const writtenFiles: Array<{ filePath: string; content: string }> = [];
  const fileSystem = createFakeFileSystem({
    access: async (candidatePath) => {
      if (candidatePath === targetPath) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
    },
    writeTextFile: async (filePath, content) => {
      writtenFiles.push({ filePath, content });
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const result = await service.createEntry({
    projectId: 'project-1',
    parentPath: projectRoot,
    type: 'file',
    name: 'notes.txt',
  });

  assert.equal(result.path, targetPath);
  assert.deepEqual(writtenFiles, [{ filePath: targetPath, content: '' }]);
});

test('listProjectFiles hides .NET build output directories by default', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    openDirectory: createDirectoryReader((directoryPath) => directoryPath === projectRoot
      ? [
          createDirectoryEntry('bin', true),
          createDirectoryEntry('obj', true),
          createDirectoryEntry('src', true),
        ]
      : []),
    lstat: async () => createStats(true, 0o755),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const tree = await service.listProjectFiles('project-1');

  assert.deepEqual(tree.map((entry) => entry.name), ['src']);
});

test('listProjectFiles hides only the configured directory names', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    openDirectory: createDirectoryReader((directoryPath) => directoryPath === projectRoot
      ? [
          createDirectoryEntry('cache', true),
          createDirectoryEntry('node_modules', true),
          createDirectoryEntry('src', true),
        ]
      : []),
    lstat: async () => createStats(true, 0o755),
  });
  const service = createFileTreeService(createDependencies(
    fileSystem,
    projectRoot,
    createIgnoredDirectoriesGateway(['cache']),
  ));

  const tree = await service.listProjectFiles('project-1');

  assert.deepEqual(tree.map((entry) => entry.name), ['node_modules', 'src']);
});

test('getIgnoredDirectories reports the stored names alongside the defaults', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const service = createFileTreeService(createDependencies(
    createFakeFileSystem(),
    projectRoot,
    createIgnoredDirectoriesGateway(['cache']),
  ));

  const settings = service.getIgnoredDirectories();

  assert.deepEqual(settings.ignoredDirectories, ['cache']);
  assert.ok(settings.defaults.includes('node_modules'));
  assert.ok(settings.defaults.includes('bin'));
  assert.ok(settings.defaults.includes('obj'));
});

test('getIgnoredDirectories falls back to the defaults when nothing is stored', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const service = createFileTreeService(createDependencies(
    createFakeFileSystem(),
    projectRoot,
  ));

  const settings = service.getIgnoredDirectories();

  assert.deepEqual(settings.ignoredDirectories, settings.defaults);
  assert.ok(settings.ignoredDirectories.includes('bin'));
  assert.ok(settings.ignoredDirectories.includes('obj'));
});

test('an explicitly empty list hides nothing instead of falling back to the defaults', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    openDirectory: createDirectoryReader((directoryPath) => directoryPath === projectRoot
      ? [
          createDirectoryEntry('bin', true),
          createDirectoryEntry('node_modules', true),
          createDirectoryEntry('src', true),
        ]
      : []),
    lstat: async () => createStats(true, 0o755),
  });
  const service = createFileTreeService(createDependencies(
    fileSystem,
    projectRoot,
    createIgnoredDirectoriesGateway([]),
  ));

  const tree = await service.listProjectFiles('project-1');

  assert.deepEqual(service.getIgnoredDirectories().ignoredDirectories, []);
  assert.deepEqual(tree.map((entry) => entry.name), ['bin', 'node_modules', 'src']);
});

test('updateIgnoredDirectories trims, drops blanks and deduplicates before persisting', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const ignoredDirectories = createIgnoredDirectoriesGateway();
  const service = createFileTreeService(createDependencies(
    createFakeFileSystem(),
    projectRoot,
    ignoredDirectories,
  ));

  const result = service.updateIgnoredDirectories(['  bin  ', 'obj', '', 'bin']);

  assert.deepEqual(result, { success: true, ignoredDirectories: ['bin', 'obj'] });
  assert.deepEqual(ignoredDirectories.written, [['bin', 'obj']]);
});

test('updateIgnoredDirectories rejects names containing a path separator', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const ignoredDirectories = createIgnoredDirectoriesGateway();
  const service = createFileTreeService(createDependencies(
    createFakeFileSystem(),
    projectRoot,
    ignoredDirectories,
  ));

  assert.throws(
    () => service.updateIgnoredDirectories(['src/generated']),
    (error: unknown) => error instanceof AppError
      && error.code === 'INVALID_IGNORED_DIRECTORY_NAME'
      && error.statusCode === 400,
  );
  assert.deepEqual(ignoredDirectories.written, []);
});

test('updateIgnoredDirectories rejects a payload that is not an array', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const ignoredDirectories = createIgnoredDirectoriesGateway();
  const service = createFileTreeService(createDependencies(
    createFakeFileSystem(),
    projectRoot,
    ignoredDirectories,
  ));

  assert.throws(
    () => service.updateIgnoredDirectories('bin'),
    (error: unknown) => error instanceof AppError
      && error.code === 'INVALID_IGNORED_DIRECTORIES'
      && error.statusCode === 400,
  );
  assert.deepEqual(ignoredDirectories.written, []);
});
