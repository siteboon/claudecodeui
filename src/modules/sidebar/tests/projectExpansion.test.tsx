import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

vi.mock('@/shared/api', () => ({
  api: {
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const projects: Project[] = ['alpha', 'beta', 'gamma'].map((projectId) => ({
  projectId,
  path: `/${projectId}`,
  fullPath: `/${projectId}`,
  displayName: projectId,
  sessions: [],
}));
const t = ((key: string) => key) as unknown as TFunction;
const noop = () => {};
type ControllerProps = { selectedProject: Project | null; selectedSession?: ProjectSession | null };

function renderController(isMobile: boolean) {
  return renderHook(
    ({ selectedProject, selectedSession = null }: ControllerProps) => useSidebarController({
      projects,
      selectedProject,
      selectedSession,
      activeSessions: new Set<string>(),
      backgroundSessionIds: new Set<string>(),
      isLoading: false,
      isMobile,
      t,
      onRefresh: noop,
      onProjectSelect: noop,
      onSessionSelect: noop,
      setCurrentProject: noop,
      setSidebarVisible: noop,
      sidebarVisible: true,
    }),
    { initialProps: { selectedProject: projects[0] } as ControllerProps },
  );
}

function expandedIds(controller: ReturnType<typeof useSidebarController>) {
  return projects.filter((project) => controller.isProjectExpanded(project.projectId))
    .map((project) => project.projectId);
}

beforeEach(() => localStorage.clear());

for (const isMobile of [false, true]) {
  const layout = isMobile ? 'mobile' : 'desktop';

  test(`${layout}: selecting another project's session leaves only its project expanded`, () => {
    const { result, rerender } = renderController(isMobile);
    assert.deepEqual(expandedIds(result.current), ['alpha']);

    for (const project of [projects[1], projects[2], projects[0]]) {
      rerender({ selectedProject: project });
      assert.deepEqual(expandedIds(result.current), [project.projectId]);
    }
  });

  test(`${layout}: selecting a project closes a different manually expanded project`, () => {
    const { result, rerender } = renderController(isMobile);
    act(() => result.current.toggleProject('beta'));
    assert.deepEqual(expandedIds(result.current), ['beta']);

    rerender({ selectedProject: projects[2] });
    assert.deepEqual(expandedIds(result.current), ['gamma']);
  });

  test(`${layout}: manual collapse survives a selected-project refresh and a same-project session switch`, () => {
    const { result, rerender } = renderController(isMobile);
    act(() => result.current.toggleProject('alpha'));
    assert.deepEqual(expandedIds(result.current), []);

    rerender({ selectedProject: { ...projects[0], sessions: [{ id: 'another-session', __provider: 'codex' }] } });
    assert.deepEqual(expandedIds(result.current), []);
    rerender({ selectedProject: projects[0], selectedSession: { id: 'another-session', __provider: 'codex' } });
    assert.deepEqual(expandedIds(result.current), []);

    rerender({ selectedProject: projects[1] });
    rerender({ selectedProject: projects[0] });
    assert.deepEqual(expandedIds(result.current), ['alpha']);
  });

  test(`${layout}: manual toggles allow one expanded project or none`, () => {
    const { result } = renderController(isMobile);
    act(() => result.current.toggleProject('beta'));
    assert.deepEqual(expandedIds(result.current), ['beta']);
    act(() => result.current.toggleProject('beta'));
    assert.deepEqual(expandedIds(result.current), []);
  });

  test(`${layout}: Running groups keep independent expansion when the selected project changes`, () => {
    const { result, rerender } = renderController(isMobile);
    act(() => result.current.setSearchMode('running'));
    assert.deepEqual(expandedIds(result.current), ['alpha', 'beta', 'gamma']);
    act(() => result.current.toggleProject('beta'));
    assert.deepEqual(expandedIds(result.current), ['alpha', 'gamma']);

    rerender({ selectedProject: projects[2] });
    assert.deepEqual(expandedIds(result.current), ['alpha', 'gamma']);
    act(() => result.current.setSearchMode('projects'));
    assert.deepEqual(expandedIds(result.current), ['gamma']);
  });
}
