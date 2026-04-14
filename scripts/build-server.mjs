import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'dist-server');
const SERVER_TSCONFIG_PATH = 'server/tsconfig.json';

function getPackageBinaryPath(packageName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const binField = packageJson.bin;
  const binaryRelativePath =
    typeof binField === 'string'
      ? binField
      : binField?.[packageName] ?? Object.values(binField ?? {})[0];

  if (!binaryRelativePath) {
    throw new Error(`Could not find a runnable binary for ${packageName}.`);
  }

  return path.resolve(path.dirname(packageJsonPath), binaryRelativePath);
}

function runPackageBinary(packageName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [getPackageBinaryPath(packageName), ...args], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${packageName} exited with code ${code}.`));
    });
  });
}

async function main() {
  // Clean first so removed server files do not linger in dist-server and shadow newer source changes.
  await fsPromises.rm(OUTPUT_DIR, { recursive: true, force: true });

  await runPackageBinary('typescript', ['-p', SERVER_TSCONFIG_PATH]);
  await runPackageBinary('tsc-alias', ['-p', SERVER_TSCONFIG_PATH]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
