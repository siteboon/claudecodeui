import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';
import multer from 'multer';

import { createFileTreeRouter } from '@/modules/file-tree/file-tree.routes.js';
import type { FileTreeServices } from '@/shared/types.js';

type StoreUploadedFilesInput = Parameters<FileTreeServices['storeUploadedFiles']>[0];

/**
 * Posts one browser-style multipart upload (raw UTF-8 filename) through the
 * File Tree router with a real multer parser and returns what the route passed
 * to the upload service.
 */
async function captureUploadInput(fileName: string, relativePaths?: string[]): Promise<StoreUploadedFilesInput> {
  let capturedInput: StoreUploadedFilesInput | null = null;
  const unexpectedOperation = async (): Promise<never> => {
    throw new Error('Unexpected File Tree service call');
  };
  const services: FileTreeServices = {
    browseWorkspace: unexpectedOperation,
    createWorkspaceFolder: unexpectedOperation,
    readTextFile: unexpectedOperation,
    openFile: unexpectedOperation,
    saveTextFile: unexpectedOperation,
    listProjectFiles: unexpectedOperation,
    createEntry: unexpectedOperation,
    renameEntry: unexpectedOperation,
    deleteEntry: unexpectedOperation,
    storeUploadedFiles: async (input) => {
      capturedInput = input;
      return {
        success: true,
        files: [],
        uploadedCount: 0,
        requestedFileCount: input.requestedFileCount,
        targetPath: '/project',
        message: 'Uploaded 0 files successfully',
      };
    },
  };

  const app = express();
  app.use('/api/file-tree', createFileTreeRouter(
    services,
    multer({ storage: multer.memoryStorage() }).array('files', 20),
    { maximumFileSizeMegabytes: 200, maximumFileCount: 20 },
    { error: () => undefined },
  ));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const form = new FormData();
    form.append('targetPath', 'uploads');
    if (relativePaths) {
      form.append('relativePaths', JSON.stringify(relativePaths));
    }
    form.append('files', new Blob([Buffer.from('body')]), fileName);
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/file-tree/projects/project-1/files/upload`, {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert.ok(capturedInput, 'the upload service was not called');
  return capturedInput;
}

test('upload route decodes the multipart filename the service falls back to', async () => {
  const input = await captureUploadInput('Счет-фактура № 1 от 31.07.2026.docx');

  assert.deepEqual(input.relativePaths, []);
  assert.equal(input.files[0].originalName, 'Счет-фактура № 1 от 31.07.2026.docx');
});

test('upload route keeps relative paths, which arrive as UTF-8 text fields', async () => {
  const input = await captureUploadInput('日本語.txt', ['資料/日本語.txt']);

  assert.deepEqual(input.relativePaths, ['資料/日本語.txt']);
  assert.equal(input.files[0].originalName, '日本語.txt');
});
