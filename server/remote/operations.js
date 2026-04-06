/**
 * ProjectOperations abstraction layer — the strategy-pattern interface that
 * allows routes to work transparently with local or remote projects.
 *
 * This module defines JSDoc typedefs for the full operations contract
 * (filesystem, git, and terminal) and exports the `getOperationsForProject`
 * factory that returns the appropriate implementation.
 *
 * @module remote/operations
 */

import { resolveProject } from './project-resolver.js';

// ────────────────────────────────────────────────────────────────────────────
// Type definitions
// ────────────────────────────────────────────────────────────────────────────

/**
 * A node in the file tree (file or directory with optional children).
 * @typedef {object} FileTreeNode
 * @property {string} name
 * @property {string} path
 * @property {'file' | 'directory'} type
 * @property {number} size
 * @property {string | null} modified - ISO-8601 timestamp or null
 * @property {string} permissions - Octal string e.g. "644"
 * @property {string} permissionsRwx - rwx string e.g. "rw-r--r--"
 * @property {FileTreeNode[]} [children]
 */

/**
 * A single entry from `git status --porcelain`.
 * @typedef {object} GitStatusEntry
 * @property {string} filePath
 * @property {string} status - Porcelain code: 'M', 'A', '??', 'D', 'R', 'C', 'U'
 * @property {boolean} staged
 * @property {boolean} isNew
 */

/**
 * A per-file diff with hunks.
 * @typedef {object} DiffEntry
 * @property {string} filePath
 * @property {string} status
 * @property {Array<{header: string, lines: string[]}>} hunks
 * @property {string | null} oldContent
 * @property {string | null} newContent
 */

/**
 * A single commit from the log.
 * @typedef {object} GitCommitEntry
 * @property {string} hash
 * @property {string} shortHash
 * @property {string} author
 * @property {string} date
 * @property {string} message
 */

/**
 * A branch entry (local or remote).
 * @typedef {object} GitBranchEntry
 * @property {string} name
 * @property {boolean} isCurrent
 * @property {boolean} isRemote
 * @property {string | null} tracking
 */

/**
 * Options for spawning a pseudo-terminal shell.
 * @typedef {object} ShellOptions
 * @property {number} cols
 * @property {number} rows
 * @property {string} cwd
 * @property {object} env
 * @property {string} shell
 */

/**
 * Handle to an active shell session.
 * @typedef {object} ShellSession
 * @property {(data: string) => void} write
 * @property {(cols: number, rows: number) => void} resize
 * @property {(handler: (data: string) => void) => void} onData
 * @property {(handler: (exitInfo: {exitCode: number, signal?: number}) => void) => void} onExit
 * @property {() => void} kill
 * @property {number | null} pid
 */

/**
 * The full operations contract. Every method is async and works identically
 * whether backed by the local filesystem or a remote daemon over SSH.
 *
 * **Filesystem methods** (ABS-01):
 * @property {(dirPath: string, options?: {maxDepth?: number, showHidden?: boolean}) => Promise<FileTreeNode[]>} listFiles
 * @property {(filePath: string) => Promise<string>} readFile
 * @property {(filePath: string) => Promise<Buffer>} readFileBinary
 * @property {(filePath: string, content: string) => Promise<void>} writeFile
 * @property {(parentPath: string, name: string, type: 'file' | 'directory') => Promise<{path: string, name: string, type: string}>} createItem
 * @property {(oldPath: string, newName: string) => Promise<{oldPath: string, newPath: string, newName: string}>} renameItem
 * @property {(targetPath: string) => Promise<void>} deleteItem
 * @property {(targetPath: string) => Promise<{size: number, modified: string, type: string, permissions: string, permissionsRwx: string}>} stat
 * @property {(targetPath: string) => Promise<boolean>} exists
 *
 * **Git methods** (ABS-02 — interface defined here; implementations come when
 * routes are migrated to use ProjectOperations):
 * @property {(projectPath: string) => Promise<GitStatusEntry[]>} getGitStatus
 * @property {(projectPath: string, options?: {staged?: boolean, filePath?: string}) => Promise<DiffEntry[]>} getDiff
 * @property {(projectPath: string, options?: {limit?: number, skip?: number}) => Promise<GitCommitEntry[]>} getLog
 * @property {(projectPath: string) => Promise<GitBranchEntry[]>} getBranches
 * @property {(projectPath: string, branch: string) => Promise<{branch: string}>} checkoutBranch
 * @property {(projectPath: string, branch: string) => Promise<{branch: string}>} createBranch
 * @property {(projectPath: string, branch: string, options?: {force?: boolean}) => Promise<void>} deleteBranch
 * @property {(projectPath: string, filePaths: string[]) => Promise<void>} stage
 * @property {(projectPath: string, filePaths: string[]) => Promise<void>} unstage
 * @property {(projectPath: string, message: string, filePaths?: string[]) => Promise<{hash: string, message: string}>} commit
 * @property {(projectPath: string, filePaths: string[]) => Promise<void>} discardChanges
 * @property {(projectPath: string, options?: {remote?: string, branch?: string, setUpstream?: boolean}) => Promise<{stdout: string}>} push
 * @property {(projectPath: string, options?: {remote?: string, branch?: string}) => Promise<{stdout: string}>} pull
 * @property {(projectPath: string, options?: {remote?: string}) => Promise<void>} fetch
 *
 * **Terminal methods** (ABS-03):
 * @property {(options: ShellOptions) => Promise<ShellSession>} spawnShell
 *
 * @typedef {object} ProjectOperations
 */

// ────────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a project name and return the matching operations implementation.
 *
 * @param {string} projectName - Local project name or `remote:<hostId>:<base64Path>`
 * @returns {Promise<{ops: ProjectOperations, projectRoot: string, isRemote: boolean, hostId?: string}>}
 */
export async function getOperationsForProject(projectName) {
  const resolved = await resolveProject(projectName);

  if (!resolved.isRemote) {
    const { localOperations } = await import('./local-operations.js');
    return { ops: localOperations, projectRoot: resolved.localPath, isRemote: false };
  }

  // Ensure SSH connection is established before creating remote operations
  try {
    const { ensureConnection } = await import('./connection-manager.js');
    await ensureConnection(resolved.hostId);
  } catch (err) {
    const connErr = new Error(`Remote host not connected: ${err.message}`);
    connErr.code = 'ECONNREFUSED';
    throw connErr;
  }

  // Dynamic import — remote-operations.js is created in Plan 03.
  try {
    const { createRemoteOperations } = await import('./remote-operations.js');
    return {
      ops: createRemoteOperations(resolved.hostId),
      projectRoot: resolved.remotePath,
      isRemote: true,
      hostId: resolved.hostId,
    };
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('Remote operations not yet available');
    }
    throw err;
  }
}
