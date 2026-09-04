import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * Regression guard: an absolute path must open the file it names.
 *
 * `findBestMatch` falls back to matching by filename, which is what makes bare
 * references like `foo.ts` work. Applied to an absolute path it silently
 * rewrote the reference: asking for `/home/user/.config/CLAUDE.md` opened the
 * project's own `CLAUDE.md` — a different file, with no error, indistinguishable
 * from the right one.
 */

const getFiles = vi.fn();

vi.mock('@/shared/api', () => ({
  api: { getFiles: (...args: unknown[]) => getFiles(...args) },
}));

const { useFileOpenResolver } = await import('../hooks/useFileOpenResolver');

const ROOT = '/home/odoo/workspace/personal';
const project = { projectId: 'p1', name: 'personal', path: ROOT } as unknown as Project;

const tree = [
  { type: 'file', name: 'CLAUDE.md', path: `${ROOT}/CLAUDE.md` },
  {
    type: 'directory',
    name: 'src',
    path: `${ROOT}/src`,
    children: [{ type: 'file', name: 'foo.ts', path: `${ROOT}/src/foo.ts` }],
  },
];

const setup = () => {
  getFiles.mockReset();
  getFiles.mockResolvedValue({ ok: true, json: async () => tree });
  const onFileOpen = vi.fn();
  const { result } = renderHook(() => useFileOpenResolver(project, onFileOpen));
  return { resolve: result.current, onFileOpen };
};

test('an absolute path outside the project is passed through untouched', async () => {
  const { resolve, onFileOpen } = setup();
  resolve('/home/odoo/.claude/CLAUDE.md');
  await waitFor(() => assert.equal(onFileOpen.mock.calls.length, 1));
  assert.equal(onFileOpen.mock.calls[0][0], '/home/odoo/.claude/CLAUDE.md');
  // It does not even need the tree, so no request goes out.
  assert.equal(getFiles.mock.calls.length, 0);
});

test('an absolute path inside the project resolves to itself, as before', async () => {
  const { resolve, onFileOpen } = setup();
  resolve(`${ROOT}/src/foo.ts`);
  await waitFor(() => assert.equal(onFileOpen.mock.calls.length, 1));
  assert.equal(onFileOpen.mock.calls[0][0], `${ROOT}/src/foo.ts`);
});

test('partial references still match against the tree', async () => {
  const { resolve, onFileOpen } = setup();
  resolve('foo.ts');
  await waitFor(() => assert.equal(onFileOpen.mock.calls.length, 1));
  assert.equal(onFileOpen.mock.calls[0][0], `${ROOT}/src/foo.ts`);

  const second = setup();
  second.resolve('src/foo.ts');
  await waitFor(() => assert.equal(second.onFileOpen.mock.calls.length, 1));
  assert.equal(second.onFileOpen.mock.calls[0][0], `${ROOT}/src/foo.ts`);
});

test('line and diffInfo survive the absolute-path shortcut', async () => {
  const { resolve, onFileOpen } = setup();
  resolve('/home/odoo/.claude/CLAUDE.md', undefined, 150);
  await waitFor(() => assert.equal(onFileOpen.mock.calls.length, 1));
  assert.equal(onFileOpen.mock.calls[0][2], 150);
});
