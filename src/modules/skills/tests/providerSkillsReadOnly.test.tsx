import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { SkillsProject } from '@/shared/types';

/**
 * Pi discovers skills from disk but has no writable skill home, so the backend
 * rejects every managed install. The skills page must therefore hide the write
 * affordance for read-only providers instead of offering an install that can
 * only fail, while write-capable providers keep it.
 */

const useProviderSkillsMock = vi.fn();

vi.mock('@/modules/skills/hooks/useProviderSkills', () => ({
  useProviderSkills: (args: unknown) => useProviderSkillsMock(args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Keys are asserted verbatim so this test stays independent of locale files.
    t: (key: string) => key,
  }),
  Trans: () => null,
}));

const { default: ProviderSkills } = await import('@/modules/skills/ProviderSkills');

const baseHookResult = {
  skills: [],
  isLoading: false,
  isLoadingProjectScopes: false,
  loadError: null,
  saveStatus: null,
  addSkills: vi.fn(),
  refreshSkills: vi.fn(),
};

const currentProjects: SkillsProject[] = [];

beforeEach(() => {
  useProviderSkillsMock.mockReset().mockReturnValue({ ...baseHookResult });
});

test('pi renders a read-only skills page with no install affordance', () => {
  const { container } = render(
    <ProviderSkills selectedProvider="pi" currentProjects={currentProjects} />,
  );

  assert.equal(container.textContent?.includes('skillsPage.addSkill'), false);
  assert.equal(container.textContent?.includes('skillsPage.readOnlyDescription'), true);
  // The empty state points at a directory pi actually scans.
  assert.equal(container.textContent?.includes('~/.pi/agent/skills/'), true);
});

test('write-capable providers keep the install affordance', () => {
  const { container } = render(
    <ProviderSkills selectedProvider="claude" currentProjects={currentProjects} />,
  );

  assert.equal(container.textContent?.includes('skillsPage.addSkill'), true);
  assert.equal(container.textContent?.includes('skillsPage.readOnlyDescription'), false);
});
