/**
 * Antigravity CLI Engine Path Resolver
 *
 * Resolves the path to the Antigravity CLI (`agy`) binary across platforms,
 * supporting environment variable overrides, PATH discovery, and common installation locations.
 *
 * @module antigravity-engine-path
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Known default install locations by platform.
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

let cachedEnginePath: string | null = null;
let cachedEngineVersion: string | null = null;

/**
 * Resolves the absolute path to the `agy` executable.
 *
 * Resolution order:
 * 1. CLOUDCLI_ANTIGRAVITY_PATH / CLOUDCLI_AGY_PATH environment variable
 * 2. System PATH via which/where
 * 3. Platform common installation directories
 *
 * Returns null when no valid binary is found.
 */
export function tryResolveEnginePath(): string | null {
  if (cachedEnginePath && fs.existsSync(cachedEnginePath)) {
    return cachedEnginePath;
  }

  // 1. Check explicit environment override
  const envOverride = process.env.CLOUDCLI_ANTIGRAVITY_PATH || process.env.CLOUDCLI_AGY_PATH;
  if (envOverride && fs.existsSync(envOverride)) {
    cachedEnginePath = path.resolve(envOverride);
    return cachedEnginePath;
  }

  // 2. Try which / where lookup
  try {
    const isWindows = process.platform === 'win32';
    const whichCmd = isWindows ? 'where' : 'which';
    const stdout = execFileSync(whichCmd, ['agy'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    const firstLine = stdout.split(/\r?\n/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) {
      cachedEnginePath = path.resolve(firstLine);
      return cachedEnginePath;
    }
  } catch {
    // PATH lookup failed, proceed to common paths
  }

  // 3. Check common platform paths
  const platformCandidates = COMMON_PATHS[process.platform] ?? [];
  for (const candidate of platformCandidates) {
    if (fs.existsSync(candidate)) {
      cachedEnginePath = path.resolve(candidate);
      return cachedEnginePath;
    }
  }

  return null;
}

/**
 * Probes the installed Antigravity CLI version by running `agy --version`.
 * Returns null if the CLI cannot be executed.
 */
export function getEngineVersion(): string | null {
  if (cachedEngineVersion) {
    return cachedEngineVersion;
  }

  const enginePath = tryResolveEnginePath();
  if (!enginePath) {
    return null;
  }

  try {
    const stdout = execFileSync(enginePath, ['--version'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();

    if (stdout) {
      cachedEngineVersion = stdout;
      return cachedEngineVersion;
    }
  } catch {
    // Version check failed
  }

  return null;
}
