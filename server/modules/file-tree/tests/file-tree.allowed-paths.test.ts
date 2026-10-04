import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { createFileTreeService } from '@/modules/file-tree/file-tree.service.js';
import type { FileTreeServices } from '@/shared/types.js';
import { AppError, isPathAllowed, listAllowedPathChildren } from '@/shared/utils.js';

const fixtureRoot = await fsPromises.realpath(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'file-tree-allowed-')));
const workDirectory = path.join(fixtureRoot, 'work');
const allowedDirectory = path.join(workDirectory, 'allowed');
const insideProjectRoot = path.join(allowedDirectory, 'proj-in');
const outsideDirectory = path.join(workDirectory, 'outside');
const outsideProjectRoot = path.join(outsideDirectory, 'proj-out');
const secretFilePath = path.join(outsideProjectRoot, 'secret.txt');
await fsPromises.mkdir(insideProjectRoot, { recursive: true });
await fsPromises.mkdir(outsideProjectRoot, { recursive: true });
await fsPromises.mkdir(path.join(workDirectory, 'allowed10'), { recursive: true });
// An existing folder whose allowed child was mistyped and never existed.
const serviceDirectory = path.join(fixtureRoot, 'srv');
const missingAllowedDirectory = path.join(serviceDirectory, 'specifc');
await fsPromises.mkdir(serviceDirectory, { recursive: true });
await fsPromises.writeFile(path.join(insideProjectRoot, 'inside.txt'), 'inside', 'utf8');
await fsPromises.writeFile(secretFilePath, 'secret', 'utf8');
// A link inside the allowed project that points at the outside project.
await fsPromises.symlink(outsideProjectRoot, path.join(insideProjectRoot, 'escape'));

const allowedPaths = [allowedDirectory];
const projectRootsById: Record<string, string> = {
  inside: insideProjectRoot,
  outside: outsideProjectRoot,
};

after(async () => {
  await fsPromises.rm(fixtureRoot, { recursive: true, force: true });
});

/**
 * Builds the service on the real filesystem with the real ALLOWED_PATHS
 * helpers bound to an explicit list, so the test does not depend on the
 * environment the suite runs in.
 */
function createService(rootPath: string, allowedPathList: string[] = allowedPaths): FileTreeServices {
  return createFileTreeService({
    fileSystem: {
      access: (candidatePath) => fsPromises.access(candidatePath),
      stat: (candidatePath) => fsPromises.stat(candidatePath),
      lstat: (candidatePath) => fsPromises.lstat(candidatePath),
      openDirectory: async function* (directoryPath) {
        yield* await fsPromises.opendir(directoryPath);
      },
      realpath: (candidatePath) => fsPromises.realpath(candidatePath),
      readTextFile: (filePath) => fsPromises.readFile(filePath, 'utf8'),
      writeTextFile: (filePath, content) => fsPromises.writeFile(filePath, content, 'utf8'),
      async makeDirectory(directoryPath, recursive) {
        await fsPromises.mkdir(directoryPath, { recursive });
      },
      rename: (oldPath, newPath) => fsPromises.rename(oldPath, newPath),
      async removeDirectory(directoryPath) {
        await fsPromises.rm(directoryPath, { recursive: true, force: true });
      },
      unlink: (filePath) => fsPromises.unlink(filePath),
      copyFile: (source, destination) => fsPromises.copyFile(source, destination),
      createReadStream: (filePath) => createReadStream(filePath),
    },
    projects: { getProjectPathById: async (projectId) => projectRootsById[projectId] ?? null },
    workspace: {
      rootPath,
      // Stands in for `validateWorkspacePath`, whose ALLOWED_PATHS check is
      // covered by the shared tests; only the allowed-paths outcome matters here.
      validatePath: async (candidatePath) => (await isPathAllowed(candidatePath, allowedPathList)
        ? { valid: true, resolvedPath: candidatePath }
        : { valid: false, error: 'outside ALLOWED_PATHS', errorCode: 'PATH_NOT_ALLOWED' }),
      resolveReadOnlyRootPath: async () => null,
      allowedPaths: allowedPathList,
      isPathAllowed: (candidatePath) => isPathAllowed(candidatePath, allowedPathList),
      listAllowedPathChildren: (directoryPath) => listAllowedPathChildren(directoryPath, allowedPathList),
    },
    resolveMimeType: () => 'text/plain',
    fileSystemConcurrency: 4,
    logger: { error: () => undefined },
  });
}

function isPathNotAllowedError(error: unknown): boolean {
  return error instanceof AppError && error.statusCode === 403 && error.code === 'PATH_NOT_ALLOWED';
}

async function createUploadedFile(name: string) {
  const temporaryPath = path.join(fixtureRoot, `upload-${name}-${Date.now()}`);
  await fsPromises.writeFile(temporaryPath, 'uploaded', 'utf8');
  return { originalName: name, temporaryPath, size: 8, mimeType: 'text/plain' };
}

test('every file operation on a project outside ALLOWED_PATHS answers 403', async () => {
  const service = createService(workDirectory);
  const upload = await createUploadedFile('a.txt');

  const operations: Array<[string, () => Promise<unknown>]> = [
    ['readTextFile', () => service.readTextFile('outside', 'secret.txt')],
    ['openFile', () => service.openFile('outside', 'secret.txt')],
    ['listProjectFiles', () => service.listProjectFiles('outside')],
    ['saveTextFile', () => service.saveTextFile('outside', 'secret.txt', 'overwritten')],
    ['createEntry', () => service.createEntry({ projectId: 'outside', parentPath: '', type: 'file', name: 'new.txt' })],
    ['renameEntry', () => service.renameEntry({ projectId: 'outside', oldPath: 'secret.txt', newName: 'renamed.txt' })],
    ['deleteEntry', () => service.deleteEntry({ projectId: 'outside', targetPath: 'secret.txt' })],
    ['storeUploadedFiles', () => service.storeUploadedFiles({
      projectId: 'outside',
      targetPath: '',
      relativePaths: [],
      requestedFileCount: 1,
      files: [upload],
    })],
  ];

  for (const [name, operation] of operations) {
    await assert.rejects(operation(), isPathNotAllowedError, name);
  }

  assert.equal(await fsPromises.readFile(secretFilePath, 'utf8'), 'secret');
  await assert.rejects(fsPromises.access(path.join(outsideProjectRoot, 'new.txt')));
  await assert.rejects(fsPromises.access(path.join(outsideProjectRoot, 'a.txt')));
});

test('files inside an allowed project are read and written as before', async () => {
  const service = createService(workDirectory);

  assert.equal((await service.readTextFile('inside', 'inside.txt')).content, 'inside');
  await service.saveTextFile('inside', 'notes.txt', 'hello');
  assert.equal(await fsPromises.readFile(path.join(insideProjectRoot, 'notes.txt'), 'utf8'), 'hello');
  const tree = await service.listProjectFiles('inside');
  assert.ok(tree.some((node) => node.name === 'inside.txt'));
});

test('a symlink inside an allowed project cannot read, write, or delete outside it', async () => {
  const service = createService(workDirectory);
  const upload = await createUploadedFile('b.txt');

  await assert.rejects(service.readTextFile('inside', 'escape/secret.txt'), isPathNotAllowedError);
  await assert.rejects(service.openFile('inside', 'escape/secret.txt'), isPathNotAllowedError);
  await assert.rejects(service.saveTextFile('inside', 'escape/written.txt', 'x'), isPathNotAllowedError);
  await assert.rejects(
    service.createEntry({ projectId: 'inside', parentPath: 'escape', type: 'file', name: 'created.txt' }),
    isPathNotAllowedError,
  );
  await assert.rejects(
    service.renameEntry({ projectId: 'inside', oldPath: 'escape/secret.txt', newName: 'moved.txt' }),
    isPathNotAllowedError,
  );
  await assert.rejects(
    service.deleteEntry({ projectId: 'inside', targetPath: 'escape/secret.txt' }),
    isPathNotAllowedError,
  );
  await assert.rejects(service.storeUploadedFiles({
    projectId: 'inside',
    targetPath: 'escape',
    relativePaths: [],
    requestedFileCount: 1,
    files: [upload],
  }), isPathNotAllowedError);

  assert.equal(await fsPromises.readFile(secretFilePath, 'utf8'), 'secret');
  for (const fileName of ['written.txt', 'created.txt', 'moved.txt', 'b.txt']) {
    await assert.rejects(fsPromises.access(path.join(outsideProjectRoot, fileName)), fileName);
  }
});

test('an upload whose relative path climbs through a symlink is skipped, not written outside', async () => {
  const service = createService(workDirectory);
  const upload = await createUploadedFile('c.txt');

  const result = await service.storeUploadedFiles({
    projectId: 'inside',
    targetPath: '',
    relativePaths: ['escape/c.txt'],
    requestedFileCount: 1,
    files: [upload],
  });

  assert.equal(result.uploadedCount, 0);
  await assert.rejects(fsPromises.access(path.join(outsideProjectRoot, 'c.txt')));
  await assert.rejects(fsPromises.access(upload.temporaryPath));
});

test('the folder picker walks from an ancestor down to the allowed directory only', async () => {
  const service = createService(fixtureRoot);

  // `~` is the workspace root, an ancestor here: only the way down is listed.
  assert.deepEqual(await service.browseWorkspace('~'), {
    path: fixtureRoot,
    suggestions: [{ path: workDirectory, name: 'work', type: 'directory' }],
  });
  assert.deepEqual(await service.browseWorkspace(workDirectory), {
    path: workDirectory,
    suggestions: [{ path: allowedDirectory, name: 'allowed', type: 'directory' }],
  });

  const allowedListing = await service.browseWorkspace(allowedDirectory);
  assert.equal(allowedListing.path, allowedDirectory);
  assert.deepEqual(allowedListing.suggestions.map((suggestion) => suggestion.name), ['proj-in']);

  await assert.rejects(service.browseWorkspace(outsideDirectory), (error: unknown) => (
    error instanceof AppError && error.statusCode === 403
  ));
  await assert.rejects(service.browseWorkspace(path.join(workDirectory, 'allowed10')), (error: unknown) => (
    error instanceof AppError && error.statusCode === 403
  ));
});

test('the folder picker opens at the first allowed directory when the root does not lead to one', async () => {
  const service = createService(outsideDirectory);

  const listing = await service.browseWorkspace('~');
  assert.equal(listing.path, allowedDirectory);
  assert.deepEqual(listing.suggestions.map((suggestion) => suggestion.name), ['proj-in']);
});

test('the folder picker skips an allowed directory that does not exist instead of opening at an error', async () => {
  // A missing first entry: the picker opens at the next one that exists.
  const skipping = createService(outsideDirectory, [missingAllowedDirectory, allowedDirectory]);
  assert.equal((await skipping.browseWorkspace('~')).path, allowedDirectory);

  // Nothing exists yet: it opens at the nearest existing folder above it.
  const onlyMissing = createService(outsideDirectory, [missingAllowedDirectory]);
  assert.deepEqual(await onlyMissing.browseWorkspace('~'), { path: serviceDirectory, suggestions: [] });
});

test('a workspace folder can only be created inside ALLOWED_PATHS', async () => {
  const service = createService(workDirectory);

  await assert.rejects(service.createWorkspaceFolder(path.join(outsideDirectory, 'new-folder')), (error: unknown) => (
    error instanceof AppError && error.statusCode === 403
  ));
  await assert.rejects(fsPromises.access(path.join(outsideDirectory, 'new-folder')));

  const created = await service.createWorkspaceFolder(path.join(allowedDirectory, 'new-folder'));
  assert.equal(created.path, path.join(allowedDirectory, 'new-folder'));
  await fsPromises.access(created.path);
});
