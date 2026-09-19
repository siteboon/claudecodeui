import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { FileTreeNode, Project } from '@/shared/types';

/**
 * Covers the one user-visible change in the native-download work: clicking a
 * file in the tree now asks the server for a short-lived ticket and hands the
 * URL to the browser, instead of buffering the bytes in the page. A failed
 * ticket must surface as a toast and start no download at all — a browser that
 * navigates to a failed request saves the error body as the file.
 */

const requestDownloadTicket = vi.fn();
const triggerDownload = vi.fn();
const triggerBlobDownload = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    requestDownloadTicket: (...args: unknown[]) => requestDownloadTicket(...args),
  },
  fileDownloadUrl: (token: string) => `/api/download/file?t=${encodeURIComponent(token)}`,
}));

vi.mock('@/shared/download', () => ({
  triggerDownload: (...args: unknown[]) => triggerDownload(...args),
  triggerBlobDownload: (...args: unknown[]) => triggerBlobDownload(...args),
}));

const { useFileTreeOperations } = await import('@/modules/file-tree/hooks/useFileTreeOperations');

const ROOT = '/home/odoo/workspace/personal';
const project = { projectId: 'p1', displayName: 'personal', fullPath: ROOT, path: ROOT } as Project;
const file = {
  type: 'file',
  name: 'report.pdf',
  path: `${ROOT}/docs/report.pdf`,
} as unknown as FileTreeNode;

function renderOperations(toasts: Array<[string, string]>) {
  return renderHook(() => useFileTreeOperations({
    selectedProject: project,
    onRefresh: () => {},
    showToast: (message, type) => { toasts.push([message, type]); },
  }));
}

beforeEach(() => {
  requestDownloadTicket.mockReset();
  triggerDownload.mockReset();
  triggerBlobDownload.mockReset();
});

test('a ticket is exchanged for a native download with the name the server chose', async () => {
  requestDownloadTicket.mockResolvedValue({
    ok: true,
    json: async () => ({ token: 'tkt 1', name: 'отчёт 2026.pdf', size: 11 }),
  });

  const toasts: Array<[string, string]> = [];
  const { result } = renderOperations(toasts);

  await act(async () => { await result.current.handleDownload(file); });

  assert.deepEqual(requestDownloadTicket.mock.calls, [['p1', `${ROOT}/docs/report.pdf`]]);
  assert.deepEqual(triggerDownload.mock.calls, [['/api/download/file?t=tkt%201', 'отчёт 2026.pdf']]);
  assert.deepEqual(toasts, []);
});

test('a file that disappeared before the click becomes a toast, not a download', async () => {
  requestDownloadTicket.mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'File not found' }),
  });

  const toasts: Array<[string, string]> = [];
  const { result } = renderOperations(toasts);

  await act(async () => { await result.current.handleDownload(file); });

  assert.deepEqual(toasts, [['File not found', 'error']]);
  // Navigating anyway would save the 404 body under the file's name.
  assert.deepEqual(triggerDownload.mock.calls, []);
});
