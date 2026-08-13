import assert from 'node:assert/strict';
import test from 'node:test';

import { createGithubService } from '../github.service.js';

type Dependencies = Parameters<typeof createGithubService>[0];

function makeRepo(overrides: Partial<{
  id: number;
  full_name: string;
  name: string;
  owner: { login: string } | null;
  private: boolean;
  updated_at: string | null;
}> = {}) {
  const fullName = overrides.full_name ?? 'octo-org/octo-repo';
  return {
    id: overrides.id ?? 1,
    full_name: fullName,
    name: overrides.name ?? fullName.split('/')[1],
    owner: overrides.owner === undefined ? { login: fullName.split('/')[0] } : overrides.owner,
    private: overrides.private ?? false,
    clone_url: `https://github.com/${fullName}.git`,
    html_url: `https://github.com/${fullName}`,
    description: null,
    updated_at: overrides.updated_at === undefined ? '2026-01-01T00:00:00Z' : overrides.updated_at,
  };
}

function makeGithubClient(pages: ReturnType<typeof makeRepo>[][]) {
  const calls: unknown[] = [];
  return class {
    auth: string;
    repos: { listForAuthenticatedUser: (params: unknown) => Promise<{ data: ReturnType<typeof makeRepo>[] }> };

    constructor(options: { auth: string }) {
      this.auth = options.auth;
      this.repos = {
        listForAuthenticatedUser: async (params: unknown) => {
          calls.push(params);
          const page = (params as { page: number }).page;
          return { data: pages[page - 1] ?? [] };
        },
      };
    }

    static calls = calls;
  } as unknown as Dependencies['GithubClient'];
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    githubTokens: { getGithubTokenById: () => ({ github_token: 'token-value' }) },
    GithubClient: makeGithubClient([[makeRepo()]]),
    ...overrides,
  };
}

test('searchRepositories throws when the stored token cannot be found', async () => {
  const service = createGithubService(dependencies({
    githubTokens: { getGithubTokenById: () => null },
  }));

  await assert.rejects(
    () => service.searchRepositories(1, 999, ''),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GITHUB_TOKEN_NOT_FOUND');
      assert.equal((error as { statusCode?: number }).statusCode, 404);
      return true;
    },
  );
});

test('searchRepositories filters accessible repos by case-insensitive substring on full name', async () => {
  const service = createGithubService(dependencies({
    GithubClient: makeGithubClient([[
      makeRepo({ id: 1, full_name: 'octo-org/api-server' }),
      makeRepo({ id: 2, full_name: 'octo-org/web-client' }),
    ]]),
  }));

  const { repos } = await service.searchRepositories(1, 1, 'API');
  assert.equal(repos.length, 1);
  assert.equal(repos[0]?.fullName, 'octo-org/api-server');
});

test('searchRepositories returns the recency-sorted list unfiltered for an empty query', async () => {
  const service = createGithubService(dependencies({
    GithubClient: makeGithubClient([[
      makeRepo({ id: 1, full_name: 'octo-org/api-server' }),
      makeRepo({ id: 2, full_name: 'octo-org/web-client' }),
    ]]),
  }));

  const { repos } = await service.searchRepositories(1, 1, '');
  assert.equal(repos.length, 2);
});

test('searchRepositories stops paginating at the page cap', async () => {
  const fullPage = Array.from({ length: 100 }, (_, index) => makeRepo({
    id: index + 1,
    full_name: `octo-org/repo-${index + 1}`,
  }));
  let fetchedPageCount = 0;
  const client = class {
    repos = {
      listForAuthenticatedUser: async () => {
        fetchedPageCount += 1;
        return { data: fullPage };
      },
    };
  } as unknown as Dependencies['GithubClient'];
  const service = createGithubService(dependencies({ GithubClient: client }));

  // Every page is "full" (100 rows), so without a cap this would page forever.
  await service.searchRepositories(1, 1, '', 50);
  assert.equal(fetchedPageCount, 5, 'should stop at MAX_PAGES instead of paging indefinitely');
});

test('searchRepositories caches accessible repos within the TTL window', async () => {
  let fetchCount = 0;
  const client = class {
    repos = {
      listForAuthenticatedUser: async () => {
        fetchCount += 1;
        return { data: fetchCount === 1 ? [makeRepo()] : [makeRepo({ id: 2, full_name: 'octo-org/second' })] };
      },
    };
  } as unknown as Dependencies['GithubClient'];

  let currentTime = 0;
  const service = createGithubService(dependencies({
    GithubClient: client,
    now: () => currentTime,
  }));

  await service.searchRepositories(1, 1, '');
  assert.equal(fetchCount, 1);

  currentTime += 60 * 1000; // 1 minute later, still within the 3 minute TTL
  await service.searchRepositories(1, 1, '');
  assert.equal(fetchCount, 1);

  currentTime += 3 * 60 * 1000; // past the TTL
  await service.searchRepositories(1, 1, '');
  assert.equal(fetchCount, 2);
});

test('searchRepositories surfaces an invalid token as a 401 AppError', async () => {
  const client = class {
    repos = {
      listForAuthenticatedUser: async () => {
        const error = new Error('Bad credentials') as Error & { status: number };
        error.status = 401;
        throw error;
      },
    };
  } as unknown as Dependencies['GithubClient'];

  const service = createGithubService(dependencies({ GithubClient: client }));

  await assert.rejects(
    () => service.searchRepositories(1, 1, ''),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GITHUB_TOKEN_INVALID');
      assert.equal((error as { statusCode?: number }).statusCode, 401);
      return true;
    },
  );
});

test('searchRepositories surfaces other upstream failures as a 502 AppError', async () => {
  const client = class {
    repos = {
      listForAuthenticatedUser: async () => {
        throw new Error('network down');
      },
    };
  } as unknown as Dependencies['GithubClient'];

  const service = createGithubService(dependencies({ GithubClient: client }));

  await assert.rejects(
    () => service.searchRepositories(1, 1, ''),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GITHUB_API_ERROR');
      assert.equal((error as { statusCode?: number }).statusCode, 502);
      return true;
    },
  );
});
