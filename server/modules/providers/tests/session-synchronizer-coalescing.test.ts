import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import type { IProvider } from '@/shared/interfaces.js';

// Each provider synchronizer resolves `os.homedir()` when the registry module is
// first imported, so HOME has to point at an empty fixture home *before* that
// import runs. The registry is stubbed per test, but the import still happens.
const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'session-sync-home-'));
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;

const { providerRegistry } = await import('@/modules/providers/provider.registry.js');
const { sessionSynchronizerService } = await import(
  '@/modules/providers/services/session-synchronizer.service.js'
);

process.on('exit', () => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = previousUserProfile;
  }
});

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-sync-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/**
 * Installs a single fake provider whose scan only settles when the returned
 * `release` is called, so a second caller can be observed arriving mid-scan.
 */
function stubSlowProvider() {
  const originalListProviders = providerRegistry.listProviders;
  let synchronizeCalls = 0;
  let releaseScan: () => void = () => {};
  const scanStarted = new Promise<void>((resolveStarted) => {
    const fakeProvider = {
      id: 'claude',
      sessionSynchronizer: {
        async synchronize() {
          synchronizeCalls += 1;
          resolveStarted();
          await new Promise<void>((resolveScan) => {
            releaseScan = resolveScan;
          });
          return 7;
        },
      },
    } as unknown as IProvider;

    providerRegistry.listProviders = () => [fakeProvider];
  });

  return {
    scanStarted,
    release: () => releaseScan(),
    getSynchronizeCalls: () => synchronizeCalls,
    restore: () => {
      providerRegistry.listProviders = originalListProviders;
    },
  };
}

test('concurrent synchronizeSessions callers share one provider scan', async () => {
  await withIsolatedDatabase(async () => {
    const providerStub = stubSlowProvider();

    try {
      const first = sessionSynchronizerService.synchronizeSessions();
      await providerStub.scanStarted;
      // Opening the UI fires /api/projects and /api/projects/archived at once;
      // the second must join the running scan instead of starting its own.
      const second = sessionSynchronizerService.synchronizeSessions();

      providerStub.release();
      const [firstResult, secondResult] = await Promise.all([first, second]);

      assert.equal(providerStub.getSynchronizeCalls(), 1);
      assert.equal(firstResult.processedByProvider.claude, 7);
      assert.deepEqual(secondResult, firstResult);
    } finally {
      providerStub.restore();
    }
  });
});

test('a synchronizeSessions call after the shared scan settles starts a new scan', async () => {
  await withIsolatedDatabase(async () => {
    const providerStub = stubSlowProvider();

    try {
      const first = sessionSynchronizerService.synchronizeSessions();
      await providerStub.scanStarted;
      providerStub.release();
      await first;

      const second = sessionSynchronizerService.synchronizeSessions();
      providerStub.release();
      await second;

      assert.equal(providerStub.getSynchronizeCalls(), 2);
    } finally {
      providerStub.restore();
    }
  });
});
