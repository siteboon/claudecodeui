/**
 * ZCode Engine Path Resolution
 *
 * Provides cross-platform resolution of the ZCode engine entry (`zcode.cjs`)
 * with support for development overrides and version detection.
 *
 * Resolution never throws: "not installed" is a legal state that callers such
 * as the auth provider must degrade to gracefully (integration plan §3.2.4).
 * Only the protocol client turns a missing engine into a request-time error.
 *
 * Resolution order (first match wins):
 * 1. Environment variable CLOUDCLI_ZCODE_ENGINE (dev/test override)
 * 2. `which zcode` (when official standalone CLI becomes available)
 * 3. Darwin: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
 * 4. Darwin: ~/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
 * 5. Windows: %LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs (Phase 0 confirmation pending)
 * 6. Linux: known installation paths
 *
 * @module zcode-engine-path
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';

/**
 * Expected ZCode version for protocol compatibility checks.
 * Current validated version: 0.16.3 (ZCode Desktop App 3.7.7 embedded CLI).
 */
const EXPECTED_ZCODE_VERSION = '0.16.3';

/**
 * Cache for resolved engine path to avoid repeated filesystem checks.
 * `null` means "not yet resolved"; `false` means "resolved as missing".
 */
let cachedEnginePath: string | false | null = null;

/**
 * Cache for detected version to avoid repeated subprocess calls.
 */
let cachedVersion: string | null = null;

/**
 * Checks that a path exists and points to a regular file. The engine is a
 * `.cjs` bundle always executed through `node`, so the executable bit is not
 * meaningful here.
 */
function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Attempts to resolve engine path from environment variable override.
 * Development/testing use only.
 */
function resolveFromEnvVar(): string | null {
  const envPath = process.env.CLOUDCLI_ZCODE_ENGINE?.trim();
  if (envPath && isFile(envPath)) {
    return envPath;
  }
  return null;
}

/**
 * Attempts to resolve engine path using 'which zcode'.
 * Future-proofing for when official standalone CLI is released.
 */
function resolveFromWhich(): string | null {
  try {
    const result = spawnSync('which', ['zcode'], { encoding: 'utf-8' });
    if (result.status === 0 && result.stdout?.trim()) {
      const whichPath = result.stdout.trim();
      if (isFile(whichPath)) {
        return whichPath;
      }
    }
  } catch {
    // which command not available or failed
  }
  return null;
}

/**
 * Attempts to resolve engine path from standard macOS application bundles.
 */
function resolveDarwinPath(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  const standardPaths = [
    '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
    path.join(os.homedir(), 'Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'),
  ];

  for (const appPath of standardPaths) {
    if (isFile(appPath)) {
      return appPath;
    }
  }

  return null;
}

/**
 * Attempts to resolve engine path from Windows installation.
 * Phase 0 verification pending - actual path may differ.
 */
function resolveWindowsPath(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }

  const windowsPaths = [
    path.join(localAppData, 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs'),
    path.join(localAppData, 'ZCode', 'resources', 'glm', 'zcode.cjs'),
  ];

  for (const winPath of windowsPaths) {
    if (isFile(winPath)) {
      return winPath;
    }
  }

  return null;
}

/**
 * Attempts to resolve engine path from Linux standard installations.
 */
function resolveLinuxPath(): string | null {
  if (process.platform !== 'linux') {
    return null;
  }

  const linuxPaths = [
    path.join(os.homedir(), '.local', 'share', 'ZCode', 'resources', 'glm', 'zcode.cjs'),
    path.join(os.homedir(), '.zcode', 'cli', 'zcode.cjs'),
    '/usr/local/lib/zcode/cli/zcode.cjs',
    '/opt/zcode/cli/zcode.cjs',
  ];

  for (const linuxPath of linuxPaths) {
    if (isFile(linuxPath)) {
      return linuxPath;
    }
  }

  return null;
}

/**
 * Detects ZCode CLI version by running the engine through node.
 *
 * The CLI exposes both a `version` subcommand and a `--version` flag across
 * its releases, so both are attempted. Returns null when neither yields a
 * parseable semver string.
 */
function detectVersion(enginePath: string): string | null {
  for (const args of [['--version'], ['version']]) {
    try {
      const result = spawnSync('node', [enginePath, ...args], {
        encoding: 'utf-8',
        timeout: 5000,
      });

      if (result.status === 0) {
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
        const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
        if (versionMatch) {
          return versionMatch[1];
        }
      }
    } catch {
      // Version detection failed - try next invocation form
    }
  }

  return null;
}

/**
 * Resolves the ZCode engine entry path using platform-specific logic.
 *
 * Consumers: zcode auth provider (install detection + login command),
 * zcode protocol client (subprocess spawn), and
 * `server/modules/providers/tests/zcode-engine-path.test.ts`.
 *
 * Results (including "not found") are cached for subsequent calls; the cache
 * is only cleared by `clearEnginePathCache`.
 *
 * @returns Absolute path to `zcode.cjs`, or `null` when ZCode is not installed.
 */
export function tryResolveEnginePath(): string | null {
  if (cachedEnginePath !== null) {
    return cachedEnginePath || null;
  }

  const resolvers = [
    resolveFromEnvVar,
    resolveFromWhich,
    resolveDarwinPath,
    resolveWindowsPath,
    resolveLinuxPath,
  ];

  for (const resolver of resolvers) {
    const resolvedPath = resolver();
    if (resolvedPath) {
      cachedEnginePath = resolvedPath;

      const detectedVersion = detectVersion(resolvedPath);
      if (detectedVersion) {
        cachedVersion = detectedVersion;

        if (detectedVersion !== EXPECTED_ZCODE_VERSION) {
          console.warn(
            `[ZCode] Version mismatch: expected ${EXPECTED_ZCODE_VERSION}, detected ${detectedVersion}. ` +
            `Protocol compatibility issues may occur.`
          );
        }
      }

      return resolvedPath;
    }
  }

  cachedEnginePath = false;
  return null;
}

/**
 * Gets the detected ZCode CLI version, resolving the engine path first when
 * necessary. Never throws; returns null when the engine or version is
 * unavailable.
 *
 * Consumers: zcode auth provider (status `method` annotation) and zcode
 * protocol client (startup diagnostics).
 */
export function getEngineVersion(): string | null {
  if (!cachedVersion) {
    if (!tryResolveEnginePath()) {
      return null;
    }
  }
  return cachedVersion;
}

/**
 * Clears the cached engine path and version.
 *
 * Consumers: `server/modules/providers/tests/zcode-engine-path.test.ts`
 * (isolation between resolution-order cases). Production code relies on the
 * cache being stable for the process lifetime.
 */
export function clearEnginePathCache(): void {
  cachedEnginePath = null;
  cachedVersion = null;
}
