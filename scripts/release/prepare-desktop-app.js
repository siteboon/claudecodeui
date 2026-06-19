#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const stageDir = path.join(rootDir, '.desktop-build', 'desktop-app');

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
      throw new Error('Could not resolve an exact Electron version for desktop packaging.');
    }
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyRequired(relativePath) {
  const from = path.join(rootDir, relativePath);
  const to = path.join(stageDir, relativePath);
  if (!(await pathExists(from))) {
    throw new Error(`Required desktop build input is missing: ${relativePath}`);
  }
  await fs.cp(from, to, { recursive: true });
}

async function copyIfExists(relativePath) {
  const from = path.join(rootDir, relativePath);
  if (!(await pathExists(from))) return false;
  await fs.cp(from, path.join(stageDir, relativePath), { recursive: true });
  return true;
}

async function copyNodeModule(packageName) {
  const parts = packageName.split('/');
  const source = path.join(rootDir, 'node_modules', ...parts);
  if (!(await pathExists(source))) return false;

  const target = path.join(stageDir, 'node_modules', ...parts);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true });
  return true;
}

function buildDesktopPackageJson(copiedOptionalDependencies) {
  return {
    name: `${packageJson.name}-desktop`,
    version: packageJson.version,
    productName: packageJson.productName,
    description: `${packageJson.productName} desktop shell`,
    author: packageJson.author,
    license: packageJson.license,
    type: 'module',
    main: 'electron/main.js',
    dependencies: {
      ws: packageJson.dependencies.ws,
    },
    optionalDependencies: copiedOptionalDependencies,
    build: {
      appId: packageJson.build.appId,
      productName: packageJson.build.productName,
      asar: packageJson.build.asar,
      artifactName: packageJson.build.artifactName,
      electronVersion: getElectronVersion(),
      directories: {
        output: '../../release/desktop',
      },
      extraMetadata: {
        main: 'electron/main.js',
      },
      files: [
        'electron/**',
        'public/**',
        'dist/**',
        'dist-server/**',
        'node_modules/**',
        'package.json',
      ],
      protocols: packageJson.build.protocols,
      mac: packageJson.build.mac,
      win: packageJson.build.win,
    },
  };
}

await fs.rm(stageDir, { recursive: true, force: true });
await fs.mkdir(stageDir, { recursive: true });

await copyRequired('electron');
await copyRequired('dist');
await copyRequired('public');

// The desktop app still ships the standalone Computer Use desktop agent, but
// not the full local server. Local CloudCLI is downloaded on demand.
await copyRequired('dist-server/server/computer-use-agent.js');
await copyIfExists('dist-server/server/computer-use-agent.js.map');
await copyRequired('dist-server/server/modules/computer-use');

const copiedRuntimeDependencies = [];
if (await copyNodeModule('ws')) {
  copiedRuntimeDependencies.push('ws');
} else {
  throw new Error('Required desktop dependency is missing from node_modules: ws');
}

const copiedOptionalDependencies = {};
for (const [name, version] of Object.entries(packageJson.optionalDependencies || {})) {
  if (await copyNodeModule(name)) {
    copiedOptionalDependencies[name] = version;
  }
}

for (const name of [
  '@nut-tree-fork/default-clipboard-provider',
  '@nut-tree-fork/libnut',
  '@nut-tree-fork/provider-interfaces',
  '@nut-tree-fork/shared',
  'jimp',
  'node-abort-controller',
  'temp',
]) {
  await copyNodeModule(name);
}

await fs.writeFile(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify(buildDesktopPackageJson(copiedOptionalDependencies), null, 2)}\n`,
  'utf8',
);

console.log(`Prepared thin desktop app at ${path.relative(rootDir, stageDir)}`);
console.log(`Runtime dependencies: ${copiedRuntimeDependencies.join(', ')}`);
if (Object.keys(copiedOptionalDependencies).length) {
  console.log(`Optional dependencies: ${Object.keys(copiedOptionalDependencies).join(', ')}`);
}
