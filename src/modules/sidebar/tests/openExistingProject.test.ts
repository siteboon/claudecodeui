import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

vi.mock('@/shared/api', () => ({
  api: {
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
    recentConversations: () => Promise.resolve({ ok: true, json: async () => ({ data: { conversations: [] } }) }),
    migrateLegacyProjectStars: () => Promise.resolve({ ok: true, json: async () => ({}) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const t = ((key: string) => key) as unknown as TFunction;

const makeProject = (projectId: string): Project => ({
  projectId,
  path: `/workspace/${projectId}`,
  fullPath: `/workspace/${projectId}`,
  displayName: projectId,
  isStarred: false,
  sessions: [],
});

const PROJECTS = [makeProject('project-1'), makeProject('project-2')];

const renderController = (keepProjectsExpanded = false) =>
  renderHook(
    ({ selectedProject }: { selectedProject: Project | null }) =>
      useSidebarController({
        projects: PROJECTS,
        selectedProject,
        selectedSession: null,
        activeSessions: new Set<string>(),
        backgroundSessionIds: new Set<string>(),
        isLoading: false,
        isMobile: false,
        t,
        onRefresh: vi.fn(),
        onProjectSelect: vi.fn(),
        onSessionSelect: vi.fn(),
        setCurrentProject: vi.fn(),
        setSidebarVisible: vi.fn(),
        sidebarVisible: true,
        keepProjectsExpanded,
      }),
    { initialProps: { selectedProject: PROJECTS[0] as Project | null } },
  );

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('ensureProjectExpanded expands Projects-mode state even when invoked from running searchMode', async () => {
  const { result } = renderController(false);
  await act(async () => {});

  // Collapse project-1 in Projects mode while keeping it selected.
  act(() => {
    result.current.toggleProject('project-1');
  });
  assert.equal(result.current.isProjectExpanded('project-1'), false);

  // Switch to Running mode, then mimic handleOpenExistingProject calling
  // setSearchMode('projects') and ensureProjectExpanded within the same handler closure.
  act(() => {
    result.current.setSearchMode('running');
  });
  assert.equal(result.current.searchMode, 'running');

  act(() => {
    result.current.setSearchMode('projects');
    result.current.setSearchFilter('');
    result.current.ensureProjectExpanded('project-1');
  });

  assert.equal(result.current.searchMode, 'projects');
  assert.equal(result.current.isProjectExpanded('project-1'), true);

  // Re-invoking ensureProjectExpanded on an already-expanded project never collapses it.
  act(() => {
    result.current.ensureProjectExpanded('project-1');
  });
  assert.equal(result.current.isProjectExpanded('project-1'), true);

  // Even if the project was collapsed in Running mode, returning to Projects keeps it expanded.
  act(() => {
    result.current.setSearchMode('running');
  });
  act(() => {
    result.current.toggleProject('project-1');
  });
  assert.equal(result.current.isProjectExpanded('project-1'), false);

  act(() => {
    result.current.setSearchMode('projects');
    result.current.ensureProjectExpanded('project-1');
  });
  assert.equal(result.current.isProjectExpanded('project-1'), true);
});

test('ensureProjectExpanded respects keepProjectsExpanded when expanding another project', async () => {
  const { result } = renderController(true);
  await act(async () => {});

  act(() => {
    result.current.ensureProjectExpanded('project-2');
  });

  assert.equal(result.current.isProjectExpanded('project-1'), true);
  assert.equal(result.current.isProjectExpanded('project-2'), true);
});
