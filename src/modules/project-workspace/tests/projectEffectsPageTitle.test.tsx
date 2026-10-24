import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

const openSettings = vi.fn();
const refreshProjectsSilently = vi.fn();
const setActiveTab = vi.fn();
const setSidebarOpen = vi.fn();
const navigate = vi.fn();

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'CloudCLI',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
};

const firstSession: ProjectSession = {
  id: 'session-1',
  summary: 'First conversation',
  __provider: 'codex',
};

const secondSession: ProjectSession = {
  id: 'session-2',
  summary: 'Conversation opened from Conversations',
  __provider: 'codex',
};

let effectsState = {
  openSettings,
  refreshProjectsSilently,
  selectedProject: project,
  selectedSession: firstSession,
  setActiveTab,
  setSidebarOpen,
};

vi.mock('@/modules/command-palette', () => ({
  usePaletteOpsRegister: () => undefined,
}));

vi.mock('@/modules/project-workspace/context/ProjectsStateContext', () => ({
  useProjectEffectsState: () => effectsState,
}));

vi.mock('@/shared/selectedProvider', () => ({
  writeSelectedProvider: () => undefined,
}));

const { default: ProjectEffects } = await import('@/modules/project-workspace/controllers/ProjectEffects');

beforeEach(() => {
  effectsState = {
    openSettings,
    refreshProjectsSilently,
    selectedProject: project,
    selectedSession: firstSession,
    setActiveTab,
    setSidebarOpen,
  };
  document.title = 'CloudCLI UI';
});

test('updates the document title independently of the sidebar view', () => {
  const view = render(<ProjectEffects navigate={navigate} />);
  assert.equal(document.title, 'First conversation');

  effectsState = { ...effectsState, selectedSession: secondSession };
  view.rerender(<ProjectEffects navigate={navigate} />);

  assert.equal(document.title, 'Conversation opened from Conversations');
});
