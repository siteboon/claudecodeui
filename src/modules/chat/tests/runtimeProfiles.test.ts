import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

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
      runtimeProfiles: () => Promise.resolve({
        json: async () => ({ success: true, data: { profiles } }),
      }),
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
