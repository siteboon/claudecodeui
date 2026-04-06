/**
 * RemoteOperations factory — creates a ProjectOperations object that delegates
 * all filesystem and git methods to the ccud daemon via JSON-RPC over SSH.
 *
 * Error codes from the daemon's JSON-RPC responses are translated back to
 * Node.js-style fs error codes so that existing route error handlers work
 * identically for both local and remote projects.
 *
 * Git methods delegate to the daemon's git/exec RPC endpoint. Parsing of
 * git command output mirrors LocalOperations exactly so that routes get
 * identical data shapes regardless of local or remote backing.
 *
 * @module remote/remote-operations
 */

import { getConnection } from './connection-manager.js';
import {
  stripDiffHeaders,
  normalizeRepositoryRelativeFilePath,
} from '../utils/git-parsers.js';

// ────────────────────────────────────────────────────────────────────────────
// Error code translation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Maps daemon JSON-RPC error codes to Node.js filesystem error codes.
 * The daemon (ccud/src/handlers/fs.js) uses:
 *   ENOENT -> -32001, EACCES/EPERM -> -32002, EEXIST -> -32003,
 *   ENOTEMPTY -> -32004, ENOSPC -> -32005
 */
const RPC_TO_FS_CODES = {
  '-32001': 'ENOENT',
  '-32002': 'EACCES',
  '-32003': 'EEXIST',
  '-32004': 'ENOTEMPTY',
  '-32005': 'ENOSPC',
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verify that the connection for a given host is active and ready.
 * @param {string} hostId
 * @returns {import('./connection-manager.js').SSHConnectionManager}
 * @throws {Error} With code ECONNREFUSED if not connected
 */
function requireConnection(hostId) {
  const conn = getConnection(hostId);
  if (!conn || !conn.isReady) {
    const err = new Error('Remote host not connected');
    err.code = 'ECONNREFUSED';
    throw err;
  }
  return conn;
}

/**
 * Send a JSON-RPC request through the connection's transport and translate
 * any daemon error codes to Node.js-style fs error codes.
 * @param {import('./connection-manager.js').SSHConnectionManager} conn
 * @param {string} method - RPC method name (e.g. 'fs/readFile')
 * @param {object} params - RPC parameters
 * @returns {Promise<any>}
 */
async function rpcRequest(conn, method, params) {
  try {
    return await conn.transport.request(method, params);
  } catch (err) {
    // SSHTransport throws errors with .code and .message from JSON-RPC error responses
    const fsCode = RPC_TO_FS_CODES[String(err.code)];
    if (fsCode) {
      const fsErr = new Error(err.message);
      fsErr.code = fsCode;
      throw fsErr;
    }
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const COMMIT_DIFF_CHARACTER_LIMIT = 500_000;

// ────────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a ProjectOperations object backed by the ccud daemon on a remote host.
 *
 * All filesystem and git methods delegate to the daemon via JSON-RPC calls
 * through SSHTransport. Error codes are translated so route error handlers
 * work identically to local operations.
 *
 * @param {string} hostId - ID of the remote host (from remote_hosts table)
 * @returns {import('./operations.js').ProjectOperations}
 */
export function createRemoteOperations(hostId) {
  /**
   * Execute a git command on the remote host via the daemon's git/exec RPC.
   * Mirrors spawnGit from git-parsers.js but delegates through SSH.
   * @param {string[]} args - Git command arguments
   * @param {string} cwd - Working directory on the remote host
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async function remoteSpawnGit(args, cwd) {
    const conn = requireConnection(hostId);
    const result = await rpcRequest(conn, 'git/exec', { args, cwd });
    if (result.exitCode !== 0) {
      const err = new Error(result.stderr || result.message || 'git command failed');
      err.code = result.exitCode;
      err.stdout = result.stdout || '';
      err.stderr = result.stderr || '';
      throw err;
    }
    return { stdout: result.stdout || '', stderr: result.stderr || '' };
  }

  /**
   * Validate that a path is inside a git work tree on the remote host.
   * @param {string} projectPath - Path on the remote host
   */
  async function remoteValidateGitRepository(projectPath) {
    try {
      const { stdout } = await remoteSpawnGit(['rev-parse', '--is-inside-work-tree'], projectPath);
      if (stdout.trim() !== 'true') {
        throw new Error('Not inside a git work tree');
      }
    } catch {
      throw new Error('Not a git repository. This directory does not contain a .git folder. Initialize a git repository with "git init" to use source control features.');
    }
  }

  /**
   * Get the current branch name on the remote host.
   * @param {string} projectPath
   * @returns {Promise<string>}
   */
  async function remoteGetCurrentBranchName(projectPath) {
    try {
      const { stdout } = await remoteSpawnGit(['symbolic-ref', '--short', 'HEAD'], projectPath);
      const branchName = stdout.trim();
      if (branchName) return branchName;
    } catch {
      // Fall back to rev-parse for detached HEAD
    }
    const { stdout } = await remoteSpawnGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
    return stdout.trim();
  }

  /**
   * Check whether a remote repository has any commits.
   * @param {string} projectPath
   * @returns {Promise<boolean>}
   */
  async function remoteRepositoryHasCommits(projectPath) {
    try {
      await remoteSpawnGit(['rev-parse', '--verify', 'HEAD'], projectPath);
      return true;
    } catch (error) {
      const errorDetails = `${error?.message || ''} ${error?.stderr || ''} ${error?.stdout || ''}`.toLowerCase();
      const isMissing = errorDetails.includes('unknown revision')
        || errorDetails.includes('ambiguous argument')
        || errorDetails.includes('needed a single revision')
        || errorDetails.includes('bad revision');
      if (isMissing) return false;
      throw error;
    }
  }

  /**
   * Get the repository root path on the remote host.
   * @param {string} projectPath
   * @returns {Promise<string>}
   */
  async function remoteGetRepositoryRootPath(projectPath) {
    const { stdout } = await remoteSpawnGit(['rev-parse', '--show-toplevel'], projectPath);
    return stdout.trim();
  }

  /**
   * Resolve a file path within a remote repository, finding the best match
   * against git status output.
   * @param {string} projectPath
   * @param {string} filePath
   * @returns {Promise<{repositoryRootPath: string, repositoryRelativeFilePath: string}>}
   */
  async function remoteResolveRepositoryFilePath(projectPath, filePath) {
    const repositoryRootPath = await remoteGetRepositoryRootPath(projectPath);
    const normalizedFilePath = normalizeRepositoryRelativeFilePath(filePath);
    const candidates = [normalizedFilePath];

    // Build path candidates (same logic as git-parsers.js buildFilePathCandidates)
    // We need to compute relative path without path.relative since paths are remote
    // For remote, projectPath and repositoryRootPath are both absolute on the remote host
    if (projectPath !== repositoryRootPath && projectPath.startsWith(repositoryRootPath + '/')) {
      const projectRelativePath = normalizeRepositoryRelativeFilePath(
        projectPath.slice(repositoryRootPath.length + 1),
      );
      if (projectRelativePath && projectRelativePath !== '.' && !normalizedFilePath.startsWith(`${projectRelativePath}/`)) {
        candidates.push(`${projectRelativePath}/${normalizedFilePath}`);
      }
    }

    for (const candidateFilePath of candidates) {
      const { stdout } = await remoteSpawnGit(
        ['status', '--porcelain', '--', candidateFilePath],
        repositoryRootPath,
      );
      if (stdout.trim()) {
        return { repositoryRootPath, repositoryRelativeFilePath: candidateFilePath };
      }
    }

    // If the caller sent a bare filename, recover from changed files
    if (!normalizedFilePath.includes('/')) {
      const { stdout: statusOutput } = await remoteSpawnGit(['status', '--porcelain'], repositoryRootPath);
      const changedPaths = statusOutput
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.trim())
        .map(line => {
          const statusPath = line.substring(3);
          const renamed = statusPath.split(' -> ')[1];
          return normalizeRepositoryRelativeFilePath(renamed || statusPath);
        })
        .filter(Boolean);

      const matches = changedPaths.filter(
        p => p === normalizedFilePath || p.endsWith(`/${normalizedFilePath}`),
      );
      if (matches.length === 1) {
        return { repositoryRootPath, repositoryRelativeFilePath: matches[0] };
      }
    }

    return { repositoryRootPath, repositoryRelativeFilePath: candidates[0] };
  }

  const ops = {
    /**
     * List files in a remote directory tree.
     * Daemon fs/readdir returns FileTreeNode[] directly.
     * @param {string} dirPath - Absolute path on the remote host
     * @param {object} [options]
     * @param {number} [options.maxDepth=10]
     * @param {boolean} [options.showHidden=true]
     * @returns {Promise<import('./operations.js').FileTreeNode[]>}
     */
    async listFiles(dirPath, options = {}) {
      const conn = requireConnection(hostId);
      return rpcRequest(conn, 'fs/readdir', {
        path: dirPath,
        maxDepth: options.maxDepth ?? 10,
        showHidden: options.showHidden ?? true,
      });
    },

    /**
     * Read a file's text content from the remote host.
     * Unwraps the { content } envelope from the daemon response.
     * @param {string} filePath - Absolute path on the remote host
     * @returns {Promise<string>}
     */
    async readFile(filePath) {
      const conn = requireConnection(hostId);
      const result = await rpcRequest(conn, 'fs/readFile', { path: filePath });
      return result.content;
    },

    /**
     * Binary file preview is not available for remote projects.
     * JSON-RPC cannot efficiently transfer binary data; deferred per research.
     * @param {string} _filePath
     * @returns {Promise<never>}
     */
    async readFileBinary(_filePath) {
      throw Object.assign(
        new Error('Binary file preview not available for remote projects'),
        { code: 'ENOTSUP' },
      );
    },

    /**
     * Write text content to a file on the remote host.
     * @param {string} filePath - Absolute path on the remote host
     * @param {string} content - UTF-8 text content
     * @returns {Promise<void>}
     */
    async writeFile(filePath, content) {
      const conn = requireConnection(hostId);
      await rpcRequest(conn, 'fs/writeFile', { path: filePath, content });
    },

    /**
     * Create a new file or directory on the remote host.
     * @param {string} parentPath - Directory in which to create the item
     * @param {string} name - Name of the new item
     * @param {'file' | 'directory'} type
     * @returns {Promise<{path: string, name: string, type: string}>}
     */
    async createItem(parentPath, name, type) {
      const conn = requireConnection(hostId);
      return rpcRequest(conn, 'fs/create', { path: parentPath, name, type });
    },

    /**
     * Rename a file or directory on the remote host.
     * @param {string} oldPath - Current absolute path
     * @param {string} newName - New name (not a full path)
     * @returns {Promise<{oldPath: string, newPath: string, newName: string}>}
     */
    async renameItem(oldPath, newName) {
      const conn = requireConnection(hostId);
      return rpcRequest(conn, 'fs/rename', { oldPath, newName });
    },

    /**
     * Delete a file or directory on the remote host.
     * @param {string} targetPath - Absolute path to delete
     * @returns {Promise<void>}
     */
    async deleteItem(targetPath) {
      const conn = requireConnection(hostId);
      await rpcRequest(conn, 'fs/delete', { path: targetPath });
    },

    /**
     * Get file/directory stats from the remote host.
     * @param {string} targetPath - Absolute path
     * @returns {Promise<{size: number, modified: string, type: string, permissions: string, permissionsRwx: string}>}
     */
    async stat(targetPath) {
      const conn = requireConnection(hostId);
      return rpcRequest(conn, 'fs/stat', { path: targetPath });
    },

    /**
     * Check if a path exists on the remote host.
     * Unwraps the { exists } envelope from the daemon response.
     * @param {string} targetPath - Absolute path
     * @returns {Promise<boolean>}
     */
    async exists(targetPath) {
      const conn = requireConnection(hostId);
      const result = await rpcRequest(conn, 'fs/exists', { path: targetPath });
      return result.exists;
    },

    /**
     * Remote shell is handled separately via ssh2 client.shell() channels,
     * not through daemon JSON-RPC. See Plan 04 for implementation.
     * @param {import('./operations.js').ShellOptions} _options
     * @returns {Promise<never>}
     */
    async spawnShell(_options) {
      throw new Error('Remote shell not implemented in remote-operations — use ssh2 client.shell() directly');
    },

    // ────────────────────────────────────────────────────────────────────────
    // Git methods
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Get git status for a remote project.
     * @param {string} projectPath
     * @returns {Promise<{branch: string, hasCommits: boolean, modified: string[], added: string[], deleted: string[], untracked: string[]}>}
     */
    async getGitStatus(projectPath) {
      await remoteValidateGitRepository(projectPath);

      const branch = await remoteGetCurrentBranchName(projectPath);
      const hasCommits = await remoteRepositoryHasCommits(projectPath);

      const { stdout: statusOutput } = await remoteSpawnGit(['status', '--porcelain'], projectPath);

      const modified = [];
      const added = [];
      const deleted = [];
      const untracked = [];

      statusOutput.split('\n').forEach(line => {
        if (!line.trim()) return;

        const status = line.substring(0, 2);
        const file = line.substring(3);

        if (status === 'M ' || status === ' M' || status === 'MM') {
          modified.push(file);
        } else if (status === 'A ' || status === 'AM') {
          added.push(file);
        } else if (status === 'D ' || status === ' D') {
          deleted.push(file);
        } else if (status === '??') {
          untracked.push(file);
        }
      });

      return { branch, hasCommits, modified, added, deleted, untracked };
    },

    /**
     * Get diff for a specific file or commit on the remote host.
     * @param {string} projectPath
     * @param {{ file?: string, commit?: string }} [options]
     * @returns {Promise<{diff: string, isTruncated?: boolean}>}
     */
    async getDiff(projectPath, options = {}) {
      await remoteValidateGitRepository(projectPath);

      if (options.commit) {
        const { stdout } = await remoteSpawnGit(['show', options.commit], projectPath);

        const isTruncated = stdout.length > COMMIT_DIFF_CHARACTER_LIMIT;
        const diff = isTruncated
          ? `${stdout.slice(0, COMMIT_DIFF_CHARACTER_LIMIT)}\n\n... Diff truncated to keep the UI responsive ...`
          : stdout;

        return { diff, isTruncated };
      }

      if (options.file) {
        const {
          repositoryRootPath,
          repositoryRelativeFilePath,
        } = await remoteResolveRepositoryFilePath(projectPath, options.file);

        const { stdout: statusOutput } = await remoteSpawnGit(
          ['status', '--porcelain', '--', repositoryRelativeFilePath],
          repositoryRootPath,
        );
        const isUntracked = statusOutput.startsWith('??');
        const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

        let diff;
        if (isUntracked) {
          // Read remote file content via daemon fs/readFile RPC
          const filePath = repositoryRootPath + '/' + repositoryRelativeFilePath;
          try {
            const fileContent = await ops.readFile(filePath);
            const lines = fileContent.split('\n');
            diff = `--- /dev/null\n+++ b/${repositoryRelativeFilePath}\n@@ -0,0 +1,${lines.length} @@\n` +
                   lines.map(line => `+${line}`).join('\n');
          } catch {
            diff = `Directory: ${repositoryRelativeFilePath}\n(Cannot show diff for directories)`;
          }
        } else if (isDeleted) {
          const { stdout: fileContent } = await remoteSpawnGit(
            ['show', `HEAD:${repositoryRelativeFilePath}`],
            repositoryRootPath,
          );
          const lines = fileContent.split('\n');
          diff = `--- a/${repositoryRelativeFilePath}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n` +
                 lines.map(line => `-${line}`).join('\n');
        } else {
          const { stdout: unstagedDiff } = await remoteSpawnGit(
            ['diff', '--', repositoryRelativeFilePath],
            repositoryRootPath,
          );

          if (unstagedDiff) {
            diff = stripDiffHeaders(unstagedDiff);
          } else {
            const { stdout: stagedDiff } = await remoteSpawnGit(
              ['diff', '--cached', '--', repositoryRelativeFilePath],
              repositoryRootPath,
            );
            diff = stripDiffHeaders(stagedDiff) || '';
          }
        }

        return { diff };
      }

      // Default: full diff
      const { stdout } = await remoteSpawnGit(['diff'], projectPath);
      return { diff: stdout };
    },

    /**
     * Get file content with diff information for CodeEditor on the remote host.
     * @param {string} projectPath
     * @param {{ file: string }} options
     * @returns {Promise<{currentContent: string, oldContent: string, isDeleted: boolean, isUntracked: boolean}>}
     */
    async getFileWithDiff(projectPath, options) {
      await remoteValidateGitRepository(projectPath);

      const {
        repositoryRootPath,
        repositoryRelativeFilePath,
      } = await remoteResolveRepositoryFilePath(projectPath, options.file);

      const { stdout: statusOutput } = await remoteSpawnGit(
        ['status', '--porcelain', '--', repositoryRelativeFilePath],
        repositoryRootPath,
      );
      const isUntracked = statusOutput.startsWith('??');
      const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

      let currentContent = '';
      let oldContent = '';

      if (isDeleted) {
        const { stdout: headContent } = await remoteSpawnGit(
          ['show', `HEAD:${repositoryRelativeFilePath}`],
          repositoryRootPath,
        );
        oldContent = headContent;
        currentContent = headContent;
      } else {
        // Read current file content via daemon fs/readFile RPC
        const filePath = repositoryRootPath + '/' + repositoryRelativeFilePath;
        currentContent = await ops.readFile(filePath);

        if (!isUntracked) {
          try {
            const { stdout: headContent } = await remoteSpawnGit(
              ['show', `HEAD:${repositoryRelativeFilePath}`],
              repositoryRootPath,
            );
            oldContent = headContent;
          } catch {
            // File might be newly added to git (staged but not committed)
            oldContent = '';
          }
        }
      }

      return { currentContent, oldContent, isDeleted, isUntracked };
    },

    /**
     * Get recent commits from the remote repository.
     * @param {string} projectPath
     * @param {{ limit?: number }} [options]
     * @returns {Promise<{commits: Array}>}
     */
    async getLog(projectPath, options = {}) {
      await remoteValidateGitRepository(projectPath);

      const limit = options.limit || 10;

      const { stdout } = await remoteSpawnGit(
        ['log', '--pretty=format:%H|%an|%ae|%ad|%s', '--date=iso-strict', '-n', String(limit)],
        projectPath,
      );

      const commits = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [hash, author, email, date, ...messageParts] = line.split('|');
          return { hash, author, email, date, message: messageParts.join('|') };
        });

      // Get stats for each commit
      for (const commit of commits) {
        try {
          const { stdout: stats } = await remoteSpawnGit(
            ['show', '--stat', '--format=', commit.hash],
            projectPath,
          );
          commit.stats = stats.trim().split('\n').pop();
        } catch {
          commit.stats = '';
        }
      }

      return { commits };
    },

    /**
     * Get list of branches from the remote repository.
     * @param {string} projectPath
     * @returns {Promise<{branches: string[], localBranches: string[], remoteBranches: string[]}>}
     */
    async getBranches(projectPath) {
      await remoteValidateGitRepository(projectPath);

      const { stdout } = await remoteSpawnGit(['branch', '-a'], projectPath);

      const rawLines = stdout
        .split('\n')
        .map(b => b.trim())
        .filter(b => b && !b.includes('->'));

      const localBranches = rawLines
        .filter(b => !b.startsWith('remotes/'))
        .map(b => (b.startsWith('* ') ? b.substring(2) : b));

      const remoteBranches = rawLines
        .filter(b => b.startsWith('remotes/'))
        .map(b => b.replace(/^remotes\/[^/]+\//, ''))
        .filter(name => !localBranches.includes(name));

      const branches = [...localBranches, ...remoteBranches]
        .filter((b, i, arr) => arr.indexOf(b) === i);

      return { branches, localBranches, remoteBranches };
    },

    /**
     * Checkout an existing branch on the remote host.
     * @param {string} projectPath
     * @param {string} branch
     * @returns {Promise<{success: boolean, output: string}>}
     */
    async checkoutBranch(projectPath, branch) {
      const { stdout } = await remoteSpawnGit(['checkout', branch], projectPath);
      return { success: true, output: stdout };
    },

    /**
     * Create and checkout a new branch on the remote host.
     * @param {string} projectPath
     * @param {string} branch
     * @returns {Promise<{success: boolean, output: string}>}
     */
    async createBranch(projectPath, branch) {
      const { stdout } = await remoteSpawnGit(['checkout', '-b', branch], projectPath);
      return { success: true, output: stdout };
    },

    /**
     * Delete a local branch on the remote host. Cannot delete the currently checked-out branch.
     * @param {string} projectPath
     * @param {string} branch
     * @returns {Promise<{success: boolean, output: string}>}
     */
    async deleteBranch(projectPath, branch) {
      await remoteValidateGitRepository(projectPath);

      const { stdout: currentBranch } = await remoteSpawnGit(['branch', '--show-current'], projectPath);
      if (currentBranch.trim() === branch) {
        throw new Error('Cannot delete the currently checked-out branch');
      }

      const { stdout } = await remoteSpawnGit(['branch', '-d', branch], projectPath);
      return { success: true, output: stdout };
    },

    /**
     * Stage files for commit on the remote host.
     * @param {string} projectPath
     * @param {string[]} filePaths
     * @returns {Promise<void>}
     */
    async stage(projectPath, filePaths) {
      await remoteValidateGitRepository(projectPath);
      const repositoryRootPath = await remoteGetRepositoryRootPath(projectPath);

      for (const file of filePaths) {
        const { repositoryRelativeFilePath } = await remoteResolveRepositoryFilePath(projectPath, file);
        await remoteSpawnGit(['add', '--', repositoryRelativeFilePath], repositoryRootPath);
      }
    },

    /**
     * Commit staged changes with a message on the remote host.
     * Optionally stage specific files first.
     * @param {string} projectPath
     * @param {string} message
     * @param {string[]} [filePaths]
     * @returns {Promise<{success: boolean, output: string}>}
     */
    async commit(projectPath, message, filePaths) {
      await remoteValidateGitRepository(projectPath);
      const repositoryRootPath = await remoteGetRepositoryRootPath(projectPath);

      if (filePaths && filePaths.length > 0) {
        for (const file of filePaths) {
          const { repositoryRelativeFilePath } = await remoteResolveRepositoryFilePath(projectPath, file);
          await remoteSpawnGit(['add', '--', repositoryRelativeFilePath], repositoryRootPath);
        }
      }

      const { stdout } = await remoteSpawnGit(['commit', '-m', message], repositoryRootPath);
      return { success: true, output: stdout };
    },

    /**
     * Create an initial commit on the remote host (add all + commit).
     * Fails if HEAD already exists.
     * @param {string} projectPath
     * @returns {Promise<{success: boolean, output: string, message: string}>}
     */
    async initialCommit(projectPath) {
      await remoteValidateGitRepository(projectPath);

      try {
        await remoteSpawnGit(['rev-parse', 'HEAD'], projectPath);
        throw new Error('Repository already has commits. Use regular commit instead.');
      } catch (error) {
        if (error.message.includes('Repository already has commits')) {
          throw error;
        }
        // No HEAD -- good, we can create initial commit
      }

      await remoteSpawnGit(['add', '.'], projectPath);
      const { stdout } = await remoteSpawnGit(['commit', '-m', 'Initial commit'], projectPath);

      return { success: true, output: stdout, message: 'Initial commit created successfully' };
    },

    /**
     * Revert the latest local commit on the remote host, keeping changes staged.
     * @param {string} projectPath
     * @returns {Promise<{success: boolean, output: string}>}
     */
    async revertLocalCommit(projectPath) {
      await remoteValidateGitRepository(projectPath);

      try {
        await remoteSpawnGit(['rev-parse', '--verify', 'HEAD'], projectPath);
      } catch {
        throw new Error('No local commit to revert');
      }

      try {
        await remoteSpawnGit(['reset', '--soft', 'HEAD~1'], projectPath);
      } catch (error) {
        const errorDetails = `${error.stderr || ''} ${error.message || ''}`;
        const isInitialCommit = errorDetails.includes('HEAD~1') &&
          (errorDetails.includes('unknown revision') || errorDetails.includes('ambiguous argument'));

        if (!isInitialCommit) {
          throw error;
        }

        // Initial commit has no parent; deleting HEAD uncommits it and keeps files staged.
        await remoteSpawnGit(['update-ref', '-d', 'HEAD'], projectPath);
      }

      return {
        success: true,
        output: 'Latest local commit reverted successfully. Changes were kept staged.',
      };
    },

    /**
     * Discard changes for a specific file on the remote host.
     * Handles untracked, modified, deleted, and added files.
     * @param {string} projectPath
     * @param {string} file
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async discardChanges(projectPath, file) {
      await remoteValidateGitRepository(projectPath);
      const {
        repositoryRootPath,
        repositoryRelativeFilePath,
      } = await remoteResolveRepositoryFilePath(projectPath, file);

      const { stdout: statusOutput } = await remoteSpawnGit(
        ['status', '--porcelain', '--', repositoryRelativeFilePath],
        repositoryRootPath,
      );

      if (!statusOutput.trim()) {
        throw new Error('No changes to discard for this file');
      }

      const status = statusOutput.substring(0, 2);

      if (status === '??') {
        // Untracked file -- delete via daemon fs/delete RPC
        const filePath = repositoryRootPath + '/' + repositoryRelativeFilePath;
        await ops.deleteItem(filePath);
      } else if (status.includes('M') || status.includes('D')) {
        // Modified or deleted file -- restore from HEAD
        await remoteSpawnGit(['restore', '--', repositoryRelativeFilePath], repositoryRootPath);
      } else if (status.includes('A')) {
        // Added file -- unstage it
        await remoteSpawnGit(['reset', 'HEAD', '--', repositoryRelativeFilePath], repositoryRootPath);
      }

      return { success: true, message: `Changes discarded for ${repositoryRelativeFilePath}` };
    },

    /**
     * Delete an untracked file on the remote host.
     * Verifies the file is actually untracked first.
     * @param {string} projectPath
     * @param {string} file
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async deleteUntracked(projectPath, file) {
      await remoteValidateGitRepository(projectPath);
      const {
        repositoryRootPath,
        repositoryRelativeFilePath,
      } = await remoteResolveRepositoryFilePath(projectPath, file);

      const { stdout: statusOutput } = await remoteSpawnGit(
        ['status', '--porcelain', '--', repositoryRelativeFilePath],
        repositoryRootPath,
      );

      if (!statusOutput.trim()) {
        throw new Error('File is not untracked or does not exist');
      }

      const status = statusOutput.substring(0, 2);
      if (status !== '??') {
        throw new Error('File is not untracked. Use discard for tracked files.');
      }

      // Delete via daemon fs/delete RPC
      const filePath = repositoryRootPath + '/' + repositoryRelativeFilePath;
      await ops.deleteItem(filePath);

      return { success: true, message: `Untracked file ${repositoryRelativeFilePath} deleted successfully` };
    },

    /**
     * Get remote status (ahead/behind commits with smart remote detection) on the remote host.
     * @param {string} projectPath
     * @returns {Promise<object>}
     */
    async getRemoteStatus(projectPath) {
      await remoteValidateGitRepository(projectPath);

      const branch = await remoteGetCurrentBranchName(projectPath);
      const hasCommits = await remoteRepositoryHasCommits(projectPath);

      const { stdout: remoteOutput } = await remoteSpawnGit(['remote'], projectPath);
      const remotes = remoteOutput.trim().split('\n').filter(r => r.trim());
      const hasRemote = remotes.length > 0;
      const fallbackRemoteName = hasRemote
        ? (remotes.includes('origin') ? 'origin' : remotes[0])
        : null;

      if (!hasCommits) {
        return {
          hasRemote,
          hasUpstream: false,
          branch,
          remoteName: fallbackRemoteName,
          ahead: 0,
          behind: 0,
          isUpToDate: false,
          message: 'Repository has no commits yet',
        };
      }

      let trackingBranch;
      let remoteName;
      try {
        const { stdout } = await remoteSpawnGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], projectPath);
        trackingBranch = stdout.trim();
        remoteName = trackingBranch.split('/')[0];
      } catch {
        return {
          hasRemote,
          hasUpstream: false,
          branch,
          remoteName: fallbackRemoteName,
          message: 'No remote tracking branch configured',
        };
      }

      const { stdout: countOutput } = await remoteSpawnGit(
        ['rev-list', '--count', '--left-right', `${trackingBranch}...HEAD`],
        projectPath,
      );

      const [behind, ahead] = countOutput.trim().split('\t').map(Number);

      return {
        hasRemote: true,
        hasUpstream: true,
        branch,
        remoteBranch: trackingBranch,
        remoteName,
        ahead: ahead || 0,
        behind: behind || 0,
        isUpToDate: ahead === 0 && behind === 0,
      };
    },

    /**
     * Fetch from remote on the remote host using smart remote detection.
     * @param {string} projectPath
     * @returns {Promise<{success: boolean, output: string, remoteName: string}>}
     */
    async gitFetch(projectPath) {
      await remoteValidateGitRepository(projectPath);

      const branch = await remoteGetCurrentBranchName(projectPath);

      let remoteName = 'origin';
      try {
        const { stdout } = await remoteSpawnGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], projectPath);
        remoteName = stdout.trim().split('/')[0];
      } catch {
        // No upstream, try to fetch from origin anyway
      }

      const { stdout } = await remoteSpawnGit(['fetch', remoteName], projectPath);

      return { success: true, output: stdout || 'Fetch completed successfully', remoteName };
    },

    /**
     * Pull from remote (fetch + merge) on the remote host.
     * @param {string} projectPath
     * @returns {Promise<{success: boolean, output: string, remoteName: string, remoteBranch: string}>}
     */
    async gitPull(projectPath) {
      await remoteValidateGitRepository(projectPath);

      const branch = await remoteGetCurrentBranchName(projectPath);

      let remoteName = 'origin';
      let remoteBranch = branch;
      try {
        const { stdout } = await remoteSpawnGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], projectPath);
        const tracking = stdout.trim();
        remoteName = tracking.split('/')[0];
        remoteBranch = tracking.split('/').slice(1).join('/');
      } catch {
        // No upstream, use fallback
      }

      const { stdout } = await remoteSpawnGit(['pull', remoteName, remoteBranch], projectPath);

      return {
        success: true,
        output: stdout || 'Pull completed successfully',
        remoteName,
        remoteBranch,
      };
    },

    /**
     * Push commits to remote repository on the remote host.
     * @param {string} projectPath
     * @returns {Promise<{success: boolean, output: string, remoteName: string, remoteBranch: string}>}
     */
    async gitPush(projectPath) {
      await remoteValidateGitRepository(projectPath);

      const branch = await remoteGetCurrentBranchName(projectPath);

      let remoteName = 'origin';
      let remoteBranch = branch;
      try {
        const { stdout } = await remoteSpawnGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], projectPath);
        const tracking = stdout.trim();
        remoteName = tracking.split('/')[0];
        remoteBranch = tracking.split('/').slice(1).join('/');
      } catch {
        // No upstream, use fallback
      }

      const { stdout } = await remoteSpawnGit(['push', remoteName, remoteBranch], projectPath);

      return {
        success: true,
        output: stdout || 'Push completed successfully',
        remoteName,
        remoteBranch,
      };
    },

    /**
     * Publish branch to remote (set upstream and push) on the remote host.
     * @param {string} projectPath
     * @param {string} branch
     * @returns {Promise<{success: boolean, output: string, remoteName: string, branch: string}>}
     */
    async gitPublish(projectPath, branch) {
      await remoteValidateGitRepository(projectPath);

      const currentBranchName = await remoteGetCurrentBranchName(projectPath);
      if (currentBranchName !== branch) {
        throw new Error(`Branch mismatch. Current branch is ${currentBranchName}, but trying to publish ${branch}`);
      }

      let remoteName = 'origin';
      try {
        const { stdout } = await remoteSpawnGit(['remote'], projectPath);
        const remotes = stdout.trim().split('\n').filter(r => r.trim());
        if (remotes.length === 0) {
          throw new Error('No remote repository configured. Add a remote with: git remote add origin <url>');
        }
        remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
      } catch (error) {
        if (error.message.includes('No remote repository configured')) {
          throw error;
        }
        throw new Error('No remote repository configured. Add a remote with: git remote add origin <url>');
      }

      const { stdout } = await remoteSpawnGit(['push', '--set-upstream', remoteName, branch], projectPath);

      return {
        success: true,
        output: stdout || 'Branch published successfully',
        remoteName,
        branch,
      };
    },

    /**
     * Generate diff context for AI commit message generation on the remote host.
     * Returns the diff string; AI invocation stays in the route handler.
     * @param {string} projectPath
     * @param {string[]} files
     * @returns {Promise<string>}
     */
    async generateCommitDiff(projectPath, files) {
      await remoteValidateGitRepository(projectPath);
      const repositoryRootPath = await remoteGetRepositoryRootPath(projectPath);

      let diffContext = '';
      for (const file of files) {
        try {
          const { repositoryRelativeFilePath } = await remoteResolveRepositoryFilePath(projectPath, file);
          const { stdout } = await remoteSpawnGit(
            ['diff', 'HEAD', '--', repositoryRelativeFilePath],
            repositoryRootPath,
          );
          if (stdout) {
            diffContext += `\n--- ${repositoryRelativeFilePath} ---\n${stdout}`;
          }
        } catch {
          // Skip files that fail
        }
      }

      // If no diff found, might be untracked files -- read via daemon fs/readFile
      if (!diffContext.trim()) {
        for (const file of files) {
          try {
            const { repositoryRelativeFilePath } = await remoteResolveRepositoryFilePath(projectPath, file);
            const filePath = repositoryRootPath + '/' + repositoryRelativeFilePath;
            try {
              const content = await ops.readFile(filePath);
              diffContext += `\n--- ${repositoryRelativeFilePath} (new file) ---\n${content.substring(0, 1000)}\n`;
            } catch {
              diffContext += `\n--- ${repositoryRelativeFilePath} (new directory) ---\n`;
            }
          } catch {
            // Skip files that fail
          }
        }
      }

      return diffContext;
    },
  };

  return ops;
}
