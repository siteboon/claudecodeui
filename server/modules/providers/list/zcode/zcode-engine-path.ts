/**
 * ZCode Engine Path Resolution
 *
 * ZCode's resolution data (env override, `zcode` binary, platform install
 * locations) on the shared CLI engine path factory. The resolution order,
 * caching, and version probing live in `cli-engine-path.ts`.
 *
 * Resolution never throws: "not installed" is a legal state that callers such
 * as the auth provider must degrade to gracefully (integration plan §3.2.4).
 * Only the protocol client turns a missing engine into a request-time error.
 *
 * @module zcode-engine-path
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createCliEnginePathResolver } from '../../shared/engine-path/cli-engine-path.js';

/**
 * Expected ZCode version for protocol compatibility checks.
 * Current validated version: 0.16.3 (ZCode Desktop App 3.7.7 embedded CLI).
 */
const EXPECTED_ZCODE_VERSION = '0.16.3';

/**
 * Default install locations by platform. The engine is a `.cjs` bundle always
 * executed through `node`, so candidates point at `zcode.cjs`.
 */
const PLATFORM_CANDIDATES: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: [
    '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
    path.join(os.homedir(), 'Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'),
  ],
  win32: [
    path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs'),
    path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ZCode', 'resources', 'glm', 'zcode.cjs'),
  ],
  linux: [
    path.join(os.homedir(), '.local', 'share', 'ZCode', 'resources', 'glm', 'zcode.cjs'),
    path.join(os.homedir(), '.zcode', 'cli', 'zcode.cjs'),
    '/usr/local/lib/zcode/cli/zcode.cjs',
    '/opt/zcode/cli/zcode.cjs',
  ],
};

const resolver = createCliEnginePathResolver({
  logTag: '[ZCode]',
  envVars: ['CLOUDCLI_ZCODE_ENGINE'],
  whichBinary: 'zcode',
  platformCandidates: PLATFORM_CANDIDATES,
  isValidPath: (filePath) => {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  },
  versionProbe: {
    invocations: [
      (enginePath) => ({ command: 'node', args: [enginePath, '--version'] }),
      (enginePath) => ({ command: 'node', args: [enginePath, 'version'] }),
    ],
    timeoutMs: 5000,
    parse: (output) => output.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null,
  },
  // The protocol client resolves the engine on the request path; the version
  // probe must never block the first spawn (previously up to 2×5s synchronous).
  eagerVersionProbe: true,
  expectedVersion: EXPECTED_ZCODE_VERSION,
});

/**
 * Resolves the ZCode engine entry path.
 *
 * Resolution order: CLOUDCLI_ZCODE_ENGINE override (dev/test) →
 * `which zcode` (future standalone CLI) → platform install locations.
 * Results (including "not found") are cached for the process lifetime; the
 * cache is only cleared by `clearEnginePathCache`.
 *
 * Consumers: zcode auth provider (install detection + login command),
 * zcode protocol client (subprocess spawn), and
 * `server/modules/providers/tests/zcode-engine-path.test.ts`.
 *
 * @returns Absolute path to `zcode.cjs`, or `null` when ZCode is not installed.
 */
export const tryResolveEnginePath = resolver.tryResolveEnginePath;

/**
 * Gets the detected ZCode CLI version. The probe runs asynchronously right
 * after the first successful resolve, so the first calls may return null;
 * later calls return the cached semver. Never throws.
 *
 * Consumers: zcode auth provider (status `method` annotation) and zcode
 * protocol client (startup diagnostics).
 */
export const getEngineVersion = resolver.getEngineVersion;

/**
 * Clears the cached engine path and version.
 *
 * Consumers: `server/modules/providers/tests/zcode-engine-path.test.ts`
 * (isolation between resolution-order cases). Production code relies on the
 * cache being stable for the process lifetime.
 */
export const clearEnginePathCache = resolver.clearEnginePathCache;
