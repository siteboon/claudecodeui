import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { resetUserPreferences } from '@/shared/userSettings';

/**
 * The chat module reads provider capabilities through `useChatProviderState`,
 * and side questions are gated the same way session forking is: the hook
 * exposes `supportsSideQuestions` for the active provider, straight from the
 * server's capability matrix. Until that matrix has loaded the answer is
 * false, so nothing offers a side question to a provider that may not have one.
 */

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

const MATRIX = {
  success: true,
  data: {
    providers: [
      { provider: 'claude', permissionModes: ['default'], defaultPermissionMode: 'default', supportsSideQuestions: true },
      { provider: 'cursor', permissionModes: ['default'], defaultPermissionMode: 'default', supportsSideQuestions: false },
      { provider: 'codex', permissionModes: ['default'], defaultPermissionMode: 'default', supportsSideQuestions: true },
      // An entry without the field reads as unsupported, not as supported.
      { provider: 'opencode', permissionModes: ['default'], defaultPermissionMode: 'default' },
    ],
  },
};

// The capabilities response is held until a test releases it, so the state
// before the matrix loads can be observed.
let releaseCapabilities: () => void = () => undefined;

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: () => okJson({ success: true, data: null }),
      capabilities: () => new Promise((resolve) => {
        releaseCapabilities = () => resolve({ ok: true, json: async () => MATRIX });
      }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
      createModel: () => okJson({ success: true, data: null }),
      updateModel: () => okJson({ success: true, data: null }),
      removeModel: () => okJson({ success: true, data: null }),
    },
  },
}));

type ProviderState = { supportsSideQuestions?: boolean; setProvider: (provider: string) => void };

const renderProviderState = async () => {
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  return renderHook(() =>
    useChatProviderState({ selectedSession: null, selectedProject: null }) as unknown as ProviderState,
  );
};

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  releaseCapabilities = () => undefined;
});

afterEach(() => {
  vi.resetModules();
});

test('supportsSideQuestions is false before the capability matrix has loaded', async () => {
  const { result } = await renderProviderState();

  assert.equal(result.current.supportsSideQuestions, false, 'a boolean false, not undefined');
});

test('supportsSideQuestions follows the matrix for the active provider once it loads', async () => {
  const { result } = await renderProviderState();
  await act(async () => { releaseCapabilities(); });

  await waitFor(() => assert.equal(result.current.supportsSideQuestions, true, 'claude answers side questions'));

  act(() => { result.current.setProvider('cursor'); });
  assert.equal(result.current.supportsSideQuestions, false, 'cursor does not');

  act(() => { result.current.setProvider('codex'); });
  assert.equal(result.current.supportsSideQuestions, true, 'codex does');

  act(() => { result.current.setProvider('opencode'); });
  assert.equal(result.current.supportsSideQuestions, false, 'a missing field reads as unsupported');
});
