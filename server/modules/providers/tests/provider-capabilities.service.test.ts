import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';

test('omp permission defaults recover from missing config and refresh edited config after TTL', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-capabilities-cache-'));
  const config = path.join(home, '.omp', 'agent', 'config.yml');
  let now = Date.now();
  t.mock.method(os, 'homedir', () => home);
  t.mock.method(Date, 'now', () => now);
  const reads = t.mock.method(fs, 'readFileSync');
  try {
    assert.equal(providerCapabilitiesService.getProviderCapabilities('omp').defaultPermissionMode, 'default');
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, 'approvalMode: yolo\n');
    now += 29_999;
    assert.equal(providerCapabilitiesService.getProviderCapabilities('omp').defaultPermissionMode, 'default');
    assert.equal(reads.mock.callCount(), 1);
    now += 1;
    assert.equal(providerCapabilitiesService.listAllProviderCapabilities().find((entry) => entry.provider === 'omp')?.defaultPermissionMode, 'bypassPermissions');
    assert.equal(reads.mock.callCount(), 2);

    fs.writeFileSync(config, 'approvalMode: prompt\n');
    now += 29_999;
    assert.equal(providerCapabilitiesService.getProviderCapabilities('omp').defaultPermissionMode, 'bypassPermissions');
    now += 1;
    assert.equal(providerCapabilitiesService.getProviderCapabilities('omp').defaultPermissionMode, 'default');
    assert.equal(reads.mock.callCount(), 3);
    assert.equal(providerCapabilitiesService.getProviderCapabilities('claude').defaultPermissionMode, 'default');
    assert.equal(reads.mock.callCount(), 3);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
