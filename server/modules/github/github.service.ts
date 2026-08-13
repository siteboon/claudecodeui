import { AppError } from '@/shared/utils.js';

const MAX_PAGES = 5;
const PAGE_SIZE = 100;
const CACHE_TTL_MS = 3 * 60 * 1000;
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
      if (isOctokitStatusError(error) && (error.status === 401 || error.status === 403)) {
        throw new AppError('GitHub token is invalid or expired', {
          code: 'GITHUB_TOKEN_INVALID',
          statusCode: 401,
        });
      }

      throw new AppError('Failed to reach GitHub', { code: 'GITHUB_API_ERROR', statusCode: 502 });
    }

    return repos;
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
    cache.set(cacheKey, { fetchedAt: now(), repos });
    return repos;
  }

  return {
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
