import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * The per-file upload cap is server configuration (`UPLOAD_MAX_FILE_SIZE_MB`),
 * and the client ships prebuilt, so the Files tab has to ask the server for it.
 * A client that kept its own hard-coded 200 MB would refuse, before sending
 * anything, a file the server was configured to accept.
 */

const { uploadLimitsResponse } = vi.hoisted(() => ({
  uploadLimitsResponse: { current: (): Promise<Response> => Promise.reject(new Error('unset')) },
}));

vi.mock('@/shared/api', () => ({
  api: {
    fileUploadLimits: () => uploadLimitsResponse.current(),
    uploadFilesUrl: (projectId: string) => `/api/file-tree/projects/${projectId}/files/upload`,
  },
}));

const { useFileTreeUpload } = await import('@/modules/file-tree/hooks/useFileTreeUpload');

const MEGABYTE = 1024 * 1024;
const project: Project = { projectId: 'p1', displayName: 'repo', fullPath: '/repo', path: '/repo' };

/** Records what the hook sends instead of uploading; every upload succeeds. */
class RecordingXMLHttpRequest {
  static sent: Array<{ url: string; body: unknown }> = [];

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  private url = '';

  open(_method: string, url: string) {
    this.url = url;
  }

  setRequestHeader() {}

  getResponseHeader() {
    return null;
  }

  send(body: unknown) {
    RecordingXMLHttpRequest.sent.push({ url: this.url, body });
    this.status = 200;
    this.responseText = JSON.stringify({ success: true, uploadedCount: 1, requestedFileCount: 1 });
    queueMicrotask(() => this.onload?.());
  }
}

// A real 250 MB buffer is not needed: only the reported size is ever checked.
const fileOfSize = (name: string, megabytes: number) => {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: megabytes * MEGABYTE });
  return file;
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const renderUploadHook = () => {
  const showToast = vi.fn();
  const hook = renderHook(() => useFileTreeUpload({ selectedProject: project, onRefresh: () => {}, showToast }));
  return { ...hook, showToast };
};

beforeEach(() => {
  RecordingXMLHttpRequest.sent = [];
  vi.stubGlobal('XMLHttpRequest', RecordingXMLHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a file over 200 MB is uploaded when the server allows more', async () => {
  uploadLimitsResponse.current = async () => jsonResponse({ maximumFileSizeMegabytes: 300, maximumFileCount: 20 });
  const { result, showToast } = renderUploadHook();

  await waitFor(() => assert.equal(result.current.maxUploadSizeLabel, '300MB'));
  await act(() => result.current.uploadFiles([fileOfSize('big.bin', 250)]));

  assert.equal(RecordingXMLHttpRequest.sent.length, 1);
  assert.equal(RecordingXMLHttpRequest.sent[0].url, '/api/file-tree/projects/p1/files/upload');
  assert.deepEqual(showToast.mock.calls, [['Uploaded 1 file successfully', 'success']]);
});

test('a lower server limit is enforced before anything is sent', async () => {
  uploadLimitsResponse.current = async () => jsonResponse({ maximumFileSizeMegabytes: 50, maximumFileCount: 20 });
  const { result, showToast } = renderUploadHook();

  await waitFor(() => assert.equal(result.current.maxUploadSizeLabel, '50MB'));
  await act(() => result.current.uploadFiles([fileOfSize('medium.bin', 100)]));

  assert.equal(RecordingXMLHttpRequest.sent.length, 0);
  assert.deepEqual(showToast.mock.calls, [['medium.bin is larger than 50MB.', 'error']]);
  assert.equal(result.current.uploadProgress?.error, 'medium.bin is larger than 50MB.');
});

test('the 200 MB default stays in force when the server cannot report its limits', async () => {
  let requested = false;
  uploadLimitsResponse.current = async () => {
    requested = true;
    return new Response('Not found', { status: 404 });
  };
  const { result, showToast } = renderUploadHook();

  await waitFor(() => assert.equal(requested, true));
  assert.equal(result.current.maxUploadSizeLabel, '200MB');
  await act(() => result.current.uploadFiles([fileOfSize('big.bin', 250)]));

  assert.equal(RecordingXMLHttpRequest.sent.length, 0);
  assert.deepEqual(showToast.mock.calls, [['big.bin is larger than 200MB.', 'error']]);
});

test('a malformed field from the server falls back to its default', async () => {
  uploadLimitsResponse.current = async () => jsonResponse({ maximumFileSizeMegabytes: 300, maximumFileCount: 'many' });
  const { result, showToast } = renderUploadHook();

  // The size label switching to 300MB shows the response has been applied.
  await waitFor(() => assert.equal(result.current.maxUploadSizeLabel, '300MB'));
  await act(() => result.current.uploadFiles(
    Array.from({ length: 21 }, (_, index) => fileOfSize(`file-${index}.bin`, 1)),
  ));

  assert.equal(RecordingXMLHttpRequest.sent.length, 0);
  assert.deepEqual(showToast.mock.calls, [['You can upload up to 20 files at once.', 'error']]);
});
