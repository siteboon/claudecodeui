#!/usr/bin/env node
// @siteboon/claude-code-ui is the old name of @cloudcli-ai/cloudcli, so this bin only forwards to that package.
// Start the CLI file that the installed @cloudcli-ai/cloudcli declares in its package.json "bin" instead of a
// hard-coded path: the entry point has moved several times, and every move broke this wrapper.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_PACKAGE = '@cloudcli-ai/cloudcli';
const TARGET_BIN = 'cloudcli';

const require = createRequire(import.meta.url);

function findTargetPackageJson() {
  try {
    return require.resolve(`${TARGET_PACKAGE}/package.json`);
  } catch (error) {
    // An "exports" map that leaves out ./package.json hides it from require.resolve even though the file is
    // installed, so fall back to searching the same node_modules folders Node itself would search.
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    for (const directory of require.resolve.paths(TARGET_PACKAGE) ?? []) {
      const candidate = path.join(directory, TARGET_PACKAGE, 'package.json');
      if (existsSync(candidate)) return candidate;
    }
    throw error;
  }
}

function resolveTargetCliPath() {
  const packageJsonPath = findTargetPackageJson();
  const { bin } = require(packageJsonPath);
  // npm treats a string "bin" as a single command named after the unscoped package name ("cloudcli").
  const entry = typeof bin === 'string' ? bin : bin?.[TARGET_BIN];
  if (typeof entry !== 'string' || entry === '') {
    throw new Error(`${packageJsonPath} does not declare a "${TARGET_BIN}" bin`);
  }
  return path.resolve(path.dirname(packageJsonPath), entry);
}

let cliPath;
try {
  cliPath = resolveTargetCliPath();
} catch (error) {
  const reason = String(error?.message ?? error).split('\n')[0];
  console.error(`@siteboon/claude-code-ui could not find the ${TARGET_PACKAGE} CLI: ${reason}`);
  console.error(`This package has moved. Install the CLI directly with: npm install -g ${TARGET_PACKAGE}`);
  process.exit(1);
}

// No top-level await: require(esm) refuses graphs that use it, and a CommonJS wrapper may require() this bin. Exit
// explicitly on failure, since an IPC channel or a handle the CLI opened would keep the process alive.
import(pathToFileURL(cliPath).href).catch((error) => {
  console.error(error);
  process.exit(1);
});
