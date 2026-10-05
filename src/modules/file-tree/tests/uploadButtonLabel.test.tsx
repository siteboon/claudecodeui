import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import FileTree from '@/modules/file-tree/FileTree';
import type { Project } from '@/shared/types';

/**
 * The upload button's tooltip and accessible name state the per-file cap. It has
 * to be the cap the server reported, carried from the upload hook through
 * FileTree into the header, not a number baked into the prebuilt bundle.
 */

const project: Project = { projectId: 'p1', displayName: 'repo', fullPath: '/repo', path: '/repo' };

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/file-tree/upload-limits') {
      return jsonResponse({ maximumFileSizeMegabytes: 300, maximumFileCount: 20 });
    }
    if (url.startsWith('/api/file-tree/projects/p1/files')) {
      return jsonResponse([]);
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the upload button names the per-file limit the server reports', async () => {
  render(<FileTree selectedProject={project} />);

  const uploadButton = await screen.findByRole('button', { name: 'Upload files (max 300MB each)' });
  assert.equal(uploadButton.getAttribute('title'), 'Upload files (max 300MB each)');
});
