import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type RequestHandler } from 'express';

import { createFileTreeRouter, createFileTreeUploadMiddleware } from '@/modules/file-tree/file-tree.routes.js';
import type { FileTreeServices } from '@/shared/types.js';

function createFakeServices(overrides: Partial<FileTreeServices> = {}): FileTreeServices {
  const unexpectedOperation = async (): Promise<never> => {
    throw new Error('Unexpected File Tree service call');
  };

  return {
    browseWorkspace: unexpectedOperation,
    createWorkspaceFolder: unexpectedOperation,
    readTextFile: unexpectedOperation,
    openFile: unexpectedOperation,
    saveTextFile: unexpectedOperation,
    listProjectFiles: unexpectedOperation,
    createEntry: unexpectedOperation,
    renameEntry: unexpectedOperation,
    deleteEntry: unexpectedOperation,
    storeUploadedFiles: unexpectedOperation,
    ...overrides,
  };
}

const passUploadRequest: RequestHandler = (_request, _response, next) => next();

const uploadLimits = { maximumFileSizeMegabytes: 200, maximumFileCount: 20 };

async function withFileTreeServer(
  services: FileTreeServices,
  run: (baseUrl: string) => Promise<void>,
  uploadMiddleware: RequestHandler = passUploadRequest,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/file-tree', createFileTreeRouter(
    services,
    uploadMiddleware,
    uploadLimits,
    { error: () => undefined },
  ));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('project files route uses the File Tree API namespace and forwards the project id', async () => {
  const inputs: Parameters<FileTreeServices['listProjectFiles']>[] = [];
  const services = createFakeServices({
    listProjectFiles: async (...input) => {
      inputs.push(input);
      return [];
    },
  });

  await withFileTreeServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });

  assert.deepEqual(inputs, [['project-1', { respectGitignore: false }]]);
});

test('project files route requests gitignore filtering when explicitly enabled', async () => {
  const inputs: Parameters<FileTreeServices['listProjectFiles']>[] = [];
  const services = createFakeServices({
    listProjectFiles: async (...input) => {
      inputs.push(input);
      return [];
    },
  });

  await withFileTreeServer(services, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/file-tree/projects/project-1/files?respectGitignore=true`,
    );

    assert.equal(response.status, 200);
  });

  assert.deepEqual(inputs, [['project-1', { respectGitignore: true }]]);
});

test('create route parses the transport payload before invoking the service', async () => {
  const inputs: Parameters<FileTreeServices['createEntry']>[0][] = [];
  const services = createFakeServices({
    createEntry: async (input) => {
      inputs.push(input);
      return {
        success: true,
        path: '/workspace/project/src/example.ts',
        name: input.name,
        type: input.type,
        message: 'File created successfully',
      };
    },
  });

  await withFileTreeServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/project/src',
        type: 'file',
        name: 'example.ts',
      }),
    });

    assert.equal(response.status, 200);
  });

  assert.deepEqual(inputs, [{
    projectId: 'project-1',
    parentPath: '/workspace/project/src',
    type: 'file',
    name: 'example.ts',
  }]);
});

test('create route rejects invalid entry types without calling the service', async () => {
  let createCalled = false;
  const services = createFakeServices({
    createEntry: async () => {
      createCalled = true;
      throw new Error('createEntry should not run for invalid input');
    },
  });

  await withFileTreeServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'link', name: 'example' }),
    });
    const payload = await response.json() as { error: string };

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Type must be "file" or "directory"');
  });

  assert.equal(createCalled, false);
});

test('upload route keeps non-ASCII original filenames intact through the real multipart parser', async () => {
  const originalName = '개인정보 처리방침 안내서.txt';
  const inputs: Parameters<FileTreeServices['storeUploadedFiles']>[0][] = [];
  const services = createFakeServices({
    storeUploadedFiles: async (input) => {
      inputs.push(input);
      await Promise.all(input.files.map((file) => fs.rm(file.temporaryPath, { force: true })));
      return {
        success: true,
        files: input.files.map((file) => ({
          name: file.originalName,
          path: `${input.targetPath}/${file.originalName}`,
          size: file.size,
          mimeType: file.mimeType,
        })),
        uploadedCount: input.files.length,
        requestedFileCount: input.requestedFileCount,
        targetPath: input.targetPath,
        message: 'ok',
      };
    },
  });

  await withFileTreeServer(services, async (baseUrl) => {
    const form = new FormData();
    form.append('targetPath', 'docs');
    form.append('files', new Blob(['hello'], { type: 'text/plain' }), originalName);

    const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files/upload`, {
      method: 'POST',
      body: form,
    });

    assert.equal(response.status, 200);
  }, createFileTreeUploadMiddleware(uploadLimits));

  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].files.length, 1);
  assert.equal(inputs[0].files[0].originalName, originalName);
  assert.equal(inputs[0].targetPath, 'docs');
});
