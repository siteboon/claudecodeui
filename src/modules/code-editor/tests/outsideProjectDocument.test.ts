import { renderHook, waitFor, act } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

/**
 * A file read from outside the project is read-only because the server says
 * so, not because it was approved once: approvals are per project, and the
 * same path inside its own project stays an ordinary editable file.
 */
const reads: Array<{ projectId: string; path: string; allowOutside: boolean }> = [];
const saves: string[] = [];

vi.mock('@/shared/api', () => ({
  api: {
    readFile: async (projectId: string, filePath: string, allowOutside = false) => {
      reads.push({ projectId, path: filePath, allowOutside });
      if (projectId === 'other' && !allowOutside) {
        return new Response(JSON.stringify({ error: 'outside', code: 'OUTSIDE_PROJECT_CONFIRM' }), { status: 403 });
      }
      return new Response(JSON.stringify({ content: 'text', outsideProject: projectId === 'other' }), { status: 200 });
    },
    saveFile: async (_projectId: string, filePath: string) => {
      saves.push(filePath);
      return new Response('{}', { status: 200 });
    },
  },
  readApiJson: async (response: Response) => {
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error), { code: data.code });
    return data;
  },
}));

const { useCodeEditorDocument } = await import('@/modules/code-editor/hooks/useCodeEditorDocument');

const file = (projectId: string) => ({ name: 'notes.txt', path: '/srv/shared/notes.txt', projectId });

test('a confirmed outside file is read-only and cannot be saved', async () => {
  const { result } = renderHook(() => useCodeEditorDocument({ file: file('other') as never }));
  await waitFor(() => expect(result.current.needsOutsideConfirm).toBe(true));

  act(() => result.current.confirmOutsideFile());
  await waitFor(() => expect(result.current.isOutsideProject).toBe(true));
  expect(reads.at(-1)).toEqual({ projectId: 'other', path: '/srv/shared/notes.txt', allowOutside: true });

  await act(async () => { await result.current.handleSave(); });
  expect(saves).toEqual([]);
});

test('approving a path in one project does not make it read-only in its own project', async () => {
  const { result } = renderHook(() => useCodeEditorDocument({ file: file('owner') as never }));
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.isOutsideProject).toBe(false);
  expect(reads.at(-1)).toEqual({ projectId: 'owner', path: '/srv/shared/notes.txt', allowOutside: false });
});
