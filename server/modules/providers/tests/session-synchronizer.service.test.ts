import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { scanStateDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';

const originalListProviders = providerRegistry.listProviders;
const originalGetLastScannedAt = scanStateDb.getLastScannedAt;
const originalUpdateLastScannedAt = scanStateDb.updateLastScannedAt;

afterEach(() => {
  providerRegistry.listProviders = originalListProviders;
  scanStateDb.getLastScannedAt = originalGetLastScannedAt;
  scanStateDb.updateLastScannedAt = originalUpdateLastScannedAt;
});

function stubNoProviders() {
  providerRegistry.listProviders = () => [];
  scanStateDb.getLastScannedAt = () => null;
}

test('reports a failing cursor update instead of throwing', async () => {
  stubNoProviders();
  scanStateDb.updateLastScannedAt = () => {
    throw new Error('attempt to write a readonly database');
  };

  // A read-only or moved database must not take down callers that only list
  // projects — GET /api/projects awaits this bare.
  const result = await sessionSynchronizerService.synchronizeSessions();

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /scan_state cursor update failed/);
  assert.match(result.failures[0], /readonly database/);
});

test('advances the cursor when every provider succeeds', async () => {
  stubNoProviders();
  const cursorWrites: Date[] = [];
  scanStateDb.updateLastScannedAt = (scannedAt: Date) => {
    cursorWrites.push(scannedAt);
  };

  const result = await sessionSynchronizerService.synchronizeSessions();

  assert.deepEqual(result.failures, []);
  assert.equal(cursorWrites.length, 1);
  assert.ok(cursorWrites[0] instanceof Date);
});

test('skips the cursor update when a provider fails', async () => {
  scanStateDb.getLastScannedAt = () => null;
  providerRegistry.listProviders = () => ([{
    id: 'claude',
    sessionSynchronizer: {
      synchronize: async () => {
        throw new Error('provider exploded');
      },
    },
  }] as unknown as ReturnType<typeof originalListProviders>);

  let cursorWritten = false;
  scanStateDb.updateLastScannedAt = () => {
    cursorWritten = true;
  };

  const result = await sessionSynchronizerService.synchronizeSessions();

  assert.equal(cursorWritten, false);
  assert.deepEqual(result.failures, ['provider exploded']);
});
