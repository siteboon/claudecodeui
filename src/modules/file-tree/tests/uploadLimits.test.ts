import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { Mock } from 'vitest';

import { useFileTreeUpload } from '@/modules/file-tree/hooks/useFileTreeUpload';
import type { Project } from '@/shared/types';

/**
 * The per-file upload cap is server configuration (`UPLOAD_MAX_FILE_SIZE_MB`),
 * and the client ships prebuilt, so the Files tab has to ask the server for it.
 * A client that kept its own hard-coded 200 MB would refuse, before sending
 * anything, a file the server was configured to accept.
 *
 * `fetch` is stubbed rather than the API module, so these tests also pin the
 * endpoint the hook asks.
 */

const UPLOAD_LIMITS_URL = '/api/file-tree/upload-limits';
const MEGABYTE = 1024 * 1024;
const project: Project = { projectId: 'p1', displayName: 'repo', fullPath: '/repo', path: '/repo' };

// How the server answers each GET /upload-limits; every test sets its own.
let answerUploadLimits: () => Promise<Response>;
let fetchMock: Mock<(url: string) => Promise<Response>>;

const requestedUrls = () => fetchMock.mock.calls.map(([url]) => url);

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

const limitsResponse = (maximumFileSizeMegabytes: unknown, maximumFileCount: unknown = 20) =>
  jsonResponse({ maximumFileSizeMegabytes, maximumFileCount });

const renderUploadHook = () => {
  // Stable callbacks, as FileTree passes them: an inline `onRefresh` would rebuild
  // `uploadFiles` on every render and hide a stale-closure bug in its dependencies.
  const showToast = vi.fn();
  const onRefresh = vi.fn();
  const hook = renderHook(() => useFileTreeUpload({ selectedProject: project, onRefresh, showToast }));
  return { ...hook, showToast };
};

beforeEach(() => {
  RecordingXMLHttpRequest.sent = [];
  vi.stubGlobal('XMLHttpRequest', RecordingXMLHttpRequest);
  answerUploadLimits = () => Promise.reject(new Error('no answer configured'));
  fetchMock = vi.fn((url: string) => (
    url === UPLOAD_LIMITS_URL ? answerUploadLimits() : Promise.reject(new Error(`unexpected fetch ${url}`))
  ));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a file over 200 MB is uploaded when the server allows more', async () => {
  answerUploadLimits = async () => limitsResponse(300);
  const { result, showToast } = renderUploadHook();

  await waitFor(() => assert.equal(result.current.maxUploadSizeLabel, '300MB'));
  await act(() => result.current.uploadFiles([fileOfSize('big.bin', 250)]));

  assert.equal(RecordingXMLHttpRequest.sent.length, 1);
  assert.equal(RecordingXMLHttpRequest.sent[0].url, '/api/file-tree/projects/p1/files/upload');
  assert.deepEqual(showToast.mock.calls, [['Uploaded 1 file successfully', 'success']]);
  // One request, to exactly this endpoint; a known answer is not asked for again.
  assert.deepEqual(requestedUrls(), [UPLOAD_LIMITS_URL]);
});

test('a lower server limit is enforced before anything is sent', async () => {
  answerUploadLimits = async () => limitsResponse(50);
  const { result, showToast } = renderUploadHook();

  await waitFor(() => assert.equal(result.current.maxUploadSizeLabel, '50MB'));
  await act(() => result.current.uploadFiles([fileOfSize('medium.bin', 100)]));

  assert.equal(RecordingXMLHttpRequest.sent.length, 0);
  assert.deepEqual(showToast.mock.calls, [['medium.bin is larger than 50MB.', 'error']]);
  assert.equal(result.current.uploadProgress?.error, 'medium.bin is larger than 50MB.');
});

test('a file picked while the limits are still loading waits for them', async () => {
  let answer!: (response: Response) => void;
  answerUploadLimits = () => new Promise<Response>((resolve) => {
    answer = resolve;
  });
  const { result, showToast } = renderUploadHook();
  await waitFor(() => assert.deepEqual(requestedUrls(), [UPLOAD_LIMITS_URL]));

  let upload!: Promise<void>;
  act(() => {
    upload = result.current.uploadFiles([fileOfSize('big.bin', 250)]);
  });
  // Neither sent nor refused against the 200 MB default yet.
  assert.equal(RecordingXMLHttpRequest.sent.length, 0);
  assert.equal(showToast.mock.calls.length, 0);

  await act(async () => {
    answer(limitsResponse(300));
    await upload;
  });

  assert.equal(RecordingXMLHttpRequest.sent.length, 1);
  assert.deepEqual(showToast.mock.calls, [['Uploaded 1 file successfully', 'success']]);
  assert.equal(result.current.maxUploadSizeLabel, '300MB');
  assert.deepEqual(requestedUrls(), [UPLOAD_LIMITS_URL]);
});

test('a file picked after the limits request failed retries it once', async () => {
  let attempts = 0;
  answerUploadLimits = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new TypeError('Failed to fetch');
    }
    return limitsResponse(300);
  };
  const { result, showToast } = renderUploadHook();
  await waitFor(() => assert.equal(attempts, 1));
  assert.equal(result.current.maxUploadSizeLabel, '200MB');

  await act(() => result.current.uploadFiles([fileOfSize('big.bin', 250)]));

  assert.equal(RecordingXMLHttpRequest.sent.length, 1);
  assert.deepEqual(showToast.mock.calls, [['Uploaded 1 file successfully', 'success']]);
  assert.equal(result.current.maxUploadSizeLabel, '300MB');
  assert.deepEqual(requestedUrls(), [UPLOAD_LIMITS_URL, UPLOAD_LIMITS_URL]);
});

test('the 200 MB default stays in force when the server cannot report its limits', async () => {
  // An older server without the endpoint.
  answerUploadLimits = async () => new Response('Not found', { status: 404 });
  const { result, showToast } = renderUploadHook();

  await waitFor(() => assert.equal(fetchMock.mock.calls.length, 1));
  assert.equal(result.current.maxUploadSizeLabel, '200MB');
  await act(() => result.current.uploadFiles([fileOfSize('big.bin', 250)]));

  assert.equal(RecordingXMLHttpRequest.sent.length, 0);
  assert.deepEqual(showToast.mock.calls, [['big.bin is larger than 200MB.', 'error']]);
  // The one retry at upload time, then the default: no loop of requests.
  assert.equal(fetchMock.mock.calls.length, 2);
});

test('a malformed field from the server falls back to its default', async () => {
  answerUploadLimits = async () => limitsResponse(300, 'many');
  const { result, showToast } = renderUploadHook();

  // The size label switching to 300MB shows the response has been applied.
  await waitFor(() => assert.equal(result.current.maxUploadSizeLabel, '300MB'));
  await act(() => result.current.uploadFiles(
    Array.from({ length: 21 }, (_, index) => fileOfSize(`file-${index}.bin`, 1)),
  ));

  assert.equal(RecordingXMLHttpRequest.sent.length, 0);
  assert.deepEqual(showToast.mock.calls, [['You can upload up to 20 files at once.', 'error']]);
});
