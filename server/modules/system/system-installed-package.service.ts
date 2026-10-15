import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type InstalledPackageCheckOptions = {
  /** Node binary the next start will use; the running server passes process.execPath. */
  nodeExecutable: string;
  environment: NodeJS.ProcessEnv;
  timeoutMilliseconds: number;
};

// Loads the native modules from the install's own dependency tree, the way the
// next start will. better-sqlite3 only opens its binding when a database is
// created, so the script opens an in-memory one.
const NATIVE_MODULE_CHECK_SCRIPT = `
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFromInstall = createRequire(path.join(process.argv[1], 'package.json'));
const checks = [
  ['better-sqlite3', () => { const Database = requireFromInstall('better-sqlite3'); new Database(':memory:').close(); }],
  ['node-pty', () => requireFromInstall('node-pty')],
];
for (const [moduleName, load] of checks) {
  try {
    load();
  } catch (error) {
    console.error(moduleName + ': ' + (error && error.message ? error.message : String(error)));
    process.exit(1);
  }
}
`;

function readPackageJson(appRoot: string): Record<string, unknown> | null {
  try {
    const packageJson: unknown = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    return packageJson && typeof packageJson === 'object' ? packageJson as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function runNodeProcess(
  argumentsList: string[],
  appRoot: string,
  options: InstalledPackageCheckOptions,
): Promise<{ failed: boolean; output: string; errorOutput: string }> {
  return new Promise((resolve) => {
    execFile(options.nodeExecutable, argumentsList, {
      cwd: appRoot,
      env: options.environment,
      timeout: options.timeoutMilliseconds,
      windowsHide: true,
    }, (error, output, errorOutput) => {
      resolve({
        failed: Boolean(error),
        output: String(output),
        errorOutput: String(errorOutput) || (error ? error.message : ''),
      });
    });
  });
}

// One line for the update response: the first line naming an Error (an
// install without .env prints a notice before it), else the first line, minus
// a trailing lead-in to a list ("...bindings file. Tried:" ends at "file.").
function summarizeError(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const summaryLine = lines.find((line) => /\b[A-Za-z]*Error\b/.test(line)) ?? lines[0] ?? '';
  return summaryLine.replace(/\s+[^.:]*:$/, '') || summaryLine;
}

/** System module composition root: reads the version on disk before and after an update. */
export function readInstalledPackageVersion(appRoot: string): string | null {
  const version = readPackageJson(appRoot)?.version;
  return typeof version === 'string' ? version : null;
}

/**
 * System module composition root: proves a freshly installed npm package can
 * load, without starting a second server. Its native modules must load with the
 * given Node binary (the #1075 failure class: a missing or wrong-ABI binding),
 * and its CLI must answer `version` with the version on disk. Neither step
 * touches a database, a port or the running process. Never rejects.
 */
export async function checkInstalledPackage(
  appRoot: string,
  options: InstalledPackageCheckOptions,
): Promise<{ passed: true } | { passed: false; reason: string; details: string }> {
  const nativeCheck = await runNodeProcess(['-e', NATIVE_MODULE_CHECK_SCRIPT, appRoot], appRoot, options);
  if (nativeCheck.failed) {
    return {
      passed: false,
      reason: summarizeError(nativeCheck.errorOutput) || 'native modules failed to load',
      details: nativeCheck.errorOutput,
    };
  }

  const packageJson = readPackageJson(appRoot);
  const binField = packageJson?.bin;
  const cliEntry = typeof binField === 'string'
    ? binField
    : (binField as Record<string, unknown> | undefined)?.cloudcli;
  if (typeof cliEntry !== 'string') {
    return { passed: false, reason: 'package.json has no cloudcli executable', details: '' };
  }

  const cliEntryPath = path.join(appRoot, cliEntry);
  const versionCheck = await runNodeProcess([cliEntryPath, 'version'], appRoot, options);
  const reportedVersion = versionCheck.output.trim().split('\n').pop()?.trim() ?? '';
  const expectedVersion = readInstalledPackageVersion(appRoot);
  if (!versionCheck.failed && (expectedVersion === null || reportedVersion === expectedVersion)) {
    return { passed: true };
  }

  const errorLine = summarizeError(versionCheck.errorOutput);
  return {
    passed: false,
    reason: versionCheck.failed
      ? `"cloudcli version" failed${errorLine ? `: ${errorLine}` : ''}`
      : `"cloudcli version" printed "${reportedVersion}" instead of ${expectedVersion}`,
    details: `$ ${options.nodeExecutable} ${cliEntryPath} version\n${versionCheck.output}${versionCheck.errorOutput}`,
  };
}
