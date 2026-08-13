import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createGithubRouter } from '../github.routes.js';
import type { GithubRepoSummary } from '../github.service.js';

type GithubService = Parameters<typeof createGithubRouter>[0];

function fakeService(overrides: Partial<GithubService> = {}): GithubService {
  return {
    searchRepositories: async () => ({ repos: [] }),
    ...overrides,
  };
}

async function withGithubServer(
  service: GithubService,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { user?: { id: number } }).user = { id: 1 };
    next();
  });
  app.use('/api/github', createGithubRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET /repos rejects a missing tokenId before calling the service', async () => {
  let called = false;
  await withGithubServer(fakeService({
    searchRepositories: async () => { called = true; return { repos: [] }; },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/github/repos`);
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});

test('GET /repos returns the service result with the parsed query params', async () => {
  const receivedArgs: unknown[] = [];
  await withGithubServer(fakeService({
    searchRepositories: async (userId, tokenId, query, limit) => {
      receivedArgs.push([userId, tokenId, query, limit]);
      const repos: GithubRepoSummary[] = [{
        id: 1,
        fullName: 'octo-org/octo-repo',
        name: 'octo-repo',
        owner: 'octo-org',
        private: false,
        cloneUrl: 'https://github.com/octo-org/octo-repo.git',
        htmlUrl: 'https://github.com/octo-org/octo-repo',
        description: null,
        updatedAt: '2026-01-01T00:00:00Z',
      }];
      return { repos };
    },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/github/repos?tokenId=42&q=octo&limit=10`);
    const body = await response.json() as { repos: Array<{ fullName: string }> };

    assert.equal(response.status, 200);
    assert.equal(body.repos[0]?.fullName, 'octo-org/octo-repo');
    assert.deepEqual(receivedArgs, [[1, 42, 'octo', 10]]);
  });
});
