#!/usr/bin/env node
import crypto from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const packageJson = JSON.parse(
  await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
);

function getElectronVersion() {
  try {
    return JSON.parse(
      readFileSync(path.join(rootDir, 'node_modules', 'electron', 'package.json'), 'utf8'),
    ).version;
  } catch {
    try {
      return JSON.parse(
        readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'),
      ).packages['node_modules/electron'].version;
    } catch {
      throw new Error('Could not resolve an exact Electron version for server native rebuild.');
    }
  }
}

function mapArch(arch = process.arch) {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

function mapPlatform(platform = process.platform) {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'win';
  return 'linux';
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyRequired(stageDir, relativePath) {
  const from = path.join(rootDir, relativePath);
  if (!(await pathExists(from))) {
    throw new Error(`Required server bundle input is missing: ${relativePath}`);
  }
  await fs.cp(from, path.join(stageDir, relativePath), { recursive: true });
}

async function copyIfExists(stageDir, relativePath) {
  const from = path.join(rootDir, relativePath);
  if (!(await pathExists(from))) return;
  await fs.cp(from, path.join(stageDir, relativePath), { recursive: true });
}

async function writeServerPackageJson(stageDir) {
  const stagedPackageJson = {
    ...packageJson,
    scripts: {
      ...(packageJson.scripts || {}),
    },
  };
  // The bundle stage is not a git checkout with dev dependencies, so lifecycle
  // scripts such as Husky prepare must not run there. Dependency install scripts
  // still run; native modules need them before the Electron ABI rebuild below.
  delete stagedPackageJson.scripts.postinstall;
  delete stagedPackageJson.scripts.prepare;
  delete stagedPackageJson.scripts.prepublishOnly;
  await fs.writeFile(
    path.join(stageDir, 'package.json'),
    `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
    'utf8',
  );
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const platform = mapPlatform(process.env.CLOUDCLI_BUNDLE_PLATFORM || process.platform);
const arch = mapArch(process.env.CLOUDCLI_BUNDLE_ARCH || process.arch);
const version = packageJson.version;
const bundleName = `cloudcli-local-server-${version}-${platform}-${arch}.tar.gz`;
const bundleRoot = path.join(rootDir, 'release', 'local-server');
const stageDir = path.join(bundleRoot, `.stage-${version}-${platform}-${arch}`);
const archivePath = path.join(bundleRoot, bundleName);

await fs.rm(stageDir, { recursive: true, force: true });
await fs.mkdir(stageDir, { recursive: true });
await fs.mkdir(bundleRoot, { recursive: true });

await copyRequired(stageDir, 'dist');
await copyRequired(stageDir, 'dist-server');
await copyRequired(stageDir, 'public');
await copyRequired(stageDir, 'shared');
await copyRequired(stageDir, 'package-lock.json');
await copyIfExists(stageDir, 'scripts/fix-node-pty.js');
await writeServerPackageJson(stageDir);

console.log('Installing production server dependencies into bundle stage...');
await run('npm', ['ci', '--omit=dev'], {
  cwd: stageDir,
  env: {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  },
});

const electronVersion = getElectronVersion();
const electronRebuild = process.platform === 'win32'
  ? path.join(rootDir, 'node_modules', '.bin', 'electron-rebuild.cmd')
  : path.join(rootDir, 'node_modules', '.bin', 'electron-rebuild');
console.log(`Rebuilding native server dependencies for Electron ${electronVersion} (${arch})...`);
await run(electronRebuild, ['--version', electronVersion, '--module-dir', stageDir, '--arch', arch, '--force'], {
  cwd: rootDir,
  env: {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  },
});

if (await pathExists(path.join(stageDir, 'scripts', 'fix-node-pty.js'))) {
  await run(process.execPath, ['scripts/fix-node-pty.js'], { cwd: stageDir });
}

await fs.writeFile(
  path.join(stageDir, '.installed.json'),
  JSON.stringify({ version, platform, arch, builtAt: new Date().toISOString() }, null, 2),
  'utf8',
);

await fs.rm(archivePath, { force: true });
const tarArgs = process.platform === 'win32'
  ? ['-czf', archivePath, '-C', stageDir, '.']
  : ['-czf', archivePath, '-C', stageDir, '.'];
await run('tar', tarArgs);

const digest = await sha256(archivePath);
const checksumPath = `${archivePath}.sha256`;
await fs.writeFile(checksumPath, `${digest}  ${bundleName}\n`, 'utf8');
await fs.rm(stageDir, { recursive: true, force: true });

const size = (await fs.stat(archivePath)).size / 1024 / 1024;
console.log(`Wrote ${path.relative(rootDir, archivePath)} (${size.toFixed(1)} MB)`);
console.log(`Wrote ${path.relative(rootDir, checksumPath)}`);
