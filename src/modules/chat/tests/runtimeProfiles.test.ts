import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

const { runtimeProfilesRequest } = vi.hoisted(() => ({ runtimeProfilesRequest: vi.fn() }));

const profiles = [
  {
    id: 'default',
    name: 'Default environment',
    provider: 'codex',
    isDefault: true,
  },
  {
    id: 'work',
    name: 'Work account',
    provider: 'codex',
    description: 'Company login',
    isDefault: false,
  },
  {
    id: 'default',
    name: 'Default environment',
    provider: 'claude',
    isDefault: true,
  },
];

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      runtimeProfiles: runtimeProfilesRequest,
    },
  },
}));

const renderProfiles = async (provider: 'codex' | 'claude') => {
  const { useRuntimeProfiles } = await import('@/modules/chat/hooks/useRuntimeProfiles');
  return renderHook(({ activeProvider }) => useRuntimeProfiles(activeProvider), {
    initialProps: { activeProvider: provider },
  });
};

beforeEach(() => {
  localStorage.clear();
  runtimeProfilesRequest.mockReset();
  runtimeProfilesRequest.mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: { profiles } }),
  });
});

afterEach(() => {
  vi.resetModules();
});

test('shows only the active provider profiles and remembers its selection', async () => {
  const { result } = await renderProfiles('codex');

  await waitFor(() => assert.equal(result.current.providerProfiles.length, 2));
  assert.deepEqual(result.current.providerProfiles.map((profile) => profile.id), ['default', 'work']);

  act(() => result.current.selectRuntimeProfile('work'));

  assert.equal(result.current.selectedRuntimeProfileId, 'work');
  assert.equal(localStorage.getItem('runtime-profile:codex'), 'work');
  assert.equal(localStorage.getItem('runtime-profile:claude'), null);
});

test('falls back when a previously stored profile is no longer configured', async () => {
  localStorage.setItem('runtime-profile:codex', 'removed-profile');
  const { result } = await renderProfiles('codex');

  await waitFor(() => assert.equal(result.current.selectedRuntimeProfileId, 'default'));
  assert.equal(localStorage.getItem('runtime-profile:codex'), 'default');
});

for (const failure of ['network', 'http', 'invalid-body']) {
  test(`runtime profile ${failure} failures expose a retry that preserves the selected profile`, async () => {
    localStorage.setItem('runtime-profile:codex', 'work');
    if (failure === 'network') runtimeProfilesRequest.mockRejectedValueOnce(new Error('offline'));
    else runtimeProfilesRequest.mockResolvedValueOnce({
      ok: failure !== 'http', json: async () => failure === 'http'
        ? { success: false } : { success: true, data: {} },
    });
    const { result } = await renderProfiles('codex');
    await waitFor(() => assert.equal(result.current.loading, false));
    assert.ok(result.current.error);
    assert.equal(result.current.selectedRuntimeProfileId, 'work');
    act(() => result.current.retry());
    await waitFor(() => assert.equal(result.current.providerProfiles.length, 2));
    assert.equal(result.current.error, null);
    assert.equal(result.current.loading, false);
    assert.equal(result.current.selectedRuntimeProfileId, 'work');
    assert.equal(runtimeProfilesRequest.mock.calls.length, 2);
  });
}
