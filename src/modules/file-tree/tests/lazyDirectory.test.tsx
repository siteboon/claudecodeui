import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import '@/modules/i18n';

import type { Project } from '@/shared/types';

const getDirectoryPage = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api', () => ({ api: { getDirectoryPage } }));
const { default: FileTree } = await import('@/modules/file-tree/FileTree');
const project: Project = { projectId: 'p1', displayName: 'DemoProject', path: '/workspace/DemoProject', fullPath: '/workspace/DemoProject' };
const folder = { type: 'directory', name: 'Documents', path: '/workspace/DemoProject/Documents' };
const reply = (entries: unknown[], nextCursor: string | null = null) => ({ ok: true, json: async () => ({ entries, nextCursor }) });
afterEach(() => { cleanup(); getDirectoryPage.mockReset(); });

test('loads only root, expands on demand, pages without growing rendered rows and retries errors', async () => {
  getDirectoryPage.mockImplementation(async (_id, directory, cursor) => {
    if (!directory) return reply([folder]);
    if (cursor) return reply([{ type: 'file', name: 'last.md', path: directory + '/last.md' }]);
    return reply(Array.from({ length: 200 }, (_, i) => ({ type: 'file', name: `lesson-${i}.md`, path: `${directory}/lesson-${i}.md` })), 'page2');
  });
  render(<FileTree selectedProject={project} />);
  await screen.findByText('Documents');
  expect(getDirectoryPage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Documents'));
  await screen.findByText('lesson-199.md');
  expect(getDirectoryPage).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText('Next 200'));
  await screen.findByText('last.md');
  expect(screen.queryByText('lesson-0.md')).toBeNull();
  fireEvent.click(screen.getByText('Previous 200'));
  await screen.findByText('lesson-0.md');
  getDirectoryPage.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Folder changed. Refresh to restart listing.' }) });
  fireEvent.click(screen.getByText('Next 200'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Reload folder'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByText(/Search filters loaded pages/)).toBeTruthy();
}, 20000);

test('late responses from an old project cannot replace the selected project', async () => {
  let finish!: (value: unknown) => void;
  getDirectoryPage.mockImplementation((id) => id === 'p1' ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve(reply([{ type: 'file', name: 'new.md', path: '/new/new.md' }])));
  const view = render(<FileTree selectedProject={project} />);
  await waitFor(() => expect(getDirectoryPage).toHaveBeenCalledTimes(1));
  view.rerender(<FileTree selectedProject={{ ...project, projectId: 'p2' }} />);
  await screen.findByText('new.md');
  finish(reply([folder]));
  await waitFor(() => expect(screen.queryByText('Documents')).toBeNull());
});

test('a folder reference can return to an earlier cached page', async () => {
  getDirectoryPage.mockImplementation(async (_id, directory, cursor) => {
    if (directory) return reply([]);
    return cursor ? reply([{ type: 'file', name: 'last.md', path: '/workspace/DemoProject/last.md' }]) : reply([folder], 'page2');
  });
  const view = render(<FileTree selectedProject={project} />);
  await screen.findByText('Documents');
  fireEvent.click(screen.getByText('Next 200'));
  await screen.findByText('last.md');
  view.rerender(<FileTree selectedProject={project} revealDirectory={{ path: 'Documents' }} />);
  await screen.findByText('Documents');
  await waitFor(() => expect(getDirectoryPage.mock.calls.some(([, directory]) => directory === folder.path)).toBe(true));
});
