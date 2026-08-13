import { Octokit } from '@octokit/rest';

import { githubTokensDb } from '@/modules/database/index.js';

import { createGithubRouter } from './github.routes.js';
import { createGithubService } from './github.service.js';

const githubService = createGithubService({
  githubTokens: {
    getGithubTokenById: (userId, tokenId) => githubTokensDb.getGithubTokenById(userId, tokenId),
  },
  GithubClient: Octokit,
});

/** GitHub router assembled for the authenticated server mount. */
export const githubRoutes = createGithubRouter(githubService);
