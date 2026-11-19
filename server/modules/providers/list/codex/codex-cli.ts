import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { CliVersionProbe } from '@/shared/types.js';
import { isNewerVersion, probeCliVersion } from '@/shared/utils.js';

/**
 * Which Codex CLI CloudCLI runs.
 *
 * CloudCLI depends on a pinned `@openai/codex`, and a machine may also have
 * the user's own Codex (standalone installer, npm, bun, pnpm, Homebrew). The
 * user's install is the one on the server's PATH, the same one a terminal
 * runs, and only that one can be updated without rebuilding CloudCLI. So it
 * wins whenever it is at least as new as the bundled one. An older install
 * loses: chats, forks and side questions are only known to work with the
 * version CloudCLI ships, so CloudCLI never runs one older than that.
 *
 * Nothing is cached. An update replaces the binary, and the next chat, fork
 * or Shell launch must start the new one without a server restart. Resolving
 * costs a PATH scan and two native `--version` runs, a few milliseconds.
 */

const CODEX_PACKAGE_NAME = '@openai/codex';

/** Native target triple and npm platform package per platform and CPU, as the official launcher and SDK map them. */
const CODEX_TARGETS: Record<string, { triple: string; platformPackage: string }> = {
  'linux-x64': { triple: 'x86_64-unknown-linux-musl', platformPackage: '@openai/codex-linux-x64' },
  'linux-arm64': { triple: 'aarch64-unknown-linux-musl', platformPackage: '@openai/codex-linux-arm64' },
  'darwin-x64': { triple: 'x86_64-apple-darwin', platformPackage: '@openai/codex-darwin-x64' },
  'darwin-arm64': { triple: 'aarch64-apple-darwin', platformPackage: '@openai/codex-darwin-arm64' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', platformPackage: '@openai/codex-win32-x64' },
  'win32-arm64': { triple: 'aarch64-pc-windows-msvc', platformPackage: '@openai/codex-win32-arm64' },
};

/** One Codex installation and how to start it. */
type CodexCli = {
  /** `user`: the `codex` on the server's PATH. `bundled`: the `@openai/codex` package CloudCLI depends on. */
  source: 'user' | 'bundled';
  /**
   * Program and leading arguments that start the CLI the way a terminal does.
   * An npm install runs its `bin/codex.js` through this server's Node: that
   * launcher tells the native binary which package manager owns it, which
   * `codex update` needs, and it needs no `node` on PATH this way.
   */
  command: string;
  commandArgs: string[];
  /** What a user would type to run this install: its PATH entry, or the bundled launcher. */
  displayCommand: string;
  /** A native binary that starts without a shell or Node, for the SDK. */
  executablePath: string;
  /** Helper directories (Codex's ripgrep) the npm launcher puts first on PATH. */
  pathDirs: string[];
  /** What `--version` of `executablePath` reported. */
  probe: CliVersionProbe;
};

type NativeCodex = Pick<CodexCli, 'executablePath' | 'pathDirs'>;

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function isExecutableFile(filePath: string): boolean {
  if (!isFile(filePath)) {
    return false;
  }
  if (process.platform === 'win32') {
    return true;
  }
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the binary in one `<triple>` folder. Current packages and the
 * standalone installer use `bin/codex` with helpers in `codex-path`; older npm
 * packages used `codex/codex` with helpers in `path`.
 */
function findNativeInTargetDir(targetDir: string): NativeCodex | null {
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const [binaryDir, helperDir] of [['bin', 'codex-path'], ['codex', 'path']] as const) {
    const executablePath = path.join(targetDir, binaryDir, binaryName);
    if (isFile(executablePath)) {
      const helpers = path.join(targetDir, helperDir);
      return { executablePath, pathDirs: isDirectory(helpers) ? [helpers] : [] };
    }
  }
  return null;
}

/**
 * Describes an `@openai/codex` npm package: its Node launcher and the native
 * binary that launcher would start. The binary lives in an optional platform
 * package, or in the package's own `vendor` folder in older releases. null
 * when the package is not Codex or its binary is missing.
 */
function describeCodexPackage(packageRoot: string): { launcherPath: string; native: NativeCodex } | null {
  const target = CODEX_TARGETS[`${process.platform === 'android' ? 'linux' : process.platform}-${process.arch}`];
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const launcherPath = path.join(packageRoot, 'bin', 'codex.js');
  if (!target || !isFile(launcherPath)) {
    return null;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: unknown };
    if (manifest.name !== CODEX_PACKAGE_NAME) {
      return null;
    }
  } catch {
    return null;
  }

  let vendorRoot = path.join(packageRoot, 'vendor');
  try {
    const platformPackageJson = createRequire(packageJsonPath).resolve(`${target.platformPackage}/package.json`);
    vendorRoot = path.join(path.dirname(platformPackageJson), 'vendor');
  } catch {
    // Older releases ship the binaries inside @openai/codex itself.
  }
  const native = findNativeInTargetDir(path.join(vendorRoot, target.triple));
  return native ? { launcherPath, native } : null;
}

function describeBundledCodexCli(): CodexCli | null {
  let packageRoot: string;
  try {
    packageRoot = path.dirname(createRequire(import.meta.url).resolve(`${CODEX_PACKAGE_NAME}/package.json`));
  } catch {
    return null;
  }
  const codexPackage = describeCodexPackage(packageRoot);
  if (!codexPackage) {
    return null;
  }
  return {
    source: 'bundled',
    command: process.execPath,
    commandArgs: [codexPackage.launcherPath],
    displayCommand: codexPackage.launcherPath,
    ...codexPackage.native,
    probe: probeCliVersion(codexPackage.native.executablePath),
  };
}

/**
 * The first `codex` on PATH, as a shell would pick it, skipping any
 * `node_modules/.bin`. `npm run` and `npx` put those first, and CloudCLI's own
 * holds the bundled CLI: a server started with `npm run dev` would otherwise
 * take its own dependency for the user's install.
 */
function findCodexOnPath(env: NodeJS.ProcessEnv): string | null {
  const pathValue = process.platform === 'win32'
    ? Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1]
    : env.PATH;
  // An npm global install on Windows is a `codex.cmd` shim; standalone and bun installs are a `.exe`.
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];

  for (const directory of (pathValue ?? '').split(path.delimiter)) {
    if (!directory || (path.basename(directory) === '.bin' && path.basename(path.dirname(directory)) === 'node_modules')) {
      continue;
    }
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Describes the install a PATH entry belongs to. An npm install's entry leads
 * to its package: a symlink to `bin/codex.js` on POSIX, a `.cmd` shim next to
 * `node_modules` on Windows. Anything else (the standalone installer's
 * symlink, Homebrew, a bun or pnpm shim) is run as it is; when it resolves
 * into a release folder, that folder's helpers go on PATH as well.
 */
function describeUserCodexCli(pathEntry: string): CodexCli | null {
  let realPath: string;
  try {
    realPath = fs.realpathSync(pathEntry);
  } catch {
    return null;
  }

  let packageRoot: string | null = null;
  if (path.extname(realPath).toLowerCase() === '.js') {
    packageRoot = path.dirname(path.dirname(realPath));
  } else if (path.extname(pathEntry).toLowerCase() === '.cmd') {
    packageRoot = path.join(path.dirname(pathEntry), 'node_modules', '@openai', 'codex');
  }

  if (packageRoot) {
    const codexPackage = describeCodexPackage(packageRoot);
    if (!codexPackage) {
      return null;
    }
    return {
      source: 'user',
      command: process.execPath,
      commandArgs: [codexPackage.launcherPath],
      displayCommand: pathEntry,
      ...codexPackage.native,
      probe: probeCliVersion(codexPackage.native.executablePath),
    };
  }

  const releaseHelpers = path.join(path.dirname(path.dirname(realPath)), 'codex-path');
  return {
    source: 'user',
    command: pathEntry,
    commandArgs: [],
    displayCommand: pathEntry,
    executablePath: pathEntry,
    pathDirs: path.basename(path.dirname(realPath)) === 'bin' && isDirectory(releaseHelpers) ? [releaseHelpers] : [],
    probe: probeCliVersion(pathEntry),
  };
}

/**
 * Used by the provider CLI service to pick Codex's updater: the user's own
 * install updates itself with `codex update`, whichever install is running.
 * null when there is no Codex on the server's PATH, or it cannot be started.
 */
export function findUserCodexCli(env: NodeJS.ProcessEnv = process.env): CodexCli | null {
  const pathEntry = findCodexOnPath(env);
  return pathEntry ? describeUserCodexCli(pathEntry) : null;
}

/**
 * Used by Codex auth, the SDK runtime, the app-server client and Shell
 * launches, so they all run the same install: the user's own when it is at
 * least as new as the bundled one, else the bundled one. A user install whose
 * version cannot be read only wins when nothing is bundled. null when neither
 * exists.
 */
export function resolveCodexCli(env: NodeJS.ProcessEnv = process.env): CodexCli | null {
  const user = findUserCodexCli(env);
  const bundled = describeBundledCodexCli();
  const userVersion = user?.probe.version;
  if (user && userVersion && !(bundled?.probe.version && isNewerVersion(bundled.probe.version, userVersion))) {
    return user;
  }
  return bundled ?? user;
}

/**
 * Used by the SDK runtime and the app-server client: the server's environment
 * with the install's helper directories first on PATH, which the SDK does
 * itself only for the bundled package. Windows has one PATH under any casing,
 * so duplicate keys are dropped rather than handed to the child.
 */
export function createCodexProcessEnv(cli: CodexCli, baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  if (cli.pathDirs.length === 0) {
    return env;
  }

  let pathKey = 'PATH';
  if (process.platform === 'win32') {
    const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path');
    pathKey = pathKeys.includes('Path') ? 'Path' : pathKeys.at(-1) ?? 'Path';
    for (const key of pathKeys) {
      if (key !== pathKey) {
        delete env[key];
      }
    }
  }
  const rest = (env[pathKey] ?? '').split(path.delimiter).filter((entry) => entry && !cli.pathDirs.includes(entry));
  env[pathKey] = [...cli.pathDirs, ...rest].join(path.delimiter);
  return env;
}

/**
 * Used by the websocket module's Shell tab, through the providers barrel, to
 * start the Codex that chats run rather than whichever `codex` the shell's
 * PATH finds first. Program and arguments, unquoted; null when no Codex is
 * installed.
 */
export function resolveCodexCommandLine(): string[] | null {
  const cli = resolveCodexCli();
  return cli ? [cli.command, ...cli.commandArgs] : null;
}
