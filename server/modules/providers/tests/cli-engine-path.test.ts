import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import type { SpawnSyncReturns } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createCliEnginePathResolver,
} from '@/modules/providers/shared/engine-path/cli-engine-path.js';
import {
  DEFAULT_NEGATIVE_PROBE_TTL_MS,
} from '@/modules/providers/shared/installation/cli-installation-probe.js';

type SpawnCall = { command: string; args: string[] };

/**
 * Builds a resolver with an injected spawnSync whose responses are keyed by
 * the invoked command. Unlisted commands fail with status 1.
 */
function createTestResolver(options: {
  responses: Record<string, { stdout?: string; status?: number }>;
  platform?: NodeJS.Platform;
  isValidPath?: (filePath: string) => boolean;
  versionProbeInvocations?: number;
  eagerVersionProbe?: boolean;
  expectedVersion?: string;
  now?: () => number;
}) {
  const calls: SpawnCall[] = [];
  const spawnSync = ((
    command: string,
    args: readonly string[],
  ): SpawnSyncReturns<string> => {
    calls.push({ command, args: [...args] });
    const response = options.responses[command];
    return {
      pid: 1,
      output: [],
      stdout: response?.stdout ?? '',
      stderr: '',
      status: response?.status ?? 1,
      signal: null,
    } as SpawnSyncReturns<string>;
  }) as unknown as typeof import('node:child_process').spawnSync;

  const originalPlatform = process.platform;
  if (options.platform) {
    Object.defineProperty(process, 'platform', { value: options.platform });
  }

  const resolver = createCliEnginePathResolver({
    logTag: '[Test]',
    envVars: ['TEST_ENGINE_PATH'],
    whichBinary: 'test-cli',
    platformCandidates: {
      darwin: ['/opt/test-cli/bin/test-cli'],
      linux: ['/usr/bin/test-cli'],
      win32: ['C:\\test\\test-cli.exe'],
    },
    isValidPath: options.isValidPath ?? ((filePath) => filePath.startsWith('/')),
    versionProbe: options.versionProbeInvocations
      ? {
          invocations: Array.from(
            { length: options.versionProbeInvocations },
            (_, index) => (enginePath: string) => ({
              command: `probe-${index}`,
              args: [enginePath],
            }),
          ),
          timeoutMs: 1000,
          parse: (output) => output.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null,
        }
      : undefined,
    eagerVersionProbe: options.eagerVersionProbe,
    expectedVersion: options.expectedVersion,
  }, { spawnSync, now: options.now });

  return {
    resolver,
    calls,
    restore: () => {
      if (options.platform) {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    },
  };
}

const withEnv = async (value: string | undefined, runTest: () => Promise<void>): Promise<void> => {
  const previous = process.env.TEST_ENGINE_PATH;
  if (value === undefined) {
    delete process.env.TEST_ENGINE_PATH;
  } else {
    process.env.TEST_ENGINE_PATH = value;
  }
  try {
    await runTest();
  } finally {
    if (previous === undefined) {
      delete process.env.TEST_ENGINE_PATH;
    } else {
      process.env.TEST_ENGINE_PATH = previous;
    }
  }
};

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test('resolution prefers env override, then PATH, then platform candidates', async () => {
  await withEnv(undefined, async () => {
    const { resolver, calls, restore } = createTestResolver({
      responses: { which: { stdout: '/usr/local/bin/test-cli\n', status: 0 } },
      platform: 'darwin',
    });

    try {
      assert.equal(resolver.tryResolveEnginePath(), '/usr/local/bin/test-cli');
      assert.deepEqual(calls, [{ command: 'which', args: ['test-cli'] }]);

      // Cached: no further subprocess calls on subsequent resolutions.
      resolver.tryResolveEnginePath();
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });
});

test('which failure falls through to the platform candidate table', async () => {
  await withEnv(undefined, async () => {
    const { resolver, restore } = createTestResolver({
      responses: {},
      platform: 'linux',
    });

    try {
      assert.equal(resolver.tryResolveEnginePath(), '/usr/bin/test-cli');
    } finally {
      restore();
    }
  });
});

test('a failed resolution is negatively cached until the cache is cleared', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cli-engine-path-negative-'));
  const lateEnginePath = path.join(tempDir, 'late-engine');

  try {
    await withEnv(lateEnginePath, async () => {
      const { resolver, restore } = createTestResolver({
        responses: {},
        platform: 'linux',
        isValidPath: (filePath) => {
          try {
            return fs.statSync(filePath).isFile();
          } catch {
            return false;
          }
        },
        now: () => 0,
      });

      try {
        // The engine file does not exist yet: resolution fails and is negatively cached.
        assert.equal(resolver.tryResolveEnginePath(), null);

        // The engine "appears": within the TTL the negative cache still holds.
        await writeFile(lateEnginePath, 'engine', 'utf8');
        assert.equal(resolver.tryResolveEnginePath(), null);

        // Clearing bypasses the TTL entirely.
        resolver.clearEnginePathCache();
        assert.equal(resolver.tryResolveEnginePath(), lateEnginePath);
      } finally {
        restore();
      }
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('a negative cache expires after the TTL and the resolution reruns', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cli-engine-path-negative-ttl-'));
  const lateEnginePath = path.join(tempDir, 'late-engine');
  let clock = 0;

  try {
    await withEnv(lateEnginePath, async () => {
      const { resolver, calls, restore } = createTestResolver({
        responses: {},
        platform: 'linux',
        isValidPath: (filePath) => {
          try {
            return fs.statSync(filePath).isFile();
          } catch {
            return false;
          }
        },
        now: () => clock,
      });

      try {
        assert.equal(resolver.tryResolveEnginePath(), null);
        assert.equal(resolver.tryResolveEnginePath(), null);
        assert.equal(calls.length, 1);

        // The engine "appears" and the TTL elapses: the next query resolves it.
        // The rerun hits the env override directly, so `which` is not called
        // again — the null → path transition is the rerun proof.
        await writeFile(lateEnginePath, 'engine', 'utf8');
        clock += DEFAULT_NEGATIVE_PROBE_TTL_MS;
        assert.equal(resolver.tryResolveEnginePath(), lateEnginePath);
      } finally {
        restore();
      }
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('an eager version probe runs asynchronously with the resolved path and caches the parse result', async () => {
  await withEnv('/opt/engines/test-cli', async () => {
    const { resolver, calls, restore } = createTestResolver({
      responses: {
        'probe-0': { stdout: 'before 1.2.3 after', status: 0 },
      },
      platform: 'linux',
      versionProbeInvocations: 2,
      eagerVersionProbe: true,
    });

    try {
      assert.equal(resolver.tryResolveEnginePath(), '/opt/engines/test-cli');

      // The probe has not run yet: resolving never blocks on version detection.
      assert.deepEqual(calls, []);
      assert.equal(resolver.getEngineVersion(), null);

      await flushMicrotasks();

      assert.deepEqual(calls, [{ command: 'probe-0', args: ['/opt/engines/test-cli'] }]);
      assert.equal(resolver.getEngineVersion(), '1.2.3');

      // Cached: repeated reads do not re-probe.
      await flushMicrotasks();
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });
});

test('a lazy version probe runs synchronously inside getEngineVersion on demand', async () => {
  await withEnv('/opt/engines/test-cli', async () => {
    const { resolver, calls, restore } = createTestResolver({
      responses: {
        'probe-0': { stdout: 'before 1.2.3 after', status: 0 },
      },
      platform: 'linux',
      versionProbeInvocations: 2,
    });

    try {
      assert.equal(resolver.tryResolveEnginePath(), '/opt/engines/test-cli');

      // Resolving alone does not probe (no subprocess noise on request paths).
      assert.deepEqual(calls, []);

      // The first explicit read probes synchronously and caches.
      assert.equal(resolver.getEngineVersion(), '1.2.3');
      assert.equal(calls.length, 1);
      assert.equal(resolver.getEngineVersion(), '1.2.3');
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });
});

test('version probe falls back to the second invocation and warns on version mismatch', async () => {
  await withEnv('/opt/engines/test-cli', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => warnings.push(String(message));

    const { resolver, calls, restore } = createTestResolver({
      responses: {
        'probe-0': { stdout: 'no version here', status: 0 },
        'probe-1': { stdout: 'version: 9.9.9', status: 0 },
      },
      platform: 'linux',
      versionProbeInvocations: 2,
      expectedVersion: '1.0.0',
    });

    try {
      resolver.tryResolveEnginePath();
      assert.equal(resolver.getEngineVersion(), '9.9.9');

      assert.deepEqual(calls, [
        { command: 'probe-0', args: ['/opt/engines/test-cli'] },
        { command: 'probe-1', args: ['/opt/engines/test-cli'] },
      ]);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /Version mismatch: expected 1\.0\.0, detected 9\.9\.9/);
    } finally {
      console.warn = originalWarn;
      restore();
    }
  });
});

test('a probe with no parseable output leaves the version null without throwing', async () => {
  await withEnv('/opt/engines/test-cli', async () => {
    const { resolver, restore } = createTestResolver({
      responses: {
        'probe-0': { stdout: '', status: 1 },
        'probe-1': { stdout: 'garbage', status: 0 },
      },
      platform: 'linux',
      versionProbeInvocations: 2,
    });

    try {
      resolver.tryResolveEnginePath();
      assert.equal(resolver.getEngineVersion(), null);
    } finally {
      restore();
    }
  });
});

test('the which step uses where on Windows and validates the first result line', async () => {
  await withEnv(undefined, async () => {
    const { resolver, calls, restore } = createTestResolver({
      responses: { where: { stdout: 'C:\\tools\\test-cli.exe\r\nC:\\other\\test-cli.exe', status: 0 } },
      platform: 'win32',
      isValidPath: (filePath) => filePath === 'C:\\tools\\test-cli.exe',
    });

    try {
      assert.equal(resolver.tryResolveEnginePath(), path.resolve('C:\\tools\\test-cli.exe'));
      assert.deepEqual(calls, [{ command: 'where', args: ['test-cli'] }]);
    } finally {
      restore();
    }
  });
});

test('the factory works unchanged with real subprocesses on this machine', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cli-engine-path-'));
  const enginePath = path.join(tempDir, 'test-cli.cjs');
  await writeFile(enginePath, 'console.log("1.0.0")', 'utf8');

  try {
    await withEnv(enginePath, async () => {
      const resolver = createCliEnginePathResolver({
        logTag: '[TestReal]',
        envVars: ['TEST_ENGINE_PATH'],
        whichBinary: 'test-cli',
        platformCandidates: {},
        isValidPath: (filePath) => {
          try {
            return fs.statSync(filePath).isFile();
          } catch {
            return false;
          }
        },
        versionProbe: {
          invocations: [
            (resolvedPath) => ({ command: process.execPath, args: [resolvedPath] }),
          ],
          timeoutMs: 5000,
          parse: (output) => output.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null,
        },
      });

      assert.equal(resolver.tryResolveEnginePath(), enginePath);
      await flushMicrotasks();
      assert.equal(resolver.getEngineVersion(), '1.0.0');
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
