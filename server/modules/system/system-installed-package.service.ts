import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { SystemInstalledPackageCheckResult } from '@/shared/types.js';

type InstalledPackageCheckOptions = {
  /** Node binary the next start will use; the running server passes process.execPath. */
  nodeExecutable: string;
  environment: NodeJS.ProcessEnv;
  timeoutMilliseconds: number;
};

// Native modules whose binding must match the Node that starts the server. The
// check runs in the version doing the update, so it only loads the ones the
// installed release still lists in `dependencies`: a later release that drops
// or replaces one is not held to this release's list. Optional dependencies
// are left out because npm may skip them, and the server has to cope with that.
const NATIVE_MODULE_NAMES = ['better-sqlite3', 'node-pty'];

// Loads the named native modules from the install's own dependency tree, the
// way the next start will. better-sqlite3 only opens its binding when a
// database is created, so the script opens an in-memory one.
const NATIVE_MODULE_CHECK_SCRIPT = `
const path = require('node:path');
const { createRequire } = require('node:module');
const [appRoot, ...moduleNames] = process.argv.slice(1);
const requireFromInstall = createRequire(path.join(appRoot, 'package.json'));
const loaders = {
  'better-sqlite3': () => { const Database = requireFromInstall('better-sqlite3'); new Database(':memory:').close(); },
  'node-pty': () => requireFromInstall('node-pty'),
};
for (const moduleName of moduleNames) {
  try {
    loaders[moduleName]();
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
): Promise<{ failed: boolean; timedOut: boolean; output: string; errorOutput: string }> {
  return new Promise((resolve) => {
    execFile(options.nodeExecutable, argumentsList, {
      cwd: appRoot,
      env: options.environment,
      timeout: options.timeoutMilliseconds,
      windowsHide: true,
    }, (error, output, errorOutput) => {
      resolve({
        failed: Boolean(error),
        // execFile also kills a child that overflows its output buffer.
        timedOut: Boolean(error?.killed) && error?.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        output: String(output),
        errorOutput: String(errorOutput) || (error ? error.message : ''),
      });
    });
  });
}

// One line for the update response: the paragraph that starts at the first
// line naming an Error (an install without .env prints a notice before it),
// else at the first line. Node wraps some messages (a wrong-ABI binding names
// the .node file, then explains on the next lines), so the paragraph runs on
// until a blank line, a stack frame or a lead-in to a list, which is dropped
// ("...bindings file. Tried:" ends at "file."). It is capped, so a CLI that
// prints a wall of text still gives a reason that fits on a status line; Node's
// wrong-ABI explanation is five lines.
const SUMMARY_MAX_LINES = 6;
const SUMMARY_MAX_LENGTH = 600;

function summarizeError(text: string): string {
  const lines = text.split('\n').map((line) => line.trim());
  // Node's report of an uncaught error quotes the throwing source line first
  // (`throw new Error('...')`), so a line that starts with an error name wins
  // over one that only names one (cloudcli's own "❌ Error: ...").
  const errorLineIndex = [/^[A-Za-z]*Error\b/, /\b[A-Za-z]*Error\b/]
    .map((pattern) => lines.findIndex((line) => pattern.test(line)))
    .find((index) => index >= 0) ?? -1;
  const firstLineIndex = errorLineIndex >= 0 ? errorLineIndex : lines.findIndex(Boolean);
  const paragraph: string[] = [];
  let truncated = false;
  for (const line of firstLineIndex >= 0 ? lines.slice(firstLineIndex) : []) {
    if (!line || /^at\s/.test(line)) {
      break;
    }
    if (paragraph.length === SUMMARY_MAX_LINES) {
      truncated = true;
      break;
    }
    paragraph.push(line);
    if (line.endsWith(':')) {
      break;
    }
  }
  const joined = paragraph.join(' ');
  const summary = joined.replace(/\s+[^.:]*:$/, '') || joined;
  return truncated || summary.length > SUMMARY_MAX_LENGTH
    ? `${summary.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}…`
    : summary;
}

// True when the CLI's output names the version, bare or labelled ("1.37.5",
// "cloudcli v1.37.5"), but not when it only names another one ("1.37.50",
// "1.37.5-beta.1").
function outputNamesVersion(output: string, version: string): boolean {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w.])v?${escapedVersion}(?![\\w+-]|\\.\\w)`).test(output);
}

/** System module composition root: reads the version on disk before and after an update. */
export function readInstalledPackageVersion(appRoot: string): string | null {
  const version = readPackageJson(appRoot)?.version;
  return typeof version === 'string' ? version : null;
}

/**
 * System module composition root: proves a freshly installed npm package can
 * load, without starting a second server. The native modules it depends on
 * must load with the given Node binary (the #1075 failure class: a missing or
 * wrong-ABI binding), and its CLI must answer `version` with the version on
 * disk. Neither step touches a database, a port or the running process. Never
 * rejects.
 */
export async function checkInstalledPackage(
  appRoot: string,
  options: InstalledPackageCheckOptions,
): Promise<SystemInstalledPackageCheckResult> {
  const timeoutLabel = `${options.timeoutMilliseconds / 1000} s`;
  const packageJson = readPackageJson(appRoot);
  if (!packageJson) {
    return { passed: false, reason: 'the installed package.json could not be read', details: '' };
  }

  const declaredDependencies = packageJson.dependencies && typeof packageJson.dependencies === 'object'
    ? packageJson.dependencies as Record<string, unknown>
    : {};
  const nativeModuleNames = NATIVE_MODULE_NAMES.filter((moduleName) => moduleName in declaredDependencies);
  if (nativeModuleNames.length > 0) {
    const nativeCheck = await runNodeProcess(
      ['-e', NATIVE_MODULE_CHECK_SCRIPT, appRoot, ...nativeModuleNames],
      appRoot,
      options,
    );
    if (nativeCheck.failed) {
      return {
        passed: false,
        reason: nativeCheck.timedOut
          ? `${nativeModuleNames.join(' and ')} did not load within ${timeoutLabel}`
          : summarizeError(nativeCheck.errorOutput) || 'native modules failed to load',
        details: nativeCheck.errorOutput,
      };
    }
  }

  const binField = packageJson.bin;
  const cliEntry = typeof binField === 'string'
    ? binField
    : (binField as Record<string, unknown> | undefined)?.cloudcli;
  if (typeof cliEntry !== 'string') {
    return { passed: false, reason: 'package.json has no cloudcli executable', details: '' };
  }

  const cliEntryPath = path.join(appRoot, cliEntry);
  const versionCheck = await runNodeProcess([cliEntryPath, 'version'], appRoot, options);
  const expectedVersion = typeof packageJson.version === 'string' ? packageJson.version : null;
  if (!versionCheck.failed && (expectedVersion === null || outputNamesVersion(versionCheck.output, expectedVersion))) {
    return { passed: true };
  }

  const reportedVersion = versionCheck.output.trim().split('\n').pop()?.trim() ?? '';
  const errorLine = summarizeError(versionCheck.errorOutput);
  let reason = `"cloudcli version" printed "${reportedVersion}" instead of ${expectedVersion}`;
  if (versionCheck.timedOut) {
    reason = `"cloudcli version" did not answer within ${timeoutLabel}`;
  } else if (versionCheck.failed) {
    reason = `"cloudcli version" failed${errorLine ? `: ${errorLine}` : ''}`;
  }
  return {
    passed: false,
    reason,
    details: `$ ${options.nodeExecutable} ${cliEntryPath} version\n${versionCheck.output}${versionCheck.errorOutput}`,
  };
}
