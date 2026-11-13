import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

const openSettings = vi.fn();
const refreshProjectsSilently = vi.fn();
const setActiveTab = vi.fn();
const setSidebarOpen = vi.fn();
const navigate = vi.fn();
const subscribe = vi.fn(() => () => undefined);
const isSessionProcessing = () => false;

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

const createProjectsState = (
  selectedProject: Project | null = project,
  selectedSession: ProjectSession | null = firstSession,
) => ({
  openSettings,
  refreshProjectsSilently,
  selectedProject,
  selectedSession,
  setActiveTab,
  setSidebarOpen,
});

// Keep callbacks stable so selection-only changes exercise the provider's memo dependencies.
let projectsState = createProjectsState();

vi.mock('@/modules/command-palette', () => ({
  usePaletteOpsRegister: () => undefined,
}));

vi.mock('@/modules/project-workspace/hooks/useProjectsState', () => ({
  useProjectsState: () => projectsState,
}));

vi.mock('@/shared/selectedProvider', () => ({
  writeSelectedProvider: () => undefined,
}));

const { default: ProjectEffects } = await import('@/modules/project-workspace/controllers/ProjectEffects');
const { ProjectsStateProvider } = await import('@/modules/project-workspace/context/ProjectsStateContext');

function WorkspaceEffects() {
  return (
    <ProjectsStateProvider
      navigate={navigate}
      subscribe={subscribe}
      isMobile={false}
      isSessionProcessing={isSessionProcessing}
    >
      <ProjectEffects navigate={navigate} />
    </ProjectsStateProvider>
  );
}

beforeEach(() => {
  projectsState = createProjectsState();
  document.title = 'CloudCLI UI';
});

test('updates the document title through the provider independently of the sidebar view', () => {
  const view = render(<WorkspaceEffects />);
  assert.equal(document.title, 'First conversation');

  projectsState = { ...projectsState, selectedSession: secondSession };
  view.rerender(<WorkspaceEffects />);

  assert.equal(document.title, 'Conversation opened from Conversations');
});

test('updates the project and default titles through the provider without a selected session', () => {
  projectsState = createProjectsState(project, null);
  const view = render(<WorkspaceEffects />);
  assert.equal(document.title, 'CloudCLI - CloudCLI UI');

  projectsState = { ...projectsState, selectedProject: { ...project, displayName: 'Another project' } };
  view.rerender(<WorkspaceEffects />);
  assert.equal(document.title, 'Another project - CloudCLI UI');

  projectsState = { ...projectsState, selectedProject: null };
  view.rerender(<WorkspaceEffects />);
  assert.equal(document.title, 'CloudCLI UI');
});

test('keeps an active completion marker while the selected conversation changes', () => {
  const view = render(<WorkspaceEffects />);
  document.title = '[Done] First conversation';
  projectsState = { ...projectsState, selectedSession: secondSession };
  view.rerender(<WorkspaceEffects />);
  assert.equal(document.title, '[Done] Conversation opened from Conversations');
});
