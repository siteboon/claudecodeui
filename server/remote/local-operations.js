/**
 * LocalOperations — implements the ProjectOperations filesystem, git, and
 * terminal methods for the local machine using fs/promises, node-pty, and
 * shared git-parsers utilities.
 *
 * Git methods mirror the exact behavior of the corresponding route handlers
 * in server/routes/git.js but return data objects directly instead of calling
 * res.json(). Routes delegate to these methods for transparent local/remote
 * operation through the ProjectOperations abstraction.
 *
 * @module remote/local-operations
 */

import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import pty from 'node-pty';
import {
  spawnGit,
  validateGitRepository,
  getCurrentBranchName,
  repositoryHasCommits,
  getRepositoryRootPath,
  resolveRepositoryFilePath,
  stripDiffHeaders,
  isMissingHeadRevisionError,
  normalizeRepositoryRelativeFilePath,
  validateFilePath,
  validateRemoteName,
} from '../utils/git-parsers.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert a single permission digit (0-7) to its rwx string.
 * Copied from server/index.js to keep local-operations self-contained.
 * @param {number} perm
 * @returns {string}
 */
function permToRwx(perm) {
  const r = perm & 4 ? 'r' : '-';
  const w = perm & 2 ? 'w' : '-';
  const x = perm & 1 ? 'x' : '-';
  return r + w + x;
}

/**
 * Directories that are always skipped when listing files.
 * Matches the skip list in server/index.js getFileTree().
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.svn', '.hg']);
const COMMIT_DIFF_CHARACTER_LIMIT = 500_000;

// ────────────────────────────────────────────────────────────────────────────
// LocalOperations
// ────────────────────────────────────────────────────────────────────────────

export const localOperations = {
  /**
   * Recursively list files and directories, producing the same shape as the
   * existing getFileTree() in server/index.js.
   *
   * @param {string} dirPath - Absolute path to the directory
   * @param {{ maxDepth?: number, showHidden?: boolean }} [options]
   * @returns {Promise<import('./operations.js').FileTreeNode[]>}
   */
  async listFiles(dirPath, options = {}) {
    const maxDepth = options.maxDepth ?? 3;
    const showHidden = options.showHidden ?? true;

    async function walk(currentPath, currentDepth) {
      const items = [];

      try {
        const entries = await fsPromises.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          // Skip heavy build directories and VCS directories
          if (SKIP_DIRS.has(entry.name)) continue;

          // Skip hidden files when showHidden is false
          if (!showHidden && entry.name.startsWith('.')) continue;

          const itemPath = path.join(currentPath, entry.name);
          const item = {
            name: entry.name,
            path: itemPath,
            type: entry.isDirectory() ? 'directory' : 'file',
          };

          // Get file stats for additional metadata
          try {
            const stats = await fsPromises.stat(itemPath);
            item.size = stats.size;
            item.modified = stats.mtime.toISOString();

            // Convert permissions to octal + rwx format
            const mode = stats.mode;
            const ownerPerm = (mode >> 6) & 7;
            const groupPerm = (mode >> 3) & 7;
            const otherPerm = mode & 7;
            item.permissions = ownerPerm.toString() + groupPerm.toString() + otherPerm.toString();
            item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
          } catch {
            // If stat fails, provide default values
            item.size = 0;
            item.modified = null;
            item.permissions = '000';
            item.permissionsRwx = '---------';
          }

          if (entry.isDirectory() && currentDepth < maxDepth) {
            try {
              await fsPromises.access(itemPath, fs.constants.R_OK);
              item.children = await walk(itemPath, currentDepth + 1);
            } catch {
              // Silently skip directories we can't access
              item.children = [];
            }
          }

          items.push(item);
        }
      } catch (error) {
        // Only log non-permission errors to avoid spam
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
          console.error('Error reading directory:', error);
        }
      }

      // Sort: directories first, then alphabetical
      return items.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    }

    return walk(dirPath, 0);
  },

  /**
   * Read a file as UTF-8 text.
   * @param {string} filePath
   * @returns {Promise<string>}
   */
  async readFile(filePath) {
    return fsPromises.readFile(filePath, 'utf8');
  },

  /**
   * Read a file as a raw Buffer (for binary content).
   * @param {string} filePath
   * @returns {Promise<Buffer>}
   */
  async readFileBinary(filePath) {
    return fsPromises.readFile(filePath);
  },

  /**
   * Write text content to a file.
   * @param {string} filePath
   * @param {string} content
   * @returns {Promise<void>}
   */
  async writeFile(filePath, content) {
    await fsPromises.writeFile(filePath, content, 'utf8');
  },

  /**
   * Create a new file or directory.
   * @param {string} parentPath - Directory in which to create the item
   * @param {string} name
   * @param {'file' | 'directory'} type
   * @returns {Promise<{path: string, name: string, type: string}>}
   */
  async createItem(parentPath, name, type) {
    const resolvedPath = path.join(parentPath, name);

    if (type === 'directory') {
      await fsPromises.mkdir(resolvedPath, { recursive: false });
    } else {
      // Ensure parent directory exists
      const parentDir = path.dirname(resolvedPath);
      await fsPromises.mkdir(parentDir, { recursive: true });
      await fsPromises.writeFile(resolvedPath, '', 'utf8');
    }

    return { path: resolvedPath, name, type };
  },

  /**
   * Rename a file or directory.
   * @param {string} oldPath
   * @param {string} newName
   * @returns {Promise<{oldPath: string, newPath: string, newName: string}>}
   */
  async renameItem(oldPath, newName) {
    const newPath = path.join(path.dirname(oldPath), newName);
    await fsPromises.rename(oldPath, newPath);
    return { oldPath, newPath, newName };
  },

  /**
   * Delete a file or directory.
   * @param {string} targetPath
   * @returns {Promise<void>}
   */
  async deleteItem(targetPath) {
    const stats = await fsPromises.stat(targetPath);
    if (stats.isDirectory()) {
      await fsPromises.rm(targetPath, { recursive: true, force: true });
    } else {
      await fsPromises.unlink(targetPath);
    }
  },

  /**
   * Get stat information for a path.
   * @param {string} targetPath
   * @returns {Promise<{size: number, modified: string, type: string, permissions: string, permissionsRwx: string}>}
   */
  async stat(targetPath) {
    const stats = await fsPromises.stat(targetPath);
    const mode = stats.mode;
    const ownerPerm = (mode >> 6) & 7;
    const groupPerm = (mode >> 3) & 7;
    const otherPerm = mode & 7;

    return {
      size: stats.size,
      modified: stats.mtime.toISOString(),
      type: stats.isDirectory() ? 'directory' : 'file',
      permissions: ownerPerm.toString() + groupPerm.toString() + otherPerm.toString(),
      permissionsRwx: permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm),
    };
  },

  /**
   * Check whether a path exists.
   * @param {string} targetPath
   * @returns {Promise<boolean>}
   */
  async exists(targetPath) {
    try {
      await fsPromises.access(targetPath);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Spawn a pseudo-terminal shell session.
   * Mirrors the pty.spawn pattern from server/index.js.
   *
   * @param {import('./operations.js').ShellOptions} options
   * @returns {Promise<import('./operations.js').ShellSession>}
   */
  async spawnShell(options) {
    const shell = options.shell || process.env.SHELL || '/bin/bash';
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd || process.env.HOME,
      env: {
        ...process.env,
        ...options.env,
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
      },
    });

    return {
      write(data) { proc.write(data); },
      resize(cols, rows) { proc.resize(cols, rows); },
      onData(handler) { proc.onData(handler); },
      onExit(handler) { proc.onExit(handler); },
      kill() { proc.kill(); },
      pid: proc.pid,
    };
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Git methods
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get git status for a project.
   * @param {string} projectPath
   * @returns {Promise<{branch: string, hasCommits: boolean, modified: string[], added: string[], deleted: string[], untracked: string[]}>}
   */
  async getGitStatus(projectPath) {
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);
    const hasCommits = await repositoryHasCommits(projectPath);

    const { stdout: statusOutput } = await spawnGit(['status', '--porcelain'], { cwd: projectPath });

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
   * Get diff for a specific file.
   * @param {string} projectPath
   * @param {{ file?: string, commit?: string }} [options]
   * @returns {Promise<{diff: string, isTruncated?: boolean}>}
   */
  async getDiff(projectPath, options = {}) {
    await validateGitRepository(projectPath);

    if (options.commit) {
      // Commit diff mode
      const { stdout } = await spawnGit(['show', options.commit], { cwd: projectPath });

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
      } = await resolveRepositoryFilePath(projectPath, options.file);

      // Check if file is untracked or deleted
      const { stdout: statusOutput } = await spawnGit(
        ['status', '--porcelain', '--', repositoryRelativeFilePath],
        { cwd: repositoryRootPath },
      );
      const isUntracked = statusOutput.startsWith('??');
      const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

      let diff;
      if (isUntracked) {
        const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
        const stats = await fsPromises.stat(filePath);

        if (stats.isDirectory()) {
          diff = `Directory: ${repositoryRelativeFilePath}\n(Cannot show diff for directories)`;
        } else {
          const fileContent = await fsPromises.readFile(filePath, 'utf-8');
          const lines = fileContent.split('\n');
          diff = `--- /dev/null\n+++ b/${repositoryRelativeFilePath}\n@@ -0,0 +1,${lines.length} @@\n` +
                 lines.map(line => `+${line}`).join('\n');
        }
      } else if (isDeleted) {
        const { stdout: fileContent } = await spawnGit(
          ['show', `HEAD:${repositoryRelativeFilePath}`],
          { cwd: repositoryRootPath },
        );
        const lines = fileContent.split('\n');
        diff = `--- a/${repositoryRelativeFilePath}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n` +
               lines.map(line => `-${line}`).join('\n');
      } else {
        const { stdout: unstagedDiff } = await spawnGit(
          ['diff', '--', repositoryRelativeFilePath],
          { cwd: repositoryRootPath },
        );

        if (unstagedDiff) {
          diff = stripDiffHeaders(unstagedDiff);
        } else {
          const { stdout: stagedDiff } = await spawnGit(
            ['diff', '--cached', '--', repositoryRelativeFilePath],
            { cwd: repositoryRootPath },
          );
          diff = stripDiffHeaders(stagedDiff) || '';
        }
      }

      return { diff };
    }

    // Default: full diff (no file, no commit)
    const { stdout } = await spawnGit(['diff'], { cwd: projectPath });
    return { diff: stdout };
  },

  /**
   * Get file content with diff information for CodeEditor.
   * @param {string} projectPath
   * @param {{ file: string }} options
   * @returns {Promise<{currentContent: string, oldContent: string, isDeleted: boolean, isUntracked: boolean}>}
   */
  async getFileWithDiff(projectPath, options) {
    await validateGitRepository(projectPath);

    const {
      repositoryRootPath,
      repositoryRelativeFilePath,
    } = await resolveRepositoryFilePath(projectPath, options.file);

    // Check file status
    const { stdout: statusOutput } = await spawnGit(
      ['status', '--porcelain', '--', repositoryRelativeFilePath],
      { cwd: repositoryRootPath },
    );
    const isUntracked = statusOutput.startsWith('??');
    const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

    let currentContent = '';
    let oldContent = '';

    if (isDeleted) {
      const { stdout: headContent } = await spawnGit(
        ['show', `HEAD:${repositoryRelativeFilePath}`],
        { cwd: repositoryRootPath },
      );
      oldContent = headContent;
      currentContent = headContent;
    } else {
      const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
      const stats = await fsPromises.stat(filePath);

      if (stats.isDirectory()) {
        throw new Error('Cannot show diff for directories');
      }

      currentContent = await fsPromises.readFile(filePath, 'utf-8');

      if (!isUntracked) {
        try {
          const { stdout: headContent } = await spawnGit(
            ['show', `HEAD:${repositoryRelativeFilePath}`],
            { cwd: repositoryRootPath },
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
   * Get recent commits.
   * @param {string} projectPath
   * @param {{ limit?: number }} [options]
   * @returns {Promise<{commits: Array}>}
   */
  async getLog(projectPath, options = {}) {
    await validateGitRepository(projectPath);

    const limit = options.limit || 10;

    const { stdout } = await spawnGit(
      ['log', '--pretty=format:%H|%an|%ae|%ad|%s', '--date=iso-strict', '-n', String(limit)],
      { cwd: projectPath },
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
        const { stdout: stats } = await spawnGit(
          ['show', '--stat', '--format=', commit.hash],
          { cwd: projectPath },
        );
        commit.stats = stats.trim().split('\n').pop();
      } catch {
        commit.stats = '';
      }
    }

    return { commits };
  },

  /**
   * Get list of branches.
   * @param {string} projectPath
   * @returns {Promise<{branches: string[], localBranches: string[], remoteBranches: string[]}>}
   */
  async getBranches(projectPath) {
    await validateGitRepository(projectPath);

    const { stdout } = await spawnGit(['branch', '-a'], { cwd: projectPath });

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
   * Checkout an existing branch.
   * @param {string} projectPath
   * @param {string} branch
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async checkoutBranch(projectPath, branch) {
    const { stdout } = await spawnGit(['checkout', branch], { cwd: projectPath });
    return { success: true, output: stdout };
  },

  /**
   * Create and checkout a new branch.
   * @param {string} projectPath
   * @param {string} branch
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async createBranch(projectPath, branch) {
    const { stdout } = await spawnGit(['checkout', '-b', branch], { cwd: projectPath });
    return { success: true, output: stdout };
  },

  /**
   * Delete a local branch. Cannot delete the currently checked-out branch.
   * @param {string} projectPath
   * @param {string} branch
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async deleteBranch(projectPath, branch) {
    await validateGitRepository(projectPath);

    const { stdout: currentBranch } = await spawnGit(['branch', '--show-current'], { cwd: projectPath });
    if (currentBranch.trim() === branch) {
      throw new Error('Cannot delete the currently checked-out branch');
    }

    const { stdout } = await spawnGit(['branch', '-d', branch], { cwd: projectPath });
    return { success: true, output: stdout };
  },

  /**
   * Stage files for commit.
   * @param {string} projectPath
   * @param {string[]} filePaths
   * @returns {Promise<void>}
   */
  async stage(projectPath, filePaths) {
    await validateGitRepository(projectPath);
    const repositoryRootPath = await getRepositoryRootPath(projectPath);

    for (const file of filePaths) {
      const { repositoryRelativeFilePath } = await resolveRepositoryFilePath(projectPath, file);
      await spawnGit(['add', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
    }
  },

  /**
   * Commit staged changes with a message. Optionally stage specific files first.
   * @param {string} projectPath
   * @param {string} message
   * @param {string[]} [filePaths]
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async commit(projectPath, message, filePaths) {
    await validateGitRepository(projectPath);
    const repositoryRootPath = await getRepositoryRootPath(projectPath);

    if (filePaths && filePaths.length > 0) {
      for (const file of filePaths) {
        const { repositoryRelativeFilePath } = await resolveRepositoryFilePath(projectPath, file);
        await spawnGit(['add', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
      }
    }

    const { stdout } = await spawnGit(['commit', '-m', message], { cwd: repositoryRootPath });
    return { success: true, output: stdout };
  },

  /**
   * Create an initial commit (add all + commit). Fails if HEAD already exists.
   * @param {string} projectPath
   * @returns {Promise<{success: boolean, output: string, message: string}>}
   */
  async initialCommit(projectPath) {
    await validateGitRepository(projectPath);

    // Check if there are already commits
    try {
      await spawnGit(['rev-parse', 'HEAD'], { cwd: projectPath });
      throw new Error('Repository already has commits. Use regular commit instead.');
    } catch (error) {
      if (error.message.includes('Repository already has commits')) {
        throw error;
      }
      // No HEAD -- this is good, we can create initial commit
    }

    await spawnGit(['add', '.'], { cwd: projectPath });
    const { stdout } = await spawnGit(['commit', '-m', 'Initial commit'], { cwd: projectPath });

    return { success: true, output: stdout, message: 'Initial commit created successfully' };
  },

  /**
   * Revert the latest local commit, keeping changes staged.
   * @param {string} projectPath
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async revertLocalCommit(projectPath) {
    await validateGitRepository(projectPath);

    try {
      await spawnGit(['rev-parse', '--verify', 'HEAD'], { cwd: projectPath });
    } catch {
      throw new Error('No local commit to revert');
    }

    try {
      await spawnGit(['reset', '--soft', 'HEAD~1'], { cwd: projectPath });
    } catch (error) {
      const errorDetails = `${error.stderr || ''} ${error.message || ''}`;
      const isInitialCommit = errorDetails.includes('HEAD~1') &&
        (errorDetails.includes('unknown revision') || errorDetails.includes('ambiguous argument'));

      if (!isInitialCommit) {
        throw error;
      }

      // Initial commit has no parent; deleting HEAD uncommits it and keeps files staged.
      await spawnGit(['update-ref', '-d', 'HEAD'], { cwd: projectPath });
    }

    return {
      success: true,
      output: 'Latest local commit reverted successfully. Changes were kept staged.',
    };
  },

  /**
   * Discard changes for a specific file. Handles untracked, modified, deleted, and added files.
   * @param {string} projectPath
   * @param {string} file
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async discardChanges(projectPath, file) {
    await validateGitRepository(projectPath);
    const {
      repositoryRootPath,
      repositoryRelativeFilePath,
    } = await resolveRepositoryFilePath(projectPath, file);

    const { stdout: statusOutput } = await spawnGit(
      ['status', '--porcelain', '--', repositoryRelativeFilePath],
      { cwd: repositoryRootPath },
    );

    if (!statusOutput.trim()) {
      throw new Error('No changes to discard for this file');
    }

    const status = statusOutput.substring(0, 2);

    if (status === '??') {
      // Untracked file or directory -- delete it via fs method for consistency
      const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
      await this.deleteItem(filePath);
    } else if (status.includes('M') || status.includes('D')) {
      // Modified or deleted file -- restore from HEAD
      await spawnGit(['restore', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
    } else if (status.includes('A')) {
      // Added file -- unstage it
      await spawnGit(['reset', 'HEAD', '--', repositoryRelativeFilePath], { cwd: repositoryRootPath });
    }

    return { success: true, message: `Changes discarded for ${repositoryRelativeFilePath}` };
  },

  /**
   * Delete an untracked file. Verifies the file is actually untracked first.
   * @param {string} projectPath
   * @param {string} file
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async deleteUntracked(projectPath, file) {
    await validateGitRepository(projectPath);
    const {
      repositoryRootPath,
      repositoryRelativeFilePath,
    } = await resolveRepositoryFilePath(projectPath, file);

    const { stdout: statusOutput } = await spawnGit(
      ['status', '--porcelain', '--', repositoryRelativeFilePath],
      { cwd: repositoryRootPath },
    );

    if (!statusOutput.trim()) {
      throw new Error('File is not untracked or does not exist');
    }

    const status = statusOutput.substring(0, 2);
    if (status !== '??') {
      throw new Error('File is not untracked. Use discard for tracked files.');
    }

    const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
    const stats = await fsPromises.stat(filePath);

    if (stats.isDirectory()) {
      await fsPromises.rm(filePath, { recursive: true, force: true });
      return { success: true, message: `Untracked directory ${repositoryRelativeFilePath} deleted successfully` };
    } else {
      await fsPromises.unlink(filePath);
      return { success: true, message: `Untracked file ${repositoryRelativeFilePath} deleted successfully` };
    }
  },

  /**
   * Get remote status (ahead/behind commits with smart remote detection).
   * @param {string} projectPath
   * @returns {Promise<object>}
   */
  async getRemoteStatus(projectPath) {
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);
    const hasCommits = await repositoryHasCommits(projectPath);

    const { stdout: remoteOutput } = await spawnGit(['remote'], { cwd: projectPath });
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
      const { stdout } = await spawnGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
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

    const { stdout: countOutput } = await spawnGit(
      ['rev-list', '--count', '--left-right', `${trackingBranch}...HEAD`],
      { cwd: projectPath },
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
   * Fetch from remote using smart remote detection.
   * @param {string} projectPath
   * @returns {Promise<{success: boolean, output: string, remoteName: string}>}
   */
  async gitFetch(projectPath) {
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);

    let remoteName = 'origin';
    try {
      const { stdout } = await spawnGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      remoteName = stdout.trim().split('/')[0];
    } catch {
      // No upstream, try to fetch from origin anyway
    }

    validateRemoteName(remoteName);
    const { stdout } = await spawnGit(['fetch', remoteName], { cwd: projectPath });

    return { success: true, output: stdout || 'Fetch completed successfully', remoteName };
  },

  /**
   * Pull from remote (fetch + merge using smart remote detection).
   * @param {string} projectPath
   * @returns {Promise<{success: boolean, output: string, remoteName: string, remoteBranch: string}>}
   */
  async gitPull(projectPath) {
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);

    let remoteName = 'origin';
    let remoteBranch = branch;
    try {
      const { stdout } = await spawnGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0];
      remoteBranch = tracking.split('/').slice(1).join('/');
    } catch {
      // No upstream, use fallback
    }

    validateRemoteName(remoteName);
    const { stdout } = await spawnGit(['pull', remoteName, remoteBranch], { cwd: projectPath });

    return {
      success: true,
      output: stdout || 'Pull completed successfully',
      remoteName,
      remoteBranch,
    };
  },

  /**
   * Push commits to remote repository.
   * @param {string} projectPath
   * @returns {Promise<{success: boolean, output: string, remoteName: string, remoteBranch: string}>}
   */
  async gitPush(projectPath) {
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);

    let remoteName = 'origin';
    let remoteBranch = branch;
    try {
      const { stdout } = await spawnGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0];
      remoteBranch = tracking.split('/').slice(1).join('/');
    } catch {
      // No upstream, use fallback
    }

    validateRemoteName(remoteName);
    const { stdout } = await spawnGit(['push', remoteName, remoteBranch], { cwd: projectPath });

    return {
      success: true,
      output: stdout || 'Push completed successfully',
      remoteName,
      remoteBranch,
    };
  },

  /**
   * Publish branch to remote (set upstream and push).
   * @param {string} projectPath
   * @param {string} branch
   * @returns {Promise<{success: boolean, output: string, remoteName: string, branch: string}>}
   */
  async gitPublish(projectPath, branch) {
    await validateGitRepository(projectPath);

    const currentBranchName = await getCurrentBranchName(projectPath);
    if (currentBranchName !== branch) {
      throw new Error(`Branch mismatch. Current branch is ${currentBranchName}, but trying to publish ${branch}`);
    }

    let remoteName = 'origin';
    try {
      const { stdout } = await spawnGit(['remote'], { cwd: projectPath });
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

    validateRemoteName(remoteName);
    const { stdout } = await spawnGit(['push', '--set-upstream', remoteName, branch], { cwd: projectPath });

    return {
      success: true,
      output: stdout || 'Branch published successfully',
      remoteName,
      branch,
    };
  },

  /**
   * Generate diff context for AI commit message generation.
   * Returns the diff string; AI invocation stays in the route handler.
   * @param {string} projectPath
   * @param {string[]} files
   * @returns {Promise<string>}
   */
  async generateCommitDiff(projectPath, files) {
    await validateGitRepository(projectPath);
    const repositoryRootPath = await getRepositoryRootPath(projectPath);

    let diffContext = '';
    for (const file of files) {
      try {
        const { repositoryRelativeFilePath } = await resolveRepositoryFilePath(projectPath, file);
        const { stdout } = await spawnGit(
          ['diff', 'HEAD', '--', repositoryRelativeFilePath],
          { cwd: repositoryRootPath },
        );
        if (stdout) {
          diffContext += `\n--- ${repositoryRelativeFilePath} ---\n${stdout}`;
        }
      } catch {
        // Skip files that fail
      }
    }

    // If no diff found, might be untracked files
    if (!diffContext.trim()) {
      for (const file of files) {
        try {
          const { repositoryRelativeFilePath } = await resolveRepositoryFilePath(projectPath, file);
          const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
          const stats = await fsPromises.stat(filePath);

          if (!stats.isDirectory()) {
            const content = await fsPromises.readFile(filePath, 'utf-8');
            diffContext += `\n--- ${repositoryRelativeFilePath} (new file) ---\n${content.substring(0, 1000)}\n`;
          } else {
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
