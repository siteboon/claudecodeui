import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { createImageGenerationRouter } from '@/modules/image-generation/image-generation.routes.js';
import { createProjectImageJobReader, ImageGenerationService } from '@/modules/image-generation/image-generation.service.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgSPkPAAHLAWRRDtICAAAAAElFTkSuQmCC', 'base64');

test('saved-job HTTP reads require authentication, resolve registered project scope, and cannot start generation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-image-routes-'));
  const firstProject = path.join(root, 'first');
  const secondProject = path.join(root, 'second');
  const data = path.join(root, 'private-state');
  await mkdir(firstProject);
  await mkdir(secondProject);
  let providerCalls = 0;
  const service = await ImageGenerationService.create({
    projectDirectory: firstProject, dataDirectory: data,
    provider: { identity: 'fixture-provider', generate: async () => { providerCalls++; return PNG; } },
  });
  const accepted = await service.submit({ requestId: 'http-fixture', prompt: 'Synthetic image' });
  const saved = await service.getJob(accepted.jobId, 20_000);
  const registered = new Map([['first-project', firstProject], ['second-project', secondProject]]);
  const reader = createProjectImageJobReader({
    getProjectPath: (id) => registered.get(id) ?? null,
    resolveReadablePath: async (projectPath) => projectPath,
    dataDirectory: data,
  });
  const deniedReader = createProjectImageJobReader({
    getProjectPath: (id) => registered.get(id) ?? null,
    resolveReadablePath: async () => null,
    dataDirectory: data,
  });
  await assert.rejects(deniedReader('first-project', saved.jobId), { code: 'PROJECT_NOT_FOUND' });
  const app = express();
  // The composition root mounts this factory behind authenticateToken. This
  // synthetic account guard keeps the route contract test independent of SQL.
  app.use('/api/image-generation', (request, response, next) => {
    if (request.headers.authorization !== 'Bearer synthetic-session') { response.status(401).json({ error: 'Authentication required' }); return; }
    next();
  }, createImageGenerationRouter(reader));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/image-generation/projects/';
    const resource = base + 'first-project/jobs/' + saved.jobId;
    assert.equal((await fetch(resource)).status, 401);
    const headers = { Authorization: 'Bearer synthetic-session' };
    const response = await fetch(resource, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), saved);
    assert.equal((await fetch(base + 'second-project/jobs/' + saved.jobId, { headers })).status, 404);
    assert.equal((await fetch(base + 'unknown-project/jobs/' + saved.jobId, { headers })).status, 404);
    assert.equal((await fetch(base + 'first-project/jobs/invalid-id', { headers })).status, 400);
    assert.equal((await fetch(resource, { method: 'POST', headers })).status, 404);
    assert.equal(providerCalls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('cloudcli-image-routes-'));
    await rm(root, { recursive: true, force: true });
  }
});
