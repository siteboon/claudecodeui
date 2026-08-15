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

function makeVerifyClient(result: { login?: string; scopes?: string; status?: number }) {
  return class {
    users: { getAuthenticated: () => Promise<{ data: { login: string }; headers: Record<string, string> }> };

    constructor(_options: { auth: string }) {
      this.users = {
        getAuthenticated: async () => {
          if (result.status) {
            throw Object.assign(new Error('github error'), { status: result.status });
          }
          const headers: Record<string, string> = {};
          if (result.scopes !== undefined) {
            headers['x-oauth-scopes'] = result.scopes;
          }
          return { data: { login: result.login ?? 'octocat' }, headers };
        },
      };
    }
  } as unknown as Dependencies['GithubClient'];
}

test('verifyToken returns the authenticated account and its scopes', async () => {
  const service = createGithubService({
    githubTokens: { getGithubTokenById: () => null },
    GithubClient: makeVerifyClient({ login: 'Tourniercy', scopes: 'repo, read:org' }),
  });

  assert.deepEqual(await service.verifyToken('ghp_valid'), {
    login: 'Tourniercy',
    scopes: ['repo', 'read:org'],
  });
});

test('verifyToken tolerates fine-grained tokens that report no scopes header', async () => {
  const service = createGithubService({
    githubTokens: { getGithubTokenById: () => null },
    GithubClient: makeVerifyClient({ login: 'octocat' }),
  });

  assert.deepEqual(await service.verifyToken('github_pat_x'), { login: 'octocat', scopes: [] });
});

test('verifyToken rejects a blank token without calling GitHub', async () => {
  let constructed = false;
  const service = createGithubService({
    githubTokens: { getGithubTokenById: () => null },
    GithubClient: class {
      constructor() { constructed = true; }
    } as unknown as Dependencies['GithubClient'],
  });

  await assert.rejects(() => service.verifyToken('   '), /token is required/i);
  assert.equal(constructed, false);
});

test('verifyToken surfaces a rejected token as an invalid-token error', async () => {
  const service = createGithubService({
    githubTokens: { getGithubTokenById: () => null },
    GithubClient: makeVerifyClient({ status: 401 }),
  });

  await assert.rejects(() => service.verifyToken('ghp_revoked'), /GitHub rejected this token/);
});

test('verifyToken reports an unreachable GitHub separately from a bad token', async () => {
  const service = createGithubService({
    githubTokens: { getGithubTokenById: () => null },
    GithubClient: makeVerifyClient({ status: 500 }),
  });

  await assert.rejects(() => service.verifyToken('ghp_valid'), /Could not reach GitHub/);
});

function makeFailingClient(status: number, headers: Record<string, string> = {}) {
  return class {
    repos = {
      listForAuthenticatedUser: async () => {
        throw Object.assign(new Error('github error'), { status, response: { headers } });
      },
    };
  } as unknown as Dependencies['GithubClient'];
}

test('searchRepositories reports a spent rate limit separately from a bad token', async () => {
  const service = createGithubService(dependencies({
    GithubClient: makeFailingClient(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1760000000' }),
  }));

  await assert.rejects(
    () => service.searchRepositories(1, 1, ''),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GITHUB_RATE_LIMITED');
      assert.equal((error as { statusCode?: number }).statusCode, 429);
      assert.deepEqual((error as { details?: unknown }).details, { resetAt: '1760000000' });
      return true;
    },
  );
});

test('searchRepositories reports a secondary rate limit signalled by retry-after', async () => {
  const service = createGithubService(dependencies({
    GithubClient: makeFailingClient(403, { 'retry-after': '60' }),
  }));

  await assert.rejects(
    () => service.searchRepositories(1, 1, ''),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GITHUB_RATE_LIMITED');
      return true;
    },
  );
});

test('searchRepositories reports a SAML SSO authorization requirement with its URL', async () => {
  const service = createGithubService(dependencies({
    GithubClient: makeFailingClient(403, { 'x-github-sso': 'https://github.com/orgs/acme/sso?authorization_request=x' }),
  }));

  await assert.rejects(
    () => service.searchRepositories(1, 1, ''),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GITHUB_SSO_REQUIRED');
      assert.equal((error as { statusCode?: number }).statusCode, 403);
      return true;
    },
  );
});

test('searchRepositories reports a plain 403 as missing permissions, not an invalid token', async () => {
  const service = createGithubService(dependencies({
    GithubClient: makeFailingClient(403),
  }));

  await assert.rejects(
    () => service.searchRepositories(1, 1, ''),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GITHUB_TOKEN_FORBIDDEN');
      assert.equal((error as { statusCode?: number }).statusCode, 403);
      return true;
    },
  );
});

test('verifyToken distinguishes a rate limit from a rejected token', async () => {
  const client = class {
    users = {
      getAuthenticated: async () => {
        throw Object.assign(new Error('github error'), {
          status: 403,
          response: { headers: { 'x-ratelimit-remaining': '0' } },
        });
      },
    };
  } as unknown as Dependencies['GithubClient'];

  const service = createGithubService({
    githubTokens: { getGithubTokenById: () => null },
    GithubClient: client,
  });

  await assert.rejects(() => service.verifyToken('ghp_fine'), /rate limit/i);
});

test('getAccessibleRepos drops cache entries once their TTL has passed', async () => {
  let fetchCount = 0;
  const client = class {
    repos = {
      listForAuthenticatedUser: async () => {
        fetchCount += 1;
        return { data: [makeRepo()] };
      },
    };
  } as unknown as Dependencies['GithubClient'];

  let currentTime = 0;
  const service = createGithubService(dependencies({ GithubClient: client, now: () => currentTime }));

  await service.searchRepositories(1, 1, '');
  assert.equal(fetchCount, 1);

  // A second token expires the first entry on write; the first token must then
  // re-fetch rather than serve a retained-but-stale list.
  currentTime += 4 * 60 * 1000;
  await service.searchRepositories(1, 2, '');
  assert.equal(fetchCount, 2);

  await service.searchRepositories(1, 1, '');
  assert.equal(fetchCount, 3, 'the expired entry should have been evicted, forcing a refetch');
});
