import { AppError } from '@/shared/utils.js';

const MAX_PAGES = 5;
const PAGE_SIZE = 100;
const CACHE_TTL_MS = 3 * 60 * 1000;
// One entry per (user, stored token) pair, each holding up to MAX_PAGES *
// PAGE_SIZE summaries. The cap is far above any realistic self-hosted install
// and only exists so the map can't grow without limit.
const MAX_CACHE_ENTRIES = 50;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export type GithubRepoSummary = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  cloneUrl: string;
  htmlUrl: string;
  description: string | null;
  updatedAt: string | null;
};

type OctokitInstance = InstanceType<typeof import('@octokit/rest').Octokit>;

type GithubServiceDependencies = {
  githubTokens: {
    getGithubTokenById(userId: number, tokenId: number): { github_token: string } | null;
  };
  GithubClient: typeof import('@octokit/rest').Octokit;
  /** Injectable clock so cache-TTL behavior is deterministic in tests. */
  now?: () => number;
};

type CacheEntry = { fetchedAt: number; repos: GithubRepoSummary[] };

function isOctokitStatusError(error: unknown): error is { status: number } {
  return typeof error === 'object' && error !== null
    && typeof (error as { status?: unknown }).status === 'number';
}

function responseHeader(error: unknown, name: string): string | undefined {
  const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers;
  const value = headers?.[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * GitHub answers 403 for several unrelated situations, only one of which means
 * the token is bad. Reporting them all as "invalid or expired" sends people off
 * to regenerate a token that was fine — so each cause gets its own message.
 */
function toGithubAppError(
  error: unknown,
  messages: { invalidToken: string; unreachable: string },
): AppError {
  if (!isOctokitStatusError(error)) {
    return new AppError(messages.unreachable, { code: 'GITHUB_API_ERROR', statusCode: 502 });
  }

  if (error.status === 401) {
    return new AppError(messages.invalidToken, { code: 'GITHUB_TOKEN_INVALID', statusCode: 401 });
  }

  if (error.status === 403) {
    // A spent quota is reported as 403 with the remaining count at zero, or
    // with retry-after on a secondary limit.
    if (responseHeader(error, 'x-ratelimit-remaining') === '0' || responseHeader(error, 'retry-after')) {
      const resetAt = responseHeader(error, 'x-ratelimit-reset');
      return new AppError(
        'GitHub rate limit reached. Wait for the limit to reset and try again.',
        { code: 'GITHUB_RATE_LIMITED', statusCode: 429, details: resetAt ? { resetAt } : undefined },
      );
    }

    // Present only when a classic token has not been authorized for a
    // SAML-protected organization; the header carries the authorization URL.
    const ssoUrl = responseHeader(error, 'x-github-sso');
    if (ssoUrl) {
      return new AppError(
        'This token is not authorized for the organization’s SAML single sign-on.',
        { code: 'GITHUB_SSO_REQUIRED', statusCode: 403, details: { ssoUrl } },
      );
    }

    return new AppError(
      'This token is missing the permissions GitHub requires for this request.',
      { code: 'GITHUB_TOKEN_FORBIDDEN', statusCode: 403 },
    );
  }

  return new AppError(messages.unreachable, { code: 'GITHUB_API_ERROR', statusCode: 502 });
}

/** Creates GitHub repository search workflows around a stored token and an injected Octokit client. */
export function createGithubService(dependencies: GithubServiceDependencies) {
  const cache = new Map<string, CacheEntry>();
  const now = dependencies.now ?? (() => Date.now());

  async function fetchAccessibleRepos(octokit: OctokitInstance): Promise<GithubRepoSummary[]> {
    const repos: GithubRepoSummary[] = [];

    try {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { data } = await octokit.repos.listForAuthenticatedUser({
          affiliation: 'owner,collaborator,organization_member',
          sort: 'updated',
          per_page: PAGE_SIZE,
          page,
        });

        repos.push(...data.map((repo) => ({
          id: repo.id,
          fullName: repo.full_name,
          name: repo.name,
          owner: repo.owner?.login ?? '',
          private: repo.private,
          cloneUrl: repo.clone_url,
          htmlUrl: repo.html_url,
          description: repo.description,
          updatedAt: repo.updated_at,
        })));

        if (data.length < PAGE_SIZE) {
          break;
        }
      }
    } catch (error) {
      throw toGithubAppError(error, {
        invalidToken: 'GitHub token is invalid or expired',
        unreachable: 'Failed to reach GitHub',
      });
    }

    return repos;
  }

  /**
   * The TTL stops a stale entry being *read*, but nothing dropped it, so a
   * token used once held its repositories for the life of the process. Expired
   * entries are cleared on each write, and the oldest are evicted if the map
   * still exceeds its cap.
   */
  function rememberRepos(cacheKey: string, repos: GithubRepoSummary[]): void {
    const currentTime = now();

    for (const [key, entry] of cache) {
      if (currentTime - entry.fetchedAt >= CACHE_TTL_MS) {
        cache.delete(key);
      }
    }

    // Delete first so the re-insert moves the key to the end: Map iterates in
    // insertion order, which makes the eviction below least-recently-written.
    cache.delete(cacheKey);
    cache.set(cacheKey, { fetchedAt: currentTime, repos });

    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      cache.delete(oldestKey);
    }
  }

  async function getAccessibleRepos(userId: number, tokenId: number): Promise<GithubRepoSummary[]> {
    const tokenRow = dependencies.githubTokens.getGithubTokenById(userId, tokenId);
    if (!tokenRow) {
      throw new AppError('GitHub token not found', { code: 'GITHUB_TOKEN_NOT_FOUND', statusCode: 404 });
    }

    const cacheKey = `${userId}:${tokenId}`;
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.repos;
    }

    const octokit = new dependencies.GithubClient({ auth: tokenRow.github_token });
    const repos = await fetchAccessibleRepos(octokit);
    rememberRepos(cacheKey, repos);
    return repos;
  }

  return {
    /**
     * Checks a raw token against GitHub before it is stored, so an expired or
     * mistyped token is rejected at entry instead of silently producing an
     * empty repository list later.
     *
     * Returns the account the token belongs to, which also lets the user
     * confirm they pasted the token they meant to.
     */
    async verifyToken(token: string): Promise<{ login: string; scopes: string[] }> {
      const trimmedToken = token.trim();
      if (!trimmedToken) {
        throw new AppError('A GitHub token is required', {
          code: 'GITHUB_TOKEN_REQUIRED',
          statusCode: 400,
        });
      }

      const octokit = new dependencies.GithubClient({ auth: trimmedToken });

      try {
        const { data, headers } = await octokit.users.getAuthenticated();
        // GitHub reports granted scopes in a response header; fine-grained
        // tokens omit it entirely, so an absent header is not an error.
        const scopeHeader = headers['x-oauth-scopes'];
        const scopes = typeof scopeHeader === 'string' && scopeHeader.trim()
          ? scopeHeader.split(',').map((scope) => scope.trim()).filter(Boolean)
          : [];

        return { login: data.login, scopes };
      } catch (error) {
        throw toGithubAppError(error, {
          invalidToken: 'GitHub rejected this token. Check it has not expired or been revoked.',
          unreachable: 'Could not reach GitHub to verify the token',
        });
      }
    },

    /**
     * Returns the caller's accessible repositories (owner + collaborator +
     * organization-member affiliation), filtered by substring match on the
     * full "owner/repo" name. An empty query returns the most recently
     * updated repositories so the client can show a "recent repos" list
     * before the user has typed anything.
     */
    async searchRepositories(
      userId: number,
      tokenId: number,
      query: string,
      limit: number = DEFAULT_LIMIT,
    ): Promise<{ repos: GithubRepoSummary[] }> {
      const repos = await getAccessibleRepos(userId, tokenId);
      const normalizedQuery = query.trim().toLowerCase();
      const filtered = normalizedQuery
        ? repos.filter((repo) => repo.fullName.toLowerCase().includes(normalizedQuery))
        : repos;

      const boundedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
      return { repos: filtered.slice(0, boundedLimit) };
    },
  };
}
