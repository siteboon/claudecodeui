import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stripWrappingQuotes } from '@/shared/utils.js';

//----------------- CURSOR CLI LOCATION ------------

/**
 * The Cursor CLI's command name, as the official installer puts it on PATH.
 *
 * Consumers: the websocket module's Shell service. It launches this bare name when the CLI is on
 * PATH (or missing), and spots a launch command that starts with it (the Settings Login button
 * sends `cursor-agent login`) to point that command at the resolved CLI.
 */
export const CURSOR_CLI_COMMAND = 'cursor-agent';
const CURSOR_CLI_PATH_ENV = 'CURSOR_CLI_PATH';
const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * The Cursor CLI command to run and how it was found.
 *
 * `command` is always spawnable as-is with cross-spawn:
 * - `env`: the CURSOR_CLI_PATH value (wrapping quotes removed), trusted without a check. A value
 *   with a directory part is made absolute against the server's working directory; a bare name
 *   (e.g. `agent`) stays a PATH lookup.
 * - `path`: the bare `cursor-agent`, because the server's PATH has it (the historical behaviour).
 * - `install-dir`: an absolute path in a directory the official installer writes to.
 * - `missing`: the bare `cursor-agent`; spawning it fails with ENOENT.
 *
 * `searchedPath` (the PATH folders, each once) and `searchedLocations` record what was looked at,
 * so a "not found" message can name them (see `describeMissingCursorCli`).
 */
type CursorCliResolution = {
  command: string;
  source: 'env' | 'path' | 'install-dir' | 'missing';
  searchedPath: string;
  searchedLocations: string[];
};

type ResolveCursorCliDependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  cwd?: () => string;
  isExecutableFile?: (filePath: string) => boolean;
  readDirectoryNames?: (directoryPath: string) => string[];
};

// Windows environment names are case-insensitive (`Path`, `PathExt`), POSIX ones are not.
function readEnvironmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== 'win32') {
    return env[name];
  }
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function isExecutableFileOnDisk(filePath: string): boolean {
  try {
    if (!fs.statSync(filePath).isFile()) {
      return false;
    }
    // Windows has no execute bit; PATHEXT decides what runs there.
    if (process.platform !== 'win32') {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function readDirectoryNamesOnDisk(directoryPath: string): string[] {
  try {
    return fs.readdirSync(directoryPath);
  } catch {
    return [];
  }
}

/**
 * The installer keeps every version under `versions/<YYYY.MM.DD-hash>/` (plus `.tmp-*` folders
 * while it downloads), so the newest real version sorts last.
 */
function findNewestVersionedCli(
  versionsDirectory: string,
  fileNames: string[],
  pathApi: path.PlatformPath,
  deps: Required<ResolveCursorCliDependencies>,
): string | null {
  const versions = deps
    .readDirectoryNames(versionsDirectory)
    .filter((name) => !name.startsWith('.'))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

  for (const version of versions) {
    for (const fileName of fileNames) {
      const candidate = pathApi.join(versionsDirectory, version, fileName);
      if (deps.isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Finds the Cursor CLI the server should run.
 *
 * Order: CURSOR_CLI_PATH, then `cursor-agent` on the server's PATH, then the official installer's
 * locations in the server user's home directory. Those are `~/.local/bin/cursor-agent` and
 * `~/.local/share/cursor-agent/versions/<newest>/cursor-agent` (on Windows
 * `%LOCALAPPDATA%\cursor-agent\cursor-agent.{exe,cmd}`). The installer only adds them to the
 * PATH of interactive shells, so a server started by systemd, launchd or the desktop app often
 * cannot see them on its PATH.
 *
 * Nothing is cached: an install made while the server runs is found on the next call.
 *
 * Consumers: the providers module's Cursor auth and runtime providers (to spawn the CLI and to
 * explain a missing one) and the websocket module's Shell service (to launch it in a PTY).
 */
export function resolveCursorCli(dependencies: ResolveCursorCliDependencies = {}): CursorCliResolution {
  const deps: Required<ResolveCursorCliDependencies> = {
    env: dependencies.env ?? process.env,
    platform: dependencies.platform ?? process.platform,
    homedir: dependencies.homedir ?? os.homedir,
    cwd: dependencies.cwd ?? process.cwd,
    isExecutableFile: dependencies.isExecutableFile ?? isExecutableFileOnDisk,
    readDirectoryNames: dependencies.readDirectoryNames ?? readDirectoryNamesOnDisk,
  };
  const isWindows = deps.platform === 'win32';
  const pathApi = isWindows ? path.win32 : path.posix;
  // Launchers (npx, the desktop app) often repeat folders; each one is searched and named once.
  const pathDirectories = [
    ...new Set((readEnvironmentValue(deps.env, 'PATH', deps.platform) ?? '').split(pathApi.delimiter).filter(Boolean)),
  ];
  const searchedPath = pathDirectories.join(pathApi.delimiter);

  const configured = stripWrappingQuotes(deps.env[CURSOR_CLI_PATH_ENV] ?? '').trim();
  if (configured) {
    // The chat runtime spawns in the project folder and the Shell runs in a PTY there, so a relative
    // path is resolved once, here, against the server's working directory: every consumer then runs
    // the same file the Settings check ran. A bare name (no directory part) is left to PATH.
    const hasDirectoryPart = pathApi.basename(configured) !== configured;
    const command = hasDirectoryPart ? pathApi.resolve(deps.cwd(), configured) : configured;
    return { command, source: 'env', searchedPath, searchedLocations: [] };
  }

  // On Windows the CLI is a `.cmd`/`.exe` next to a `.ps1`; PATHEXT says which ones run.
  const executableExtensions = isWindows
    ? (readEnvironmentValue(deps.env, 'PATHEXT', deps.platform) || DEFAULT_WINDOWS_PATHEXT)
        .split(';')
        .map((extension) => extension.trim())
        .filter(Boolean)
    : [''];
  const fileNames = executableExtensions.map((extension) => `${CURSOR_CLI_COMMAND}${extension}`);

  const onPath = pathDirectories.some((directory) =>
    fileNames.some((fileName) => deps.isExecutableFile(pathApi.join(directory, fileName))),
  );
  if (onPath) {
    // Keep the bare name so cross-spawn resolves it (and Windows .cmd shims) exactly as before.
    return { command: CURSOR_CLI_COMMAND, source: 'path', searchedPath, searchedLocations: [] };
  }

  const homeDirectory = deps.homedir();
  let installDirectory: string;
  let versionsDirectory: string;
  let installFileNames: string[];
  if (isWindows) {
    const localAppData =
      readEnvironmentValue(deps.env, 'LOCALAPPDATA', deps.platform) ||
      pathApi.join(homeDirectory, 'AppData', 'Local');
    installDirectory = pathApi.join(localAppData, CURSOR_CLI_COMMAND);
    versionsDirectory = pathApi.join(installDirectory, 'versions');
    installFileNames = [`${CURSOR_CLI_COMMAND}.exe`, `${CURSOR_CLI_COMMAND}.cmd`];
  } else {
    installDirectory = pathApi.join(homeDirectory, '.local', 'bin');
    versionsDirectory = pathApi.join(homeDirectory, '.local', 'share', CURSOR_CLI_COMMAND, 'versions');
    installFileNames = [CURSOR_CLI_COMMAND];
  }

  const searchedLocations = [
    ...installFileNames.map((fileName) => pathApi.join(installDirectory, fileName)),
    pathApi.join(versionsDirectory, '*', isWindows ? `${CURSOR_CLI_COMMAND}.{exe,cmd}` : CURSOR_CLI_COMMAND),
  ];

  for (const fileName of installFileNames) {
    const candidate = pathApi.join(installDirectory, fileName);
    if (deps.isExecutableFile(candidate)) {
      return { command: candidate, source: 'install-dir', searchedPath, searchedLocations };
    }
  }

  const versioned = findNewestVersionedCli(versionsDirectory, installFileNames, pathApi, deps);
  if (versioned) {
    return { command: versioned, source: 'install-dir', searchedPath, searchedLocations };
  }

  return { command: CURSOR_CLI_COMMAND, source: 'missing', searchedPath, searchedLocations };
}

/**
 * Explains why the Cursor CLI could not be run: what was searched (the server's PATH and the
 * installer's locations) or which CURSOR_CLI_PATH value failed, and how to fix it. A service's
 * PATH often differs from the login shell's, so this tells "not installed" apart from "installed
 * where the server does not look".
 *
 * Consumers: the providers module's Cursor auth provider (the Settings error) and Cursor runtime
 * (the chat error) when the OS cannot start the resolved command (ENOENT, EACCES, ENOTDIR, ...).
 */
export function describeMissingCursorCli(resolution: CursorCliResolution): string {
  if (resolution.source === 'env') {
    // `command` is the resolved value, so a relative setting shows the absolute file that was tried.
    return `Cursor CLI not found: ${CURSOR_CLI_PATH_ENV} points to "${resolution.command}", which cannot be run. `
      + `Set ${CURSOR_CLI_PATH_ENV} to the absolute path of the ${CURSOR_CLI_COMMAND} executable.`;
  }

  if (resolution.source !== 'missing') {
    // Found, yet the OS could not start it (e.g. a wrapper script whose interpreter is gone).
    return `Cursor CLI "${resolution.command}" was found but could not be started. `
      + `Reinstall it, or set ${CURSOR_CLI_PATH_ENV} to a working ${CURSOR_CLI_COMMAND} executable.`;
  }

  return `Cursor CLI not found. Looked for ${CURSOR_CLI_COMMAND} on the server's PATH `
    + `(${resolution.searchedPath || 'empty'}) and at ${resolution.searchedLocations.join(', ')}. `
    + `Install it from https://cursor.com/cli, or set ${CURSOR_CLI_PATH_ENV} to its absolute path `
    + 'and restart the server.';
}
