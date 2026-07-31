import { randomUUID } from 'node:crypto';
import fs, { promises as fsPromises } from 'node:fs';
import os from 'node:os';

import mime from 'mime-types';
import multer from 'multer';

import { projectsDb } from '@/modules/database/index.js';
import { createFileTreeRouter } from '@/modules/file-tree/file-tree.routes.js';
import { createFileTreeService } from '@/modules/file-tree/file-tree.service.js';
import type {
  FileTreeFileSystem,
  FileTreeLogger,
  FileTreeProjectGateway,
  FileTreeWorkspaceGateway,
} from '@/shared/types.js';
import { WORKSPACES_ROOT, validateWorkspacePath } from '@/shared/utils.js';

const MAXIMUM_UPLOAD_SIZE_MEGABYTES = 200;
const MAXIMUM_UPLOAD_SIZE_BYTES = MAXIMUM_UPLOAD_SIZE_MEGABYTES * 1024 * 1024;
const MAXIMUM_UPLOAD_FILE_COUNT = 20;

function readFileSystemConcurrency(): number {
  const configuredConcurrency = Number.parseInt(process.env.FS_CONCURRENCY ?? '', 10);
  return Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
    ? configuredConcurrency
    : 64;
}

/**
 * Production filesystem adapter owned by the File Tree composition root.
 * Application services receive this complete capability explicitly and never
 * import Node's mutable filesystem APIs themselves.
 */
const fileTreeFileSystem: FileTreeFileSystem = {
  access: (candidatePath) => fsPromises.access(candidatePath),
  stat: (candidatePath) => fsPromises.stat(candidatePath),
  lstat: (candidatePath) => fsPromises.lstat(candidatePath),
  readdir: (directoryPath) => fsPromises.readdir(directoryPath, { withFileTypes: true }),
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
  copyFile: (sourcePath, destinationPath) => fsPromises.copyFile(sourcePath, destinationPath),
  createReadStream: (filePath) => fs.createReadStream(filePath),
};

/**
 * Database boundary used only by File Tree production composition.
 * The Database module is consumed through its barrel; services and routes see
 * only the narrow project-path lookup contract.
 */
const fileTreeProjects: FileTreeProjectGateway = {
  getProjectPathById: (projectId) => projectsDb.getProjectPathById(projectId),
};

/**
 * Workspace-policy boundary used only by File Tree production composition.
 * Keeping both the configured root and symlink-aware validator together makes
 * the path policy explicit for every service instance.
 */
const fileTreeWorkspace: FileTreeWorkspaceGateway = {
  rootPath: WORKSPACES_ROOT,
  validatePath: (candidatePath) => validateWorkspacePath(candidatePath),
};

const fileTreeLogger: FileTreeLogger = {
  error: (message, error) => console.error(message, error),
};

const fileTreeServices = createFileTreeService({
  fileSystem: fileTreeFileSystem,
  projects: fileTreeProjects,
  workspace: fileTreeWorkspace,
  resolveMimeType: (filePath) => mime.lookup(filePath) || 'application/octet-stream',
  fileSystemConcurrency: readFileSystemConcurrency(),
  logger: fileTreeLogger,
});

const fileUploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_request, _file, callback) => {
      callback(null, `cloudcli-file-upload-${randomUUID()}`);
    },
  }),
  limits: {
    fileSize: MAXIMUM_UPLOAD_SIZE_BYTES,
    files: MAXIMUM_UPLOAD_FILE_COUNT,
  },
}).array('files', MAXIMUM_UPLOAD_FILE_COUNT);

/**
 * File Tree router used by the server entrypoint to mount the authenticated
 * browsing, editing, file-management, and upload API under `/api/file-tree`.
 */
export const fileTreeRoutes = createFileTreeRouter(
  fileTreeServices,
  fileUploadMiddleware,
  {
    maximumFileSizeMegabytes: MAXIMUM_UPLOAD_SIZE_MEGABYTES,
    maximumFileCount: MAXIMUM_UPLOAD_FILE_COUNT,
  },
  fileTreeLogger,
);
