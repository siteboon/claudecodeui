/**
 * electron-builder hooks for Workbench.
 *
 * - node-pty ships N-API prebuilds, so it must not be rebuilt (a rebuild needs the
 *   Spectre-mitigated MSVC libraries on Windows and is unnecessary).
 * - better-sqlite3 is ABI specific: it is rebuilt for Electron here, then restored
 *   for the system Node afterwards so `npm run dev` keeps working.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

exports.beforeBuild = async (context) => {
  const result = spawnSync(
    npx,
    ['@electron/rebuild', '-f', '-o', 'better-sqlite3', '-v', context.electronVersion, '-a', context.arch],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) {
    throw new Error('Rebuilding better-sqlite3 for Electron failed.');
  }
  // Returning false tells electron-builder to skip its own native rebuild.
  return false;
};

exports.afterAllArtifactBuild = async () => {
  spawnSync(npm, ['rebuild', 'better-sqlite3'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return [];
};
