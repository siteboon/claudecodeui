import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createFileTreeService } from '@/modules/file-tree/file-tree.service.js';
import type {
  FileTreeDirectoryEntry,
  FileTreeFileSystem,
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
    readdir: unexpectedOperation,
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

function createDependencies(
  fileSystem: FileTreeFileSystem,
  projectRoot: string,
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
    readdir: async (directoryPath) => {
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
    },
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
