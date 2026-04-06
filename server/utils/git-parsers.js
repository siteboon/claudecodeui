/**
 * @module utils/git-parsers
 * Shared git output parsing and validation utilities.
 * Extracted from server/routes/git.js for reuse by both route handlers
 * and ProjectOperations implementations.
 */
import { spawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * Spawn a git command with the given arguments and options.
 * Uses child_process.spawn with shell: false for safety.
 *
 * @param {string[]} args - Git command arguments
 * @param {object} options - Spawn options (must include cwd)
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export function spawnGit(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(`Command failed: git ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

/**
 * Validate a commit reference (hex hash, HEAD, HEAD~N, tag/branch names).
 * @param {string} commit - Commit reference to validate
 * @returns {string} The validated commit reference
 * @throws {Error} If the reference contains invalid characters
 */
export function validateCommitRef(commit) {
  if (!/^[a-zA-Z0-9._~^{}@\/-]+$/.test(commit)) {
    throw new Error('Invalid commit reference');
  }
  return commit;
}

/**
 * Validate a branch name.
 * @param {string} branch - Branch name to validate
 * @returns {string} The validated branch name
 * @throws {Error} If the name contains invalid characters
 */
export function validateBranchName(branch) {
  if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) {
    throw new Error('Invalid branch name');
  }
  return branch;
}

/**
 * Validate a file path, optionally checking for path traversal.
 * @param {string} file - File path to validate
 * @param {string} [projectPath] - Project root for traversal check
 * @returns {string} The validated file path
 * @throws {Error} If the path is invalid or traverses outside the project
 */
export function validateFilePath(file, projectPath) {
  if (!file || file.includes('\0')) {
    throw new Error('Invalid file path');
  }
  if (projectPath) {
    const resolved = path.resolve(projectPath, file);
    const normalizedRoot = path.resolve(projectPath) + path.sep;
    if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(projectPath)) {
      throw new Error('Invalid file path: path traversal detected');
    }
  }
  return file;
}

/**
 * Validate a remote name.
 * @param {string} remote - Remote name to validate
 * @returns {string} The validated remote name
 * @throws {Error} If the name contains invalid characters
 */
export function validateRemoteName(remote) {
  if (!/^[a-zA-Z0-9._-]+$/.test(remote)) {
    throw new Error('Invalid remote name');
  }
  return remote;
}

/**
 * Validate a project path (must be absolute, not root).
 * @param {string} projectPath - Project path to validate
 * @returns {string} The resolved, validated path
 * @throws {Error} If the path is invalid or dangerous
 */
export function validateProjectPath(projectPath) {
  if (!projectPath || projectPath.includes('\0')) {
    throw new Error('Invalid project path');
  }
  const resolved = path.resolve(projectPath);
  if (!path.isAbsolute(resolved)) {
    throw new Error('Invalid project path: must be absolute');
  }
  if (resolved === '/' || resolved === path.sep) {
    throw new Error('Invalid project path: root directory not allowed');
  }
  return resolved;
}

/**
 * Strip git diff header lines, keeping only hunk headers and content.
 * @param {string} diff - Raw git diff output
 * @returns {string} Diff with headers stripped
 */
export function stripDiffHeaders(diff) {
  if (!diff) return '';

  const lines = diff.split('\n');
  const filteredLines = [];
  let startIncluding = false;

  for (const line of lines) {
    if (line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('---') ||
        line.startsWith('+++')) {
      continue;
    }

    if (line.startsWith('@@') || startIncluding) {
      startIncluding = true;
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

/**
 * Validate that a path is inside a git work tree.
 * @param {string} projectPath - Path to validate
 * @throws {Error} If not a git repository or path not found
 */
export async function validateGitRepository(projectPath) {
  try {
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  try {
    const { stdout: insideWorkTreeOutput } = await spawnGit(['rev-parse', '--is-inside-work-tree'], { cwd: projectPath });
    const isInsideWorkTree = insideWorkTreeOutput.trim() === 'true';
    if (!isInsideWorkTree) {
      throw new Error('Not inside a git work tree');
    }

    await spawnGit(['rev-parse', '--show-toplevel'], { cwd: projectPath });
  } catch {
    throw new Error('Not a git repository. This directory does not contain a .git folder. Initialize a git repository with "git init" to use source control features.');
  }
}

/**
 * Get the current branch name for a repository.
 * @param {string} projectPath - Path to the repository
 * @returns {Promise<string>} Current branch name
 */
export async function getCurrentBranchName(projectPath) {
  try {
    const { stdout } = await spawnGit(['symbolic-ref', '--short', 'HEAD'], { cwd: projectPath });
    const branchName = stdout.trim();
    if (branchName) {
      return branchName;
    }
  } catch (error) {
    // Fall back to rev-parse for detached HEAD and older git edge cases.
  }

  const { stdout } = await spawnGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectPath });
  return stdout.trim();
}

/**
 * Check whether a repository has any commits.
 * @param {string} projectPath - Path to the repository
 * @returns {Promise<boolean>} True if the repo has at least one commit
 */
export async function repositoryHasCommits(projectPath) {
  try {
    await spawnGit(['rev-parse', '--verify', 'HEAD'], { cwd: projectPath });
    return true;
  } catch (error) {
    if (isMissingHeadRevisionError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Get the root path of the git repository containing projectPath.
 * @param {string} projectPath - Path inside the repository
 * @returns {Promise<string>} Absolute path to the repository root
 */
export async function getRepositoryRootPath(projectPath) {
  const { stdout } = await spawnGit(['rev-parse', '--show-toplevel'], { cwd: projectPath });
  return stdout.trim();
}

/**
 * Extract error details from a git error (message + stderr + stdout).
 * @param {Error} error - The error to extract details from
 * @returns {string} Combined error details
 */
export function getGitErrorDetails(error) {
  return `${error?.message || ''} ${error?.stderr || ''} ${error?.stdout || ''}`;
}

/**
 * Check if an error indicates a missing HEAD revision (empty repo).
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is about missing HEAD
 */
export function isMissingHeadRevisionError(error) {
  const errorDetails = getGitErrorDetails(error).toLowerCase();
  return errorDetails.includes('unknown revision')
    || errorDetails.includes('ambiguous argument')
    || errorDetails.includes('needed a single revision')
    || errorDetails.includes('bad revision');
}

/**
 * Normalize a file path for repository-relative comparison.
 * @param {string} filePath - File path to normalize
 * @returns {string} Normalized path
 */
export function normalizeRepositoryRelativeFilePath(filePath) {
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .trim();
}

/**
 * Parse git status --porcelain output to extract file paths.
 * @param {string} statusOutput - Output from git status --porcelain
 * @returns {string[]} Array of normalized file paths
 */
export function parseStatusFilePaths(statusOutput) {
  return statusOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .map((line) => {
      const statusPath = line.substring(3);
      const renamedFilePath = statusPath.split(' -> ')[1];
      return normalizeRepositoryRelativeFilePath(renamedFilePath || statusPath);
    })
    .filter(Boolean);
}

/**
 * Build candidate file paths for matching against git status output.
 * @param {string} projectPath - Project directory path
 * @param {string} repositoryRootPath - Repository root path
 * @param {string} filePath - File path to build candidates for
 * @returns {string[]} Array of candidate paths
 */
export function buildFilePathCandidates(projectPath, repositoryRootPath, filePath) {
  const normalizedFilePath = normalizeRepositoryRelativeFilePath(filePath);
  const projectRelativePath = normalizeRepositoryRelativeFilePath(path.relative(repositoryRootPath, projectPath));
  const candidates = [normalizedFilePath];

  if (
    projectRelativePath
    && projectRelativePath !== '.'
    && !normalizedFilePath.startsWith(`${projectRelativePath}/`)
  ) {
    candidates.push(`${projectRelativePath}/${normalizedFilePath}`);
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

/**
 * Resolve a file path within a repository, finding the best match
 * against git status output.
 * @param {string} projectPath - Project directory path
 * @param {string} filePath - File path to resolve
 * @returns {Promise<{ repositoryRootPath: string, repositoryRelativeFilePath: string }>}
 */
export async function resolveRepositoryFilePath(projectPath, filePath) {
  validateFilePath(filePath);

  const repositoryRootPath = await getRepositoryRootPath(projectPath);
  const candidateFilePaths = buildFilePathCandidates(projectPath, repositoryRootPath, filePath);

  for (const candidateFilePath of candidateFilePaths) {
    const { stdout } = await spawnGit(['status', '--porcelain', '--', candidateFilePath], { cwd: repositoryRootPath });
    if (stdout.trim()) {
      return {
        repositoryRootPath,
        repositoryRelativeFilePath: candidateFilePath,
      };
    }
  }

  // If the caller sent a bare filename (e.g. "hello.ts"), recover it from changed files.
  const normalizedFilePath = normalizeRepositoryRelativeFilePath(filePath);
  if (!normalizedFilePath.includes('/')) {
    const { stdout: repositoryStatusOutput } = await spawnGit(['status', '--porcelain'], { cwd: repositoryRootPath });
    const changedFilePaths = parseStatusFilePaths(repositoryStatusOutput);
    const suffixMatches = changedFilePaths.filter(
      (changedFilePath) => changedFilePath === normalizedFilePath || changedFilePath.endsWith(`/${normalizedFilePath}`),
    );

    if (suffixMatches.length === 1) {
      return {
        repositoryRootPath,
        repositoryRelativeFilePath: suffixMatches[0],
      };
    }
  }

  return {
    repositoryRootPath,
    repositoryRelativeFilePath: candidateFilePaths[0],
  };
}
