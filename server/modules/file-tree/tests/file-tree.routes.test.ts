import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import express, { type RequestHandler } from 'express';

import { createFileDownloadRouter } from '@/modules/file-tree/file-tree.download.routes.js';
import { createFileTreeRouter } from '@/modules/file-tree/file-tree.routes.js';
import type { DownloadClaim, FileTreeServices } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

function createFakeServices(overrides: Partial<FileTreeServices> = {}): FileTreeServices {
  const unexpectedOperation = async (): Promise<never> => {
    throw new Error('Unexpected File Tree service call');
  };

  return {
    browseWorkspace: unexpectedOperation,
    createWorkspaceFolder: unexpectedOperation,
    readTextFile: unexpectedOperation,
    openFile: unexpectedOperation,
    resolveDownloadTarget: unexpectedOperation,
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

async function withServer(
  configure: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  configure(app);

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

async function withFileTreeServer(
  services: FileTreeServices,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  await withServer((app) => {
    app.use('/api/file-tree', createFileTreeRouter(
      services,
      passUploadRequest,
      { maximumFileSizeMegabytes: 200, maximumFileCount: 20 },
      { error: () => undefined },
      (_user, target) => `token-for:${target.projectId}:${target.path}`,
    ));
  }, run);
}

/**
 * Mounts the download router behind a stub of the capability-token middleware so
 * the route contract is tested without signing real JWTs.
 */
async function withDownloadServer(
  services: FileTreeServices,
  claim: DownloadClaim,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  await withServer((app) => {
    app.use('/api/download', (request, _response, next) => {
      (request as express.Request & { downloadClaim?: DownloadClaim }).downloadClaim = claim;
      next();
    }, createFileDownloadRouter(services, { error: () => undefined }));
  }, run);
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

test('download ticket route resolves the target and returns a scoped token', async () => {
  const inputs: Parameters<FileTreeServices['resolveDownloadTarget']>[] = [];
  const services = createFakeServices({
    resolveDownloadTarget: async (...input) => {
      inputs.push(input);
      return { path: '/workspace/project/отчёт 2026.pdf', name: 'отчёт 2026.pdf', size: 1234 };
    },
  });

  await withFileTreeServer(services, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/file-tree/projects/project-1/files/download-ticket`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'отчёт 2026.pdf' }),
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      token: 'token-for:project-1:отчёт 2026.pdf',
      name: 'отчёт 2026.pdf',
      size: 1234,
    });
  });

  assert.deepEqual(inputs, [['project-1', 'отчёт 2026.pdf']]);
});

test('download ticket route surfaces a missing file as 404 before any download starts', async () => {
  const services = createFakeServices({
    resolveDownloadTarget: async () => {
      throw new AppError('File not found', { code: 'FILE_NOT_FOUND', statusCode: 404 });
    },
  });

  await withFileTreeServer(services, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/file-tree/projects/project-1/files/download-ticket`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'gone.txt' }),
      },
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'File not found' });
  });
});

test('download ticket route rejects a missing path without calling the service', async () => {
  let resolveCalled = false;
  const services = createFakeServices({
    resolveDownloadTarget: async () => {
      resolveCalled = true;
      throw new Error('resolveDownloadTarget should not run for invalid input');
    },
  });

  await withFileTreeServer(services, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/file-tree/projects/project-1/files/download-ticket`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid file path' });
  });

  assert.equal(resolveCalled, false);
});

test('download route serves the claimed file as an attachment with its own name', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'file-tree-download-'));
  const filePath = path.join(temporaryDirectory, 'stored-name.bin');
  await fs.writeFile(filePath, 'download me');

  const inputs: Parameters<FileTreeServices['resolveDownloadTarget']>[] = [];
  const services = createFakeServices({
    resolveDownloadTarget: async (...input) => {
      inputs.push(input);
      return { path: filePath, name: 'отчёт 2026.pdf', size: 11 };
    },
  });

  try {
    await withDownloadServer(services, { projectId: 'project-1', path: 'nested/file.pdf' }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/download/file?t=stub`);
      const disposition = response.headers.get('content-disposition') ?? '';

      assert.equal(response.status, 200);
      assert.match(disposition, /^attachment;/);
      // Non-ASCII names must survive as RFC 5987, not be mangled or dropped.
      assert.match(disposition, /filename\*=UTF-8''/);
      assert.equal(await response.text(), 'download me');
    });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }

  // The path comes from the signed claim, never from the query string.
  assert.deepEqual(inputs, [['project-1', 'nested/file.pdf']]);
});

// Regression: `res.download` delegates to `send`, whose legacy dotfile rule
// answers 404 for any file whose name starts with a dot. Dotfiles are ordinary
// project files here, so downloading `.env` must return its bytes, not an error.
test('download route serves a dotfile instead of treating it as hidden', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'file-tree-dotfile-'));
  const filePath = path.join(temporaryDirectory, '.env');
  await fs.writeFile(filePath, 'SECRET=1');

  const services = createFakeServices({
    resolveDownloadTarget: async () => ({ path: filePath, name: '.env', size: 8 }),
  });

  try {
    await withDownloadServer(services, { projectId: 'project-1', path: '.env' }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/download/file?t=stub`);

      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-disposition') ?? '', /^attachment;/);
      assert.equal(await response.text(), 'SECRET=1');
    });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

/**
 * Mounts the download router with `res.download` replaced by a stub that sends
 * the head plus a first chunk and then reports a failure. The transfer itself
 * is Express's job; the branch that runs once it breaks after the headers are
 * already on the wire is ours, and a real mid-stream read failure cannot be
 * produced reliably from a test.
 */
async function withFailingTransferServer(
  failure: NodeJS.ErrnoException,
  errors: string[],
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const services = createFakeServices({
    resolveDownloadTarget: async () => ({ path: '/unused/partial.bin', name: 'partial.bin', size: 7 }),
  });

  await withServer((app) => {
    app.use('/api/download', (request, response, next) => {
      (request as express.Request & { downloadClaim?: DownloadClaim })
        .downloadClaim = { projectId: 'project-1', path: 'partial.bin' };

      response.download = ((
        _path: string,
        _name: string,
        _options: unknown,
        callback: (error?: NodeJS.ErrnoException) => void,
      ) => {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        response.write('partial');
        callback(failure);
        // Only reached when the route left the response alive.
        if (!response.destroyed) response.end();
        return response;
      }) as unknown as typeof response.download;

      next();
    }, createFileDownloadRouter(services, { error: (message) => { errors.push(message); } }));
  }, run);
}

test('download route answers 500 when the transfer fails before any header is sent', async () => {
  const errors: string[] = [];
  const services = createFakeServices({
    // The ticket was valid when it was issued; the file is gone by the time the
    // browser follows it, so `send` fails with ENOENT before writing a head.
    resolveDownloadTarget: async () => ({
      path: path.join(os.tmpdir(), 'file-tree-missing', 'gone.bin'),
      name: 'gone.bin',
      size: 4,
    }),
  });

  await withServer((app) => {
    app.use('/api/download', (request, _response, next) => {
      (request as express.Request & { downloadClaim?: DownloadClaim })
        .downloadClaim = { projectId: 'project-1', path: 'gone.bin' };
      next();
    }, createFileDownloadRouter(services, { error: (message) => { errors.push(message); } }));
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/download/file?t=stub`);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Error reading file' });
  });

  assert.deepEqual(errors, ['Error sending File Tree download']);
});

test('download route breaks the connection when the transfer fails after the headers', async () => {
  const errors: string[] = [];
  const failure: NodeJS.ErrnoException = Object.assign(new Error('read failed'), { code: 'EIO' });

  await withFailingTransferServer(failure, errors, async (baseUrl) => {
    // Content-Length is already promised, so a truncated body the client
    // accepts would be a silently corrupt file. The aborted connection is what
    // makes the browser mark the download failed instead of saving it.
    await assert.rejects(async () => {
      const response = await fetch(`${baseUrl}/api/download/file?t=stub`);
      await response.text();
    });
  });

  assert.deepEqual(errors, ['File Tree download failed after headers were sent']);
});

test('download route stays silent when the client cancels the download', async () => {
  const errors: string[] = [];
  // What Express reports when the browser's own cancel button hangs up.
  const abort: NodeJS.ErrnoException = Object.assign(new Error('aborted'), { code: 'ECONNABORTED' });

  await withFailingTransferServer(abort, errors, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/download/file?t=stub`);

    assert.equal(response.status, 200);
    // The route left the response alone, so the stub could close it normally.
    assert.equal(await response.text(), 'partial');
  });

  // Cancelling a download is the headline feature of this route, not a fault:
  // it must not fill the server log with errors.
  assert.deepEqual(errors, []);
});

test('inline content route never sends Content-Disposition', async () => {
  const services = createFakeServices({
    openFile: async () => ({
      contentType: 'image/png',
      stream: Readable.from([Buffer.from('png-bytes')]),
    }),
  });

  await withFileTreeServer(services, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/file-tree/projects/project-1/files/content?path=logo.png`,
    );

    assert.equal(response.status, 200);
    // Pins the split this change is built on: `/files/content` stays the inline
    // route and downloading lives on its own endpoint. It catches an
    // `res.download` wired to the wrong route, which would attach a
    // Content-Disposition to every preview response the app serves.
    assert.equal(response.headers.get('content-disposition'), null);
    assert.equal(response.headers.get('content-type'), 'image/png');
  });
});
