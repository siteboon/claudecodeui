import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * Regression guard for the working directory of the provider login shell.
 * Settings and onboarding open it without a project, and it used to send a
 * hardcoded `/workspace` in platform mode, which the server rejects with
 * "Invalid project path" wherever that directory does not exist. The server
 * owns the workspaces root, so the dialog must leave the path empty in both
 * modes.
 *
 * IS_PLATFORM is resolved at module scope from a build-time flag, so each test
 * loads a fresh copy of the modal with the flag stubbed.
 */

const shellProjects: Array<Project | null | undefined> = [];

vi.mock('@/modules/standalone-shell', () => ({
  StandaloneShell: ({ project }: { project?: Project | null }) => {
    shellProjects.push(project);
    return null;
  },
}));

const renderLoginModal = async (isPlatform: boolean) => {
  vi.stubEnv('VITE_IS_PLATFORM', isPlatform ? 'true' : 'false');
  vi.resetModules();
  const { ProviderLoginModal } = await import('@/modules/provider-auth');
  shellProjects.length = 0;
  render(<ProviderLoginModal isOpen provider="claude" onClose={() => {}} />);
  return shellProjects.at(-1);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

test('platform mode leaves the login shell path to the server', async () => {
  const project = await renderLoginModal(true);
  assert.equal(project?.fullPath, '');
  assert.equal(project?.path, '');
});

test('self-hosted mode leaves the login shell path to the server', async () => {
  const project = await renderLoginModal(false);
  assert.equal(project?.fullPath, '');
  assert.equal(project?.path, '');
});
