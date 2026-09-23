import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import GitPanel from '@/modules/git-panel/GitPanel';
import type { Project } from '@/shared/types';

/**
 * Issue #1025: the Changes view used to request /api/git/diff for every changed
 * file right after /status, so one large untracked binary was downloaded (and
 * decoded on the server) without the user expanding anything. Diffs now load
 * when a row is expanded, once per status refresh.
 */

type DiffPayload = { diff: string; isBinary?: boolean; isTruncated?: boolean };

const gitApi = vi.hoisted(() => ({
  status: vi.fn(),
  diff: vi.fn(),
  branches: vi.fn(),
  remoteStatus: vi.fn(),
  commits: vi.fn(),
}));

vi.mock('@/shared/api', () => ({ api: { git: gitApi } }));

const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const DIFFS: Record<string, DiffPayload> = {
  'src/app.ts': { diff: '@@ -1 +1 @@\n-old app\n+new app', isBinary: false, isTruncated: false },
  'notes.txt': { diff: '--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1,1 @@\n+first note', isBinary: false, isTruncated: false },
  'artifact.bin': { diff: '', isBinary: true, isTruncated: false },
};

const project = { projectId: 'project-1', displayName: 'repo', fullPath: '/work/repo' } as Project;

const requestedDiffs = () => gitApi.diff.mock.calls.map(([, filePath]) => filePath as string);

const rowFor = (filePath: string) => screen.getByText(filePath).parentElement as HTMLElement;

const toggleRow = (filePath: string) => {
  const row = rowFor(filePath);
  const chevron = within(row).queryByTitle('Expand diff') ?? within(row).getByTitle('Collapse diff');
  fireEvent.click(chevron);
};

// Lets pending fetch/json promises and the effects they trigger settle.
const settle = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const renderPanel = async () => {
  render(<GitPanel selectedProject={project} />);
  await screen.findByText('artifact.bin');
  await settle();
};

beforeEach(() => {
  gitApi.status.mockImplementation(async () => jsonResponse({
    branch: 'main',
    hasCommits: true,
    modified: ['src/app.ts'],
    added: [],
    deleted: [],
    untracked: ['notes.txt', 'artifact.bin'],
    staged: [],
  }));
  gitApi.diff.mockImplementation(async (_projectId: string, filePath: string) => jsonResponse(DIFFS[filePath]));
  gitApi.branches.mockImplementation(async () => jsonResponse({ branches: ['main'], localBranches: ['main'], remoteBranches: [] }));
  gitApi.remoteStatus.mockImplementation(async () => jsonResponse({ hasRemote: false }));
  gitApi.commits.mockImplementation(async () => jsonResponse({ commits: [] }));
});

test('opening the Changes view requests no diffs', async () => {
  await renderPanel();

  assert.equal(gitApi.status.mock.calls.length, 1);
  assert.deepEqual(requestedDiffs(), []);
});

test('expanding a row fetches that one diff, and re-expanding reuses it', async () => {
  await renderPanel();

  toggleRow('notes.txt');
  await screen.findByText('+first note');
  assert.deepEqual(requestedDiffs(), ['notes.txt']);

  toggleRow('notes.txt');
  toggleRow('notes.txt');
  await settle();
  assert.deepEqual(requestedDiffs(), ['notes.txt']);
});

test('toggling a row while its diff is in flight sends a single request', async () => {
  let respond: (payload: DiffPayload) => void = () => {};
  gitApi.diff.mockImplementation(() => new Promise<Response>((resolve) => {
    respond = (payload) => resolve(jsonResponse(payload));
  }));
  await renderPanel();

  toggleRow('notes.txt');
  toggleRow('notes.txt');
  toggleRow('notes.txt');
  await settle();
  assert.deepEqual(requestedDiffs(), ['notes.txt']);

  respond(DIFFS['notes.txt']);
  await screen.findByText('+first note');
  assert.deepEqual(requestedDiffs(), ['notes.txt']);
});

test('a binary file shows a notice instead of a diff', async () => {
  await renderPanel();

  toggleRow('artifact.bin');

  await screen.findByText('Binary file — diff not shown');
  assert.deepEqual(requestedDiffs(), ['artifact.bin']);
});

test('refreshing the status re-fetches only the expanded rows', async () => {
  await renderPanel();
  toggleRow('notes.txt');
  await screen.findByText('+first note');

  fireEvent.click(screen.getByTitle('Refresh git status'));
  await waitFor(() => assert.equal(gitApi.status.mock.calls.length, 2));
  await screen.findByText('artifact.bin');
  await settle();

  assert.deepEqual(requestedDiffs(), ['notes.txt', 'notes.txt']);
});
