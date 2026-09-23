import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * A project folder renamed outside the app leaves every chat attached to a path
 * that no longer exists (issue #1165). The row's editor is where that is
 * repaired, so it has to expose the folder and hand it to the save callback.
 */

vi.mock('@/modules/sidebar/SidebarProjectSessions', () => ({
  default: () => null,
}));

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({
  useCompactSidebar: () => false,
}));

const updateProjectPath = vi.fn();
const renameProject = vi.fn();
const refreshProjects = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({}) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({}) }),
    updateProjectPath: (...args: unknown[]) => updateProjectPath(...args),
    renameProject: (...args: unknown[]) => renameProject(...args),
  },
}));

vi.mock('@/modules/command-palette', () => ({
  usePaletteOps: () => ({ refreshProjects }),
}));

const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');
const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

beforeEach(() => {
  updateProjectPath.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  renameProject.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  refreshProjects.mockReset();
});

const PROJECT = {
  projectId: 'a',
  name: 'a',
  displayName: 'alpha',
  fullPath: '/workspace/alpha',
  sessions: [],
} as unknown as Project;

const noop = () => {};
const t = ((key: string) => key) as unknown as Parameters<typeof SidebarProjectItem>[0]['t'];

type ItemProps = Parameters<typeof SidebarProjectItem>[0];

const itemProps = (overrides: Partial<ItemProps>): ItemProps => ({
  project: PROJECT,
  selectedProject: null,
  selectedSession: null,
  isExpanded: false,
  isDeleting: false,
  isStarred: false,
  isEditing: true,
  renameDraft: 'alpha',
  renamePathDraft: PROJECT.fullPath,
  sessions: [],
  initialSessionsLoaded: true,
  isLoadingMoreSessions: false,
  currentTime: new Date('2026-08-21T10:00:00.000Z'),
  sessionRenameId: null,
  sessionRenameDraft: '',
  tasksEnabled: false,
  mcpServerStatus: null,
  onRenameDraftChange: noop,
  onRenamePathDraftChange: noop,
  onToggleProject: noop,
  onProjectSelect: noop,
  onToggleStarProject: noop,
  onStartEditingProject: noop,
  onCancelEditingProject: noop,
  onSaveProjectName: noop,
  onDeleteProject: noop,
  onSessionSelect: noop,
  onDeleteSession: noop,
  onLoadMoreSessions: noop,
  activeSessions: new Set<string>(),
  backgroundSessionIds: new Set<string>(),
  attentionSessionIds: new Set<string>(),
  onNewSession: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  t,
  ...overrides,
}) as ItemProps;

test('the project editor exposes the folder the project points at', () => {
  render(React.createElement(SidebarProjectItem, itemProps({})));

  const folderInputs = screen
    .getAllByPlaceholderText('projects.projectPathPlaceholder')
    .filter((input) => (input as HTMLInputElement).value === '/workspace/alpha');

  assert.ok(folderInputs.length > 0, 'the editor must show the current project folder');
});

test('every folder input is labelled, since its placeholder never shows', () => {
  render(React.createElement(SidebarProjectItem, itemProps({})));

  // The field is always prefilled, so a screen reader would otherwise announce
  // only its hover tooltip, which touch devices never show at all.
  const folderInputs = screen.getAllByPlaceholderText('projects.projectPathPlaceholder');
  assert.equal(screen.getAllByLabelText('projects.projectPathPlaceholder').length, folderInputs.length);
});

test('saving the editor hands the edited folder to the save callback', () => {
  const saved: Array<[string, string, string]> = [];

  render(
    React.createElement(
      SidebarProjectItem,
      itemProps({
        renamePathDraft: '/workspace/beta',
        onSaveProjectName: (projectId: string, nextName: string, nextPath: string) => {
          saved.push([projectId, nextName, nextPath]);
        },
      }),
    ),
  );

  const folderInput = screen
    .getAllByPlaceholderText('projects.projectPathPlaceholder')
    .find((input) => (input as HTMLInputElement).value === '/workspace/beta');
  assert.ok(folderInput);

  fireEvent.keyDown(folderInput, { key: 'Enter' });

  assert.deepEqual(saved, [['a', 'alpha', '/workspace/beta']]);
});

// The controller is what turns a save into API calls: it decides whether the
// folder has to be sent at all, and when the sidebar reloads afterwards.
// Built once: effects key off `projects` and `activeSessions`, so fresh values
// on every render would re-run them forever.
const CONTROLLER_ARGS: Parameters<typeof useSidebarController>[0] = {
  projects: [],
  selectedProject: null,
  selectedSession: null,
  activeSessions: new Set<string>(),
  isLoading: false,
  isMobile: false,
  t: t as unknown as TFunction,
  onRefresh: noop,
  onProjectSelect: noop,
  onSessionSelect: noop,
  setCurrentProject: noop,
  setSidebarVisible: noop,
  sidebarVisible: true,
};

const renderController = () => renderHook(() => useSidebarController(CONTROLLER_ARGS));

test('a name-only save renames the project without touching its folder', async () => {
  const { result } = renderController();

  act(() => result.current.startEditingProject(PROJECT));
  // The editor always holds the folder, so an untouched one comes back as-is.
  await act(() => result.current.saveProjectName('a', 'alpha renamed', `${PROJECT.fullPath} `));

  // The path endpoint validates the folder, which a project discovered outside
  // the workspace root fails, so an unchanged folder must never reach it.
  assert.equal(updateProjectPath.mock.calls.length, 0);
  assert.deepEqual(renameProject.mock.calls, [['a', 'alpha renamed']]);
  assert.equal(refreshProjects.mock.calls.length, 1);
});

test('a moved folder refreshes the sidebar even when the name then fails to save', async () => {
  renameProject.mockResolvedValue({ ok: false, json: async () => ({}) });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { result } = renderController();

  act(() => result.current.startEditingProject(PROJECT));
  await act(() => result.current.saveProjectName('a', 'alpha', '/workspace/beta'));
  consoleError.mockRestore();

  assert.deepEqual(updateProjectPath.mock.calls, [['a', '/workspace/beta']]);
  assert.equal(refreshProjects.mock.calls.length, 1, 'the sidebar must show the new folder');
});
