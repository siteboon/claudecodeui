/** @module remote/deployer */

import { readFile, stat } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DAEMON_REMOTE_DIR, DAEMON_REMOTE_PATH } from '../constants/remote.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOCAL_DAEMON_PATH = resolve(__dirname, '../../dist/ccud.mjs');
const CCUD_PKG_PATH = resolve(__dirname, '../../ccud/package.json');

/**
 * Execute a command on a remote host via ssh2 client.exec().
 * NOTE: This uses ssh2's sshClient.exec() API which runs commands on the
 * REMOTE host over SSH. This is NOT Node.js child_process.exec.
 * @param {object} sshClient - ssh2 Client instance
 * @param {string} command - Command to execute on the remote host
 * @param {object} [options] - Options
 * @param {object} [options.env] - Additional environment variables
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function sshExec(sshClient, command, options = {}) {
  return new Promise((resolve, reject) => {
    sshClient.exec(command, { env: { TERM: 'dumb', ...options.env } }, (err, channel) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      channel.on('data', (data) => {
        stdout += data.toString();
      });

      channel.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      channel.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });
    });
  });
}

/**
 * Check whether Node.js 20+ is available on the remote host.
 * @param {object} sshClient - ssh2 Client instance
 * @returns {Promise<{ok: boolean, version: string|null, error?: string}>}
 */
export async function checkRemoteNodeVersion(sshClient) {
  const result = await sshExec(sshClient, 'node --version');

  if (result.code !== 0) {
    return {
      ok: false,
      version: null,
      error: 'Node.js not found on remote host. Install Node.js 20+ to use remote projects.',
    };
  }

  const major = parseInt(result.stdout.trim().replace('v', '').split('.')[0], 10);

  if (isNaN(major)) {
    return {
      ok: false,
      version: null,
      error: 'Node.js not found on remote host. Install Node.js 20+ to use remote projects.',
    };
  }

  if (major < 20) {
    return {
      ok: false,
      version: result.stdout.trim(),
      error: 'Node.js 20+ required on remote host, found: ' + result.stdout.trim(),
    };
  }

  return { ok: true, version: result.stdout.trim() };
}

/**
 * Read the local daemon version from ccud/package.json.
 * @returns {Promise<string>}
 */
export async function getLocalDaemonVersion() {
  try {
    const raw = await readFile(CCUD_PKG_PATH, 'utf8');
    const pkg = JSON.parse(raw);
    return pkg.version;
  } catch {
    throw new Error('ccud/package.json not found. Run npm run build:daemon first.');
  }
}

/**
 * Read the daemon version currently deployed on the remote host.
 * @param {object} sshClient - ssh2 Client instance
 * @returns {Promise<string|null>}
 */
export async function getRemoteDaemonVersion(sshClient) {
  const result = await sshExec(sshClient, 'cat ~/.ccud/daemon-version 2>/dev/null || echo ""');
  return result.stdout.trim() || null;
}

/**
 * Deploy the ccud daemon to a remote host via SFTP.
 * Uses atomic staging (temp file + rename) to prevent partially-written daemons.
 *
 * @param {object} sshClient - ssh2 Client instance
 * @param {object} [options] - Deploy options
 * @param {boolean} [options.force] - Skip version check and force re-deploy
 * @returns {Promise<{deployed: boolean, version: string, reason: string}>}
 */
export async function deployDaemon(sshClient, options = {}) {
  // 1. Verify local daemon exists
  try {
    await stat(LOCAL_DAEMON_PATH);
  } catch {
    throw new Error('dist/ccud.mjs not found. Run npm run build:daemon first.');
  }

  // 2. Get local version
  const localVersion = await getLocalDaemonVersion();

  // 3. Version check (unless forced)
  if (!options.force) {
    const remoteVersion = await getRemoteDaemonVersion(sshClient);
    if (remoteVersion === localVersion) {
      return { deployed: false, version: localVersion, reason: 'up-to-date' };
    }
  }

  // 4. Check Node.js on remote
  const nodeCheck = await checkRemoteNodeVersion(sshClient);
  if (!nodeCheck.ok) {
    throw new Error(nodeCheck.error);
  }

  // 5. Get remote home directory
  const homeResult = await sshExec(sshClient, 'echo $HOME');
  const remoteHome = homeResult.stdout.trim();

  // 6. Create remote directory
  await sshExec(sshClient, 'mkdir -p ~/' + DAEMON_REMOTE_DIR);

  // 7. Open SFTP and upload
  let sftp;
  try {
    sftp = await new Promise((resolve, reject) => {
      sshClient.sftp((err, s) => {
        if (err) return reject(err);
        resolve(s);
      });
    });

    // 8. Upload to staging path
    const remoteStagingPath = remoteHome + '/' + DAEMON_REMOTE_DIR + '/.ccud-staging.mjs';
    await new Promise((resolve, reject) => {
      sftp.fastPut(LOCAL_DAEMON_PATH, remoteStagingPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  } finally {
    if (sftp) sftp.end();
  }

  // 9. Get local file size for verification
  const localStat = await stat(LOCAL_DAEMON_PATH);

  // 10. Atomic rename + chmod
  await sshExec(sshClient, 'mv ~/' + DAEMON_REMOTE_DIR + '/.ccud-staging.mjs ~/' + DAEMON_REMOTE_PATH + ' && chmod +x ~/' + DAEMON_REMOTE_PATH);

  // 11. Verify size
  const sizeResult = await sshExec(sshClient, 'stat -c%s ~/' + DAEMON_REMOTE_PATH + ' 2>/dev/null || stat -f%z ~/' + DAEMON_REMOTE_PATH);
  const remoteSize = parseInt(sizeResult.stdout.trim(), 10);
  if (remoteSize !== localStat.size) {
    console.warn('[Deployer] Size mismatch: local=' + localStat.size + ' remote=' + remoteSize);
  }

  // 12. Write version marker
  await sshExec(sshClient, "echo '" + localVersion + "' > ~/" + DAEMON_REMOTE_DIR + '/daemon-version');

  return { deployed: true, version: localVersion, reason: options.force ? 'forced' : 'version-mismatch' };
}
