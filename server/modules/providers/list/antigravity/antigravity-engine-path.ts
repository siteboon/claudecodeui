/**
 * Antigravity CLI Engine Path Resolver
 *
 * Antigravity's resolution data (env names, `agy` binary, platform install
 * locations) on the shared CLI engine path factory. The resolution order,
 * caching, and version probing live in `cli-engine-path.ts`.
 *
 * @module antigravity-engine-path
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCliEnginePathResolver } from '../../shared/engine-path/cli-engine-path.js';

/**
 * Known default install locations by platform. `agy` is a native executable.
 */
const COMMON_PATHS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: [
    path.join(os.homedir(), '.local', 'bin', 'agy'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/opt/homebrew/bin/agy',
  ],
  linux: [
    path.join(os.homedir(), '.local', 'bin', 'agy'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/usr/bin/agy',
  ],
  win32: [
    path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Antigravity', 'agy.exe'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'agy.exe'),
  ],
};

const resolver = createCliEnginePathResolver({
  logTag: '[Antigravity]',
  envVars: ['CLOUDCLI_ANTIGRAVITY_PATH', 'CLOUDCLI_AGY_PATH'],
  whichBinary: 'agy',
  platformCandidates: COMMON_PATHS,
  isValidPath: (filePath) => fs.existsSync(filePath),
  versionProbe: {
    invocations: [
      (enginePath) => ({ command: enginePath, args: ['--version'] }),
    ],
    timeoutMs: 5000,
    parse: (output) => {
      const trimmed = output.trim();
      return trimmed || null;
    },
  },
});

/**
 * Resolves the absolute path to the `agy` executable.
 *
 * Resolution order: CLOUDCLI_ANTIGRAVITY_PATH / CLOUDCLI_AGY_PATH override →
 * system PATH → platform common directories. Returns null when no valid
 * binary is found; the result (including "not found") is cached for the
 * process lifetime.
 *
 * Consumers: antigravity auth, runtime, models, and quota providers.
 */
export const tryResolveEnginePath = resolver.tryResolveEnginePath;

/**
 * Probes the installed Antigravity CLI version by running `agy --version`.
 * The probe warms asynchronously after the first successful resolve, so the
 * first call may return null; later calls return the cached version.
 *
 * Consumers: antigravity auth provider (status `method` annotation).
 */
export const getEngineVersion = resolver.getEngineVersion;
