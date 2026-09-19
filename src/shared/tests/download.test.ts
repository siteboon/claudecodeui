import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { triggerBlobDownload, triggerDownload } from '@/shared/download';

/**
 * Regression guard for the revoke race: a blob URL revoked in the same tick as
 * the anchor click is sometimes gone before the download manager reads it, and
 * the download silently never starts. Four call sites used to do exactly that.
 */

const created: string[] = [];
const revoked: string[] = [];
const clicked: HTMLAnchorElement[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  clicked.length = 0;

  vi.useFakeTimers();
  // jsdom implements neither, and the point of the test is who calls them when.
  URL.createObjectURL = () => {
    const blobUrl = `blob:http://localhost/${created.length}`;
    created.push(blobUrl);
    return blobUrl;
  };
  URL.revokeObjectURL = (blobUrl: string) => {
    revoked.push(blobUrl);
  };
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

test('a blob download outlives its click before the URL is revoked', () => {
  triggerBlobDownload(new Blob(['report']), 'report.txt');

  assert.equal(clicked.length, 1);
  assert.equal(clicked[0].getAttribute('href'), created[0]);
  assert.equal(clicked[0].getAttribute('download'), 'report.txt');
  // The whole point: nothing is revoked while the click is still being handled.
  assert.deepEqual(revoked, []);

  vi.runAllTimers();

  assert.deepEqual(revoked, created);
});

test('a blob download leaves no anchor behind in the document', () => {
  triggerBlobDownload(new Blob(['report']), 'report.txt');

  assert.equal(document.body.contains(clicked[0]), false);
});

test('a native download navigates to the URL without creating a blob', () => {
  triggerDownload('/api/download/file?t=ticket', 'отчёт 2026.pdf');

  assert.deepEqual(created, []);
  assert.deepEqual(revoked, []);
  assert.equal(clicked.length, 1);
  assert.equal(clicked[0].getAttribute('href'), '/api/download/file?t=ticket');
  assert.equal(clicked[0].getAttribute('download'), 'отчёт 2026.pdf');
});

test('a native download without a name lets the server name the file', () => {
  triggerDownload('/api/download/file?t=ticket');

  // No `download` attribute, so the browser uses Content-Disposition instead.
  assert.equal(clicked[0].getAttribute('download'), null);
});
