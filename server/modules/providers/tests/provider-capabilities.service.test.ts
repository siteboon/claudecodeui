import { test } from 'node:test';
import assert from 'node:assert/strict';

import { providerCapabilitiesService } from '../services/provider-capabilities.service.js';

test('T25: pi capabilities expose only plan/bypassPermissions with bypassPermissions default', () => {
  const caps = providerCapabilitiesService.getProviderCapabilities('pi');

  assert.equal(caps.provider, 'pi');
  assert.deepEqual(caps.permissionModes, ['plan', 'bypassPermissions']);
  assert.equal(caps.defaultPermissionMode, 'bypassPermissions');
  assert.equal(caps.supportsPermissionRequests, false);
});

test('pi capability facets match runtime support', () => {
  const caps = providerCapabilitiesService.getProviderCapabilities('pi');

  assert.equal(caps.supportsAbort, true);
  assert.equal(caps.supportsTokenUsage, true);
  assert.equal(caps.supportsEffort, true);
  assert.equal(caps.supportsImages, true);
  assert.equal(caps.supportsFiles, true);
});
