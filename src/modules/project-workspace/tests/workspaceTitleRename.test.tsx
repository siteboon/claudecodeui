import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

/**
 * The chat header's session title can be renamed in place: double-click opens
 * an input seeded with the title, Enter saves the trimmed draft, Escape and
 * clicking away discard it. This is the second way to rename a session beside
 * the sidebar's menu, so it must never reach the backend for a no-op edit.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) => (
      key === 'mainContent.renameSessionHint' && options?.title
        ? `${options.title} (double-click to rename)`
        : key
    ),
  }),
}));

vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({ plugins: [] }),
}));

vi.mock('@/shared/ui', () => ({
  LLMProviderLogo: () => null,
}));

const { default: WorkspaceTitle } = await import('@/modules/project-workspace/WorkspaceTitle');

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'repo',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
};

const session: ProjectSession = {
  id: 'session-1',
  summary: 'Original title',
  __provider: 'claude',
  __projectId: 'project-1',
};

const onRenameSession = vi.fn<(sessionId: string, summary: string) => Promise<boolean>>();

const renderTitle = (overrides: { selectedSession?: ProjectSession | null; activeTab?: 'chat' | 'files' } = {}) => render(
  <WorkspaceTitle
    activeTab={overrides.activeTab ?? 'chat'}
    selectedProject={project}
    selectedSession={overrides.selectedSession === undefined ? session : overrides.selectedSession}
    shouldShowTasksTab={false}
    onRenameSession={onRenameSession}
  />,
);

const titleHeading = () => screen.getByRole('heading', { level: 2 });
const renameInput = () => screen.getByRole('textbox', { name: 'mainContent.renameSessionLabel' }) as HTMLInputElement;
const queryRenameInput = () => screen.queryByRole('textbox', { name: 'mainContent.renameSessionLabel' });

beforeEach(() => {
  onRenameSession.mockReset();
  onRenameSession.mockResolvedValue(true);
});

test('double-clicking the session title opens an input seeded with the title, focused and selected', () => {
  renderTitle();

  const heading = titleHeading();
  assert.equal(heading.textContent, 'Original title');
  assert.equal(heading.getAttribute('title'), 'Original title (double-click to rename)');
  assert.equal(queryRenameInput(), null);

  fireEvent.doubleClick(heading);

  const input = renameInput();
  assert.equal(input.value, 'Original title');
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, 'Original title'.length);
  assert.equal(screen.queryByRole('heading', { level: 2 }), null);
});

test('Enter saves the trimmed draft through the rename callback and closes the editor', async () => {
  renderTitle();
  fireEvent.doubleClick(titleHeading());

  fireEvent.change(renameInput(), { target: { value: '   Renamed from header  ' } });
  await act(async () => {
    fireEvent.keyDown(renameInput(), { key: 'Enter' });
  });

  assert.deepEqual(onRenameSession.mock.calls, [['session-1', 'Renamed from header']]);
  assert.equal(queryRenameInput(), null);
  assert.ok(titleHeading());
});

test('Escape restores the title without calling the rename callback', () => {
  renderTitle();
  fireEvent.doubleClick(titleHeading());

  fireEvent.change(renameInput(), { target: { value: 'Discarded' } });
  fireEvent.keyDown(renameInput(), { key: 'Escape' });

  assert.equal(onRenameSession.mock.calls.length, 0);
  assert.equal(queryRenameInput(), null);
  assert.equal(titleHeading().textContent, 'Original title');
});

test('clicking away cancels the edit, as the sidebar rename does', () => {
  renderTitle();
  fireEvent.doubleClick(titleHeading());

  fireEvent.change(renameInput(), { target: { value: 'Discarded' } });
  fireEvent.blur(renameInput());

  assert.equal(onRenameSession.mock.calls.length, 0);
  assert.equal(titleHeading().textContent, 'Original title');
});

test('an unchanged or blank draft closes the editor without a request', async () => {
  renderTitle();

  fireEvent.doubleClick(titleHeading());
  await act(async () => {
    fireEvent.keyDown(renameInput(), { key: 'Enter' });
  });
  assert.equal(queryRenameInput(), null);

  fireEvent.doubleClick(titleHeading());
  fireEvent.change(renameInput(), { target: { value: '   ' } });
  await act(async () => {
    fireEvent.keyDown(renameInput(), { key: 'Enter' });
  });
  assert.equal(queryRenameInput(), null);

  assert.equal(onRenameSession.mock.calls.length, 0);
  assert.equal(titleHeading().textContent, 'Original title');
});

test('a refused rename is reported the way the sidebar reports it', async () => {
  onRenameSession.mockResolvedValue(false);
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  renderTitle();

  fireEvent.doubleClick(titleHeading());
  fireEvent.change(renameInput(), { target: { value: 'Refused' } });
  await act(async () => {
    fireEvent.keyDown(renameInput(), { key: 'Enter' });
  });

  assert.deepEqual(alertSpy.mock.calls, [['sidebar:messages.renameSessionFailed']]);
  assert.equal(queryRenameInput(), null);
});

test('the title is not editable without a session or off the chat tab', () => {
  const { unmount } = renderTitle({ selectedSession: null });
  fireEvent.doubleClick(titleHeading());
  assert.equal(queryRenameInput(), null);
  unmount();

  renderTitle({ activeTab: 'files' });
  fireEvent.doubleClick(titleHeading());
  assert.equal(queryRenameInput(), null);
  assert.equal(onRenameSession.mock.calls.length, 0);
});
