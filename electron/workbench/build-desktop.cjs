/**
 * Builds the desktop app: client + server, generated builder config, electron-builder, and then
 * ALWAYS puts better-sqlite3 back to the system-Node build (electron-builder rebuilds it for
 * Electron inside this checkout, which would break `npm run dev` / `desktop:workbench` if a
 * build fails or is interrupted).
 *
 * Usage: node build-desktop.cjs <win|mac> [--dir]
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const target = process.argv[2] === 'mac' ? 'mac' : 'win';
const extra = process.argv.includes('--dir') ? ['--dir'] : [];
const shell = process.platform === 'win32';
const run = (command, args) => spawnSync(command, args, { cwd: root, stdio: 'inherit', shell }).status;

let status = run('npm', ['run', 'build']);
try {
  if (status === 0) status = run('node', ['electron/workbench/make-builder-config.cjs', target]);
  if (status === 0) {
    status = run('npx', ['electron-builder', '--config', 'electron-builder.workbench.generated.json', `--${target}`, ...extra]);
  }
} finally {
  console.log('Restoring better-sqlite3 for the system Node...');
  run('npm', ['rebuild', 'better-sqlite3']);
}
process.exit(status ?? 1);
