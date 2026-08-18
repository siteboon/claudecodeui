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
    verifyToken: async () => ({ login: 'octocat', scopes: [] }),
    searchRepositories: async () => ({ repos: [] }),
    ...overrides,
  };
}

async function withGithubServer(
  service: GithubService,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
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

test('POST /verify-token returns the account the token belongs to', async () => {
  await withGithubServer(fakeService({
    verifyToken: async (token) => {
      assert.equal(token, 'ghp_secret');
      return { login: 'Tourniercy', scopes: ['repo'] };
    },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/github/verify-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'ghp_secret' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { login: 'Tourniercy', scopes: ['repo'] });
  });
});

test('POST /verify-token passes a missing token through to the service for rejection', async () => {
  let received: string | undefined;
  await withGithubServer(fakeService({
    verifyToken: async (token) => {
      received = token;
      return { login: 'octocat', scopes: [] };
    },
  }), async (baseUrl) => {
    await fetch(`${baseUrl}/api/github/verify-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  });

  assert.equal(received, '');
});

test('GET /repos rejects a fractional tokenId', async () => {
  let reached = false;
  await withGithubServer(fakeService({
    searchRepositories: async () => {
      reached = true;
      return { repos: [] };
    },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/github/repos?tokenId=1.5`);
    assert.equal(response.status, 400);
  });

  assert.equal(reached, false, 'a fractional tokenId should not reach the service');
});

test('GET /repos rejects a repeated tokenId', async () => {
  await withGithubServer(fakeService(), async (baseUrl) => {
    // Express turns a repeated parameter into an array, which Number() would
    // happily coerce when it holds a single element.
    const single = await fetch(`${baseUrl}/api/github/repos?tokenId=42&tokenId=43`);
    assert.equal(single.status, 400);
  });
});

test('GET /repos ignores a fractional limit instead of forwarding it', async () => {
  const received: (number | undefined)[] = [];
  await withGithubServer(fakeService({
    searchRepositories: async (_userId, _tokenId, _query, limit) => {
      received.push(limit);
      return { repos: [] };
    },
  }), async (baseUrl) => {
    await fetch(`${baseUrl}/api/github/repos?tokenId=1&limit=1.5`);
    await fetch(`${baseUrl}/api/github/repos?tokenId=1&limit=5`);
  });

  assert.deepEqual(received, [undefined, 5]);
});
