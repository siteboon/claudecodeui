/**
 * @module ccud/handlers/fs
 * Filesystem operation handlers for all fs/* RPC methods.
 * Produces FileTreeNode output matching server's getFileTree shape.
 */
import { readFile, writeFile, mkdir, rename, unlink, rm, stat, readdir, access } from 'fs/promises';
import path, { join, dirname } from 'path';
import { constants } from 'fs';

/**
 * Validate that a file path does not escape the project root.
 * @param {string} filePath - The path to validate
 * @param {string} projectRoot - The project root directory
 * @returns {{ resolved: string } | { error: { code: number, message: string } }}
 */
function validatePath(filePath, projectRoot) {
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(projectRoot, filePath);
  const root = path.resolve(projectRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return { error: { code: -32001, message: 'Path outside project root' } };
  }
  return { resolved };
}

/**
 * Maps Node.js filesystem error codes to JSON-RPC error codes.
 * @private
 */
const FS_ERROR_CODES = {
  ENOENT: { code: -32001, message: 'File or directory not found' },
  EACCES: { code: -32002, message: 'Permission denied' },
  EPERM: { code: -32002, message: 'Permission denied' },
  EEXIST: { code: -32003, message: 'Already exists' },
  ENOTEMPTY: { code: -32004, message: 'Directory not empty' },
  ENOSPC: { code: -32005, message: 'No space left on device' },
};

/**
 * Map a filesystem error to a JSON-RPC error response.
 * @param {Error} err - Node.js filesystem error
 * @returns {{ error: { code: number, message: string } }}
 */
function mapFsError(err) {
  const mapped = FS_ERROR_CODES[err.code];
  if (mapped) {
    return { error: { code: mapped.code, message: mapped.message } };
  }
  return { error: { code: -32000, message: err.message } };
}

/**
 * Convert a single permission digit to rwx string.
 * @param {number} perm - Permission digit (0-7)
 * @returns {string} Three-character rwx string
 */
function permToRwx(perm) {
  const r = perm & 4 ? 'r' : '-';
  const w = perm & 2 ? 'w' : '-';
  const x = perm & 1 ? 'x' : '-';
  return r + w + x;
}

/**
 * Recursively read a directory tree, producing FileTreeNode[] output
 * identical in shape to server's getFileTree function.
 *
 * @param {string} dirPath - Absolute path to directory
 * @param {number} maxDepth - Maximum recursion depth
 * @param {number} currentDepth - Current recursion depth
 * @param {boolean} showHidden - Whether to include hidden files
 * @returns {Promise<Array>} Array of FileTreeNode objects
 */
async function getFileTree(dirPath, maxDepth, currentDepth, showHidden) {
  const items = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip heavy build directories and VCS directories
      if (entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '.git' ||
        entry.name === '.svn' ||
        entry.name === '.hg') continue;

      // Filter hidden files/directories when showHidden is false
      if (!showHidden && entry.name.startsWith('.')) continue;

      const itemPath = join(dirPath, entry.name);
      const item = {
        name: entry.name,
        path: itemPath,
        type: entry.isDirectory() ? 'directory' : 'file',
      };

      // Get file stats for additional metadata
      try {
        const stats = await stat(itemPath);
        item.size = stats.size;
        item.modified = stats.mtime.toISOString();

        // Convert permissions to rwx format
        const mode = stats.mode;
        const ownerPerm = (mode >> 6) & 7;
        const groupPerm = (mode >> 3) & 7;
        const otherPerm = mode & 7;
        item.permissions = ownerPerm.toString() + groupPerm.toString() + otherPerm.toString();
        item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
      } catch (statError) {
        // If stat fails, provide default values
        item.size = 0;
        item.modified = null;
        item.permissions = '000';
        item.permissionsRwx = '---------';
      }

      if (entry.isDirectory() && currentDepth < maxDepth) {
        // Recursively get subdirectories but limit depth
        try {
          // Check if we can access the directory before trying to read it
          await access(itemPath, constants.R_OK);
          item.children = await getFileTree(itemPath, maxDepth, currentDepth + 1, showHidden);
        } catch (e) {
          // Silently skip directories we can't access (permission denied, etc.)
          item.children = [];
        }
      }

      items.push(item);
    }
  } catch (error) {
    // Only log non-permission errors to avoid spam
    if (error.code !== 'EACCES' && error.code !== 'EPERM') {
      // In daemon context, silently return empty -- errors propagate via JSON-RPC
    }
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Handle all fs/* JSON-RPC methods.
 *
 * Supported methods:
 * - fs/readdir: Read directory tree (returns FileTreeNode[])
 * - fs/readFile: Read file content as UTF-8
 * - fs/writeFile: Write content to file
 * - fs/stat: Get file/directory stats
 * - fs/create: Create new file or directory
 * - fs/rename: Rename file or directory
 * - fs/delete: Delete file or directory
 * - fs/exists: Check if path exists
 *
 * @param {string} method - The RPC method name (e.g., 'fs/readdir')
 * @param {object} params - Method parameters
 * @returns {Promise<object>} Result object or error object with { error: { code, message } }
 */
export async function handleFs(method, params) {
  try {
    switch (method) {
      case 'fs/readdir': {
        const base = params.cwd || params.path;
        const v = validatePath(params.path, base);
        if (v.error) return v;
        return await getFileTree(
          v.resolved,
          params.maxDepth ?? 10,
          0,
          params.showHidden ?? true,
        );
      }

      case 'fs/readFile': {
        if (params.cwd) {
          const v = validatePath(params.path, params.cwd);
          if (v.error) return v;
          params.path = v.resolved;
        }
        const content = await readFile(params.path, 'utf8');
        return { content };
      }

      case 'fs/writeFile': {
        if (params.cwd) {
          const v = validatePath(params.path, params.cwd);
          if (v.error) return v;
          params.path = v.resolved;
        }
        await writeFile(params.path, params.content, 'utf8');
        return { success: true };
      }

      case 'fs/stat': {
        if (params.cwd) {
          const v = validatePath(params.path, params.cwd);
          if (v.error) return v;
          params.path = v.resolved;
        }
        const stats = await stat(params.path);
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
      }

      case 'fs/create': {
        const fullPath = join(params.path, params.name);
        const base = params.cwd || params.path;
        const vCreate = validatePath(fullPath, base);
        if (vCreate.error) return vCreate;
        if (params.type === 'directory') {
          await mkdir(vCreate.resolved, { recursive: true });
        } else {
          // Ensure parent directory exists
          const parentDir = dirname(vCreate.resolved);
          try {
            await access(parentDir);
          } catch {
            await mkdir(parentDir, { recursive: true });
          }
          await writeFile(vCreate.resolved, '', 'utf8');
        }
        return { path: vCreate.resolved, name: params.name, type: params.type };
      }

      case 'fs/rename': {
        if (params.cwd) {
          const vOld = validatePath(params.oldPath, params.cwd);
          if (vOld.error) return vOld;
          params.oldPath = vOld.resolved;
        }
        const newPath = join(dirname(params.oldPath), params.newName);
        if (params.cwd) {
          const vNew = validatePath(newPath, params.cwd);
          if (vNew.error) return vNew;
        }
        await rename(params.oldPath, newPath);
        return { oldPath: params.oldPath, newPath, newName: params.newName };
      }

      case 'fs/delete': {
        if (params.cwd) {
          const v = validatePath(params.path, params.cwd);
          if (v.error) return v;
          params.path = v.resolved;
        }
        const s = await stat(params.path);
        if (s.isDirectory()) {
          await rm(params.path, { recursive: true, force: true });
        } else {
          await unlink(params.path);
        }
        return { success: true };
      }

      case 'fs/exists': {
        if (params.cwd) {
          const v = validatePath(params.path, params.cwd);
          if (v.error) return v;
          params.path = v.resolved;
        }
        try {
          await access(params.path);
          return { exists: true };
        } catch {
          return { exists: false };
        }
      }

      default:
        return { error: { code: -32601, message: 'Method not implemented: ' + method } };
    }
  } catch (err) {
    return mapFsError(err);
  }
}
