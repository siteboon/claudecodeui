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

function createErrnoError(code: string, candidatePath: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${candidatePath}`), { code });
}

function isOrBeneath(candidatePath: string, ancestorPath: string): boolean {
  return candidatePath === ancestorPath || candidatePath.startsWith(ancestorPath + path.sep);
}

/**
 * Path-keyed stand-ins for the two calls the containment check makes. `links`
 * map a spelled path — and everything beneath it — to where it really leads,
 * the deepest link along a path winning as it does on a real filesystem;
 * `missing` paths do not exist yet, so the resolver walks up to their nearest
 * existing ancestor; `dangling` paths are symlinks whose target is gone: they
 * cannot be resolved, yet they are there. Everything else resolves to itself.
 */
function createRealPathFakes(options: {
  links?: Record<string, string>;
  missing?: string[];
  dangling?: string[];
} = {}): Pick<FileTreeFileSystem, 'realpath' | 'lstat'> {
  const isMissing = (candidatePath: string) =>
    [...options.missing ?? [], ...options.dangling ?? []]
      .some((missingPath) => isOrBeneath(candidatePath, missingPath));
  const links = Object.entries(options.links ?? {})
    .sort(([leftPath], [rightPath]) => rightPath.length - leftPath.length);

  return {
    realpath: async (candidatePath) => {
      if (isMissing(candidatePath)) {
        throw createErrnoError('ENOENT', candidatePath);
      }
      const link = links.find(([linkPath]) => isOrBeneath(candidatePath, linkPath));
      return link ? link[1] + candidatePath.slice(link[0].length) : candidatePath;
    },
    lstat: async (candidatePath) => {
      if (options.dangling?.includes(candidatePath)) {
        return createStats(false, 0o777);
      }
      throw createErrnoError('ENOENT', candidatePath);
    },
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

test('listProjectFiles applies gitignore alongside hard directory exclusions', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const documentationDirectory = path.join(projectRoot, 'docs');
  const buildDocumentationDirectory = path.join(documentationDirectory, 'build');
  const gitDirectory = path.join(projectRoot, '.git');
  const nodeModulesDirectory = path.join(projectRoot, 'node_modules');
  const sourceDirectory = path.join(projectRoot, 'src');
  const readDirectories: string[] = [];
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readTextFile: async (filePath) => {
      assert.equal(filePath, path.join(projectRoot, '.gitignore'));
      return '*.log';
    },
    openDirectory: createDirectoryReader((directoryPath) => {
      readDirectories.push(directoryPath);
      if (directoryPath === projectRoot) {
        return [
          createDirectoryEntry('.git', true),
          createDirectoryEntry('node_modules', true),
          createDirectoryEntry('README.md', false),
          createDirectoryEntry('docs', true),
          createDirectoryEntry('src', true),
        ];
      }
      if (directoryPath === documentationDirectory) {
        return [createDirectoryEntry('build', true)];
      }
      if (directoryPath === buildDocumentationDirectory) {
        return [createDirectoryEntry('foo.md', false)];
      }
      if (directoryPath === sourceDirectory) {
        return [createDirectoryEntry('index.ts', false)];
      }
      return [];
    }),
    lstat: async (candidatePath) => createStats(
      candidatePath === documentationDirectory
        || candidatePath === buildDocumentationDirectory
        || candidatePath === sourceDirectory
        || candidatePath === gitDirectory
        || candidatePath === nodeModulesDirectory,
      0o754,
    ),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const tree = await service.listProjectFiles('project-1', { respectGitignore: true });

  assert.deepEqual(tree.map((entry) => entry.name), ['docs', 'src', 'README.md']);
  const documentationEntry = tree[0];
  assert.deepEqual(documentationEntry?.children?.map((entry) => entry.name), ['build']);
  assert.deepEqual(documentationEntry?.children?.[0]?.children?.map((entry) => entry.name), ['foo.md']);
  const sourceEntry = tree[1];
  assert.ok(sourceEntry);
  assert.equal(sourceEntry.type, 'directory');
  assert.equal(sourceEntry.permissions, '754');
  assert.equal(sourceEntry.permissionsRwx, 'rwxr-xr--');
  assert.deepEqual(sourceEntry.children?.map((entry) => entry.name), ['index.ts']);
  assert.equal(readDirectories.includes(gitDirectory), false);
  assert.equal(readDirectories.includes(nodeModulesDirectory), false);
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

test('listProjectFiles falls back to conventional directory names when no gitignore exists', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const documentationDirectory = path.join(projectRoot, 'docs');
  const buildDocumentationDirectory = path.join(documentationDirectory, 'build');
  const nodeModulesDirectory = path.join(projectRoot, 'node_modules');
  const readDirectories: string[] = [];
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readTextFile: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    openDirectory: createDirectoryReader((directoryPath) => {
      readDirectories.push(directoryPath);
      if (directoryPath === projectRoot) {
        return [
          createDirectoryEntry('debug.log', false),
          createDirectoryEntry('docs', true),
          createDirectoryEntry('node_modules', true),
        ];
      }
      if (directoryPath === documentationDirectory) {
        return [
          createDirectoryEntry('build', true),
          createDirectoryEntry('guide.md', false),
        ];
      }
      if (directoryPath === buildDocumentationDirectory) {
        return [createDirectoryEntry('generated.md', false)];
      }
      return [];
    }),
    lstat: async (candidatePath) => createStats(candidatePath === documentationDirectory, 0o644),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const tree = await service.listProjectFiles('project-1', { respectGitignore: true });

  assert.deepEqual(tree.map((entry) => entry.name), ['docs', 'debug.log']);
  assert.deepEqual(tree[0]?.children?.map((entry) => entry.name), ['guide.md']);
  assert.equal(readDirectories.includes(nodeModulesDirectory), false);
  assert.equal(readDirectories.includes(buildDocumentationDirectory), false);
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

test('readTextFile reports a directory as a client error, not a 500', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const fileSystem = createFakeFileSystem({
    ...createRealPathFakes(),
    readTextFile: async () => {
      const error = new Error('EISDIR: illegal operation on a directory, read');
      (error as NodeJS.ErrnoException).code = 'EISDIR';
      throw error;
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.readTextFile('project-1', 'decisions'),
    (error: unknown) => error instanceof AppError
      && error.code === 'EISDIR'
      && error.statusCode === 400
      && error.message === 'Path is a directory, not a file',
  );
});

test('createEntry performs filesystem mutation only through the injected adapter', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const targetPath = path.join(projectRoot, 'notes.txt');
  const writtenFiles: Array<{ filePath: string; content: string }> = [];
  const fileSystem = createFakeFileSystem({
    ...createRealPathFakes({ missing: [targetPath] }),
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

test('storeUploadedFiles accepts the project root itself as the target directory', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const copiedFiles: Array<{ source: string; destination: string }> = [];
  const fileSystem = createFakeFileSystem({
    ...createRealPathFakes({ missing: [path.join(projectRoot, 'notes.txt')] }),
    access: async () => undefined,
    copyFile: async (source, destination) => {
      copiedFiles.push({ source, destination });
    },
    unlink: async () => undefined,
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  // A drop onto a root-level file targets its parent, which the client sends
  // as the root's absolute path; a trailing separator must not change that.
  for (const targetPath of [projectRoot, projectRoot + path.sep]) {
    copiedFiles.length = 0;

    const result = await service.storeUploadedFiles({
      projectId: 'project-1',
      targetPath,
      relativePaths: [],
      requestedFileCount: 1,
      files: [{ originalName: 'notes.txt', temporaryPath: '/tmp/upload-notes', size: 3, mimeType: 'text/plain' }],
    });

    assert.equal(result.targetPath, projectRoot);
    assert.equal(result.uploadedCount, 1);
    assert.deepEqual(copiedFiles, [
      { source: '/tmp/upload-notes', destination: path.join(projectRoot, 'notes.txt') },
    ]);
  }
});

test('storeUploadedFiles still rejects a target directory outside the project root', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const copiedFiles: string[] = [];
  const removedTemporaryFiles: string[] = [];
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    copyFile: async (_source, destination) => {
      copiedFiles.push(destination);
    },
    unlink: async (filePath) => {
      removedTemporaryFiles.push(filePath);
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  for (const targetPath of [path.dirname(projectRoot), `${projectRoot}-sibling`, '..']) {
    await assert.rejects(
      service.storeUploadedFiles({
        projectId: 'project-1',
        targetPath,
        relativePaths: [],
        requestedFileCount: 1,
        files: [{ originalName: 'notes.txt', temporaryPath: '/tmp/upload-notes', size: 3, mimeType: 'text/plain' }],
      }),
      (error: unknown) => error instanceof AppError
        && error.code === 'PATH_OUTSIDE_PROJECT'
        && error.statusCode === 403,
    );
  }
  assert.deepEqual(copiedFiles, []);
  assert.deepEqual(removedTemporaryFiles, ['/tmp/upload-notes', '/tmp/upload-notes', '/tmp/upload-notes']);
});

test('a project at the filesystem root still contains its own children', async () => {
  // A transcript recorded from `/` (or `C:\` on Windows) registers a project
  // there; a separator-suffixed prefix check put every child outside it.
  const projectRoot = path.parse(path.resolve('file-tree-test-project')).root;
  const readPaths: string[] = [];
  const fileSystem = createFakeFileSystem({
    ...createRealPathFakes(),
    readTextFile: async (filePath) => {
      readPaths.push(filePath);
      return 'root-level note';
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const result = await service.readTextFile('project-1', 'notes.txt');

  assert.equal(result.path, path.join(projectRoot, 'notes.txt'));
  assert.deepEqual(readPaths, [path.join(projectRoot, 'notes.txt')]);
});

test('entry operations refuse a symlink that leads out of the project', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const outsideDirectory = path.resolve('file-tree-test-outside');
  const fileSystem = createFakeFileSystem({
    ...createRealPathFakes({
      links: {
        [path.join(projectRoot, 'link')]: outsideDirectory,
        [path.join(projectRoot, 'secret-link')]: path.join(outsideDirectory, 'secret.txt'),
      },
    }),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  // No other adapter call is expected: the containment check runs first.
  const operations: Array<[string, () => Promise<unknown>]> = [
    ['read through a linked directory', () => service.readTextFile('project-1', 'link/secret.txt')],
    ['read a linked file', () => service.readTextFile('project-1', 'secret-link')],
    ['open a linked file', () => service.openFile('project-1', 'secret-link')],
    ['save a linked file', () => service.saveTextFile('project-1', 'secret-link', 'overwritten')],
    ['create under a linked directory', () => service.createEntry({
      projectId: 'project-1', parentPath: 'link', type: 'file', name: 'planted.txt',
    })],
    ['delete through a linked directory', () => service.deleteEntry({
      projectId: 'project-1', targetPath: 'link/secret.txt',
    })],
    ['rename through a linked directory', () => service.renameEntry({
      projectId: 'project-1', oldPath: 'link/secret.txt', newName: 'renamed.txt',
    })],
  ];
  for (const [label, operation] of operations) {
    await assert.rejects(
      operation,
      (error: unknown) => error instanceof AppError
        && error.code === 'PATH_OUTSIDE_PROJECT'
        && error.statusCode === 403,
      label,
    );
  }
});

test('a dangling symlink is refused before anything is written through it', async () => {
  // Writing through a link whose target is missing would create that target —
  // wherever the link points — so the resolver must not treat it as a path
  // that merely does not exist yet.
  const projectRoot = path.resolve('file-tree-test-project');
  const danglingPath = path.join(projectRoot, 'notes.txt');
  const fileSystem = createFakeFileSystem(createRealPathFakes({ dangling: [danglingPath] }));
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const isRefusal = (error: unknown) => error instanceof AppError
    && error.code === 'SYMLINK_TARGET_MISSING'
    && error.statusCode === 403;
  await assert.rejects(service.saveTextFile('project-1', 'notes.txt', 'planted'), isRefusal);
  await assert.rejects(
    service.createEntry({ projectId: 'project-1', parentPath: projectRoot, type: 'file', name: 'notes.txt' }),
    isRefusal,
  );
});

test('a symlink that stays inside the project, and a project root that is one, are accepted', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const realProjectRoot = path.resolve('file-tree-test-project-real');
  const readPaths: string[] = [];
  const fileSystem = createFakeFileSystem({
    ...createRealPathFakes({
      links: {
        [projectRoot]: realProjectRoot,
        [path.join(projectRoot, 'internal')]: path.join(realProjectRoot, 'lib'),
      },
    }),
    readTextFile: async (filePath) => {
      readPaths.push(filePath);
      return 'inner';
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const result = await service.readTextFile('project-1', 'internal/inner.txt');

  // The spelled path comes back and reaches the adapter: it is the path the
  // tree shows, not where it really lives.
  assert.equal(result.path, path.join(projectRoot, 'internal', 'inner.txt'));
  assert.deepEqual(readPaths, [path.join(projectRoot, 'internal', 'inner.txt')]);
});

test('delete and rename act on an escaping link by name, so a planted one can be removed', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const linkPath = path.join(projectRoot, 'link');
  const danglingPath = path.join(projectRoot, 'dangling');
  const unlinkedPaths: string[] = [];
  const renames: Array<[string, string]> = [];
  const fileSystem = createFakeFileSystem({
    ...createRealPathFakes({
      links: { [linkPath]: path.resolve('file-tree-test-outside') },
      dangling: [danglingPath],
    }),
    // The links themselves are there; the renamed-to names are not.
    lstat: async (candidatePath) => {
      if (candidatePath === linkPath || candidatePath === danglingPath) {
        return createStats(false, 0o777);
      }
      throw createErrnoError('ENOENT', candidatePath);
    },
    access: async (candidatePath) => {
      throw createErrnoError('ENOENT', candidatePath);
    },
    unlink: async (filePath) => {
      unlinkedPaths.push(filePath);
    },
    rename: async (oldPath, newPath) => {
      renames.push([oldPath, newPath]);
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await service.deleteEntry({ projectId: 'project-1', targetPath: 'link' });
  await service.deleteEntry({ projectId: 'project-1', targetPath: 'dangling' });
  await service.renameEntry({ projectId: 'project-1', oldPath: 'link', newName: 'link-renamed' });
  await service.renameEntry({ projectId: 'project-1', oldPath: 'dangling', newName: 'dangling-renamed' });

  // Unlinked as the links they are, never descended into.
  assert.deepEqual(unlinkedPaths, [linkPath, danglingPath]);
  assert.deepEqual(renames, [
    [linkPath, path.join(projectRoot, 'link-renamed')],
    [danglingPath, path.join(projectRoot, 'dangling-renamed')],
  ]);
});

test('delete and rename refuse the project root itself before touching the filesystem', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const service = createFileTreeService(createDependencies(createFakeFileSystem(), projectRoot));

  const isRefusal = (error: unknown) => error instanceof AppError
    && error.code === 'PATH_OUTSIDE_PROJECT'
    && error.statusCode === 403;
  for (const targetPath of ['', '.', projectRoot, projectRoot + path.sep, 'sub/..']) {
    await assert.rejects(service.deleteEntry({ projectId: 'project-1', targetPath }), isRefusal, targetPath);
    await assert.rejects(
      service.renameEntry({ projectId: 'project-1', oldPath: targetPath, newName: 'renamed' }),
      isRefusal,
      targetPath,
    );
  }
});

test('storeUploadedFiles refuses a target directory that leads out of the project', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const copiedFiles: string[] = [];
  const removedTemporaryFiles: string[] = [];
  const fileSystem = createFakeFileSystem({
    ...createRealPathFakes({ links: { [path.join(projectRoot, 'link')]: path.resolve('file-tree-test-outside') } }),
    copyFile: async (_source, destination) => {
      copiedFiles.push(destination);
    },
    unlink: async (filePath) => {
      removedTemporaryFiles.push(filePath);
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.storeUploadedFiles({
      projectId: 'project-1',
      targetPath: 'link',
      relativePaths: [],
      requestedFileCount: 1,
      files: [{ originalName: 'notes.txt', temporaryPath: '/tmp/upload-notes', size: 3, mimeType: 'text/plain' }],
    }),
    (error: unknown) => error instanceof AppError
      && error.code === 'PATH_OUTSIDE_PROJECT'
      && error.statusCode === 403,
  );
  assert.deepEqual(copiedFiles, []);
  assert.deepEqual(removedTemporaryFiles, ['/tmp/upload-notes']);
});

test('storeUploadedFiles skips a file whose destination leads out of the project', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const outsideDirectory = path.resolve('file-tree-test-outside');
  const copiedFiles: string[] = [];
  const removedTemporaryFiles: string[] = [];
  const fileSystem = createFakeFileSystem({
    ...createRealPathFakes({
      links: {
        [path.join(projectRoot, 'link')]: outsideDirectory,
        [path.join(projectRoot, 'secret-link')]: path.join(outsideDirectory, 'secret.txt'),
      },
      // A folder upload's nested directories do not exist yet on either side.
      missing: [path.join(projectRoot, 'link', 'deep')],
      dangling: [path.join(projectRoot, 'dangling')],
    }),
    access: async () => undefined,
    copyFile: async (_source, destination) => {
      copiedFiles.push(destination);
    },
    unlink: async (filePath) => {
      removedTemporaryFiles.push(filePath);
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  // A refused destination is skipped, not fatal, exactly as a traversal in a
  // relative path is today: the response reports fewer files than requested.
  for (const [relativePath, originalName] of [
    ['link/deep/planted.txt', 'planted.txt'],
    ['secret-link', 'secret-link'],
    ['dangling', 'dangling'],
  ]) {
    removedTemporaryFiles.length = 0;

    const result = await service.storeUploadedFiles({
      projectId: 'project-1',
      targetPath: projectRoot,
      relativePaths: [relativePath],
      requestedFileCount: 1,
      files: [{ originalName, temporaryPath: '/tmp/upload-notes', size: 3, mimeType: 'text/plain' }],
    });

    assert.equal(result.uploadedCount, 0, relativePath);
    assert.equal(result.requestedFileCount, 1);
    assert.deepEqual(removedTemporaryFiles, ['/tmp/upload-notes'], relativePath);
  }
  assert.deepEqual(copiedFiles, []);
});

test('a symlink loop, a file used as a directory or a vanished root is reported as not found, not a 500', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const isNotFound = (error: unknown) => error instanceof AppError
    && error.statusCode === 404
    && error.message === 'File or directory not found';

  for (const code of ['ELOOP', 'ENOTDIR']) {
    const fileSystem = createFakeFileSystem({
      realpath: async (candidatePath) => {
        if (candidatePath === projectRoot) return candidatePath;
        throw createErrnoError(code, candidatePath);
      },
    });
    const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

    await assert.rejects(service.readTextFile('project-1', 'loop/notes.txt'), isNotFound, code);
  }

  // Nothing along the path exists, up to and including the filesystem root
  // (an unplugged drive on Windows): the walk ends there and the operation
  // reads as a missing entry.
  const fileSystem = createFakeFileSystem({
    realpath: async (candidatePath) => {
      throw createErrnoError('ENOENT', candidatePath);
    },
    lstat: async (candidatePath) => {
      throw createErrnoError('ENOENT', candidatePath);
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(service.readTextFile('project-1', 'notes.txt'), isNotFound, 'ENOENT');
});
