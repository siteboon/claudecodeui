/**
 * Resolves a project name to either a local path or remote host + path.
 * Local projects are resolved via extractProjectDirectory; remote projects
 * use the `remote:<hostId>:<base64Path>` naming convention.
 * @module remote/project-resolver
 */

import path from 'path';
import { remoteHostsDb } from './remote-hosts-db.js';
import { extractProjectDirectory } from '../projects.js';

/**
 * @typedef {object} ResolvedLocal
 * @property {false} isRemote
 * @property {string} localPath - Absolute path on this machine
 */

/**
 * @typedef {object} ResolvedRemote
 * @property {true} isRemote
 * @property {string} hostId - UUID of the remote host in the database
 * @property {string} remotePath - Absolute path on the remote machine
 */

/**
 * Resolve a project name to a local or remote context.
 *
 * Remote project names follow the format `remote:<hostId>:<base64EncodedPath>`.
 * Everything else is treated as a local project and delegated to
 * `extractProjectDirectory`.
 *
 * @param {string} projectName
 * @returns {Promise<ResolvedLocal | ResolvedRemote>}
 */
export async function resolveProject(projectName) {
  if (projectName.startsWith('remote:')) {
    const parts = projectName.split(':');
    // Format: remote:<hostId>:<base64EncodedPath>
    if (parts.length < 3) {
      throw new Error('Invalid remote project format. Expected remote:<hostId>:<base64Path>');
    }

    const hostId = parts[1];
    const encoded = parts.slice(2).join(':');
    const remotePath = Buffer.from(encoded, 'base64').toString('utf8');
    if (!remotePath || !path.isAbsolute(remotePath)) {
      throw new Error('Invalid remote project path');
    }

    const host = remoteHostsDb.getById(hostId);
    if (!host) {
      throw new Error('Remote host not found');
    }

    return { isRemote: true, hostId, remotePath };
  }

  // Local project — delegate to the existing resolver
  const localPath = await extractProjectDirectory(projectName);
  return { isRemote: false, localPath };
}
