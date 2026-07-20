import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';

import { Octokit } from '@octokit/rest';
import spawn from 'cross-spawn';

import {
  apiKeysDb,
  githubTokensDb,
  projectsDb,
  userDb,
} from '@/modules/database/index.js';
import { providerModelsService } from '@/modules/providers/index.js';

import { createAgentRouter } from './agent.routes.js';

type AgentExternalDependencies = Pick<
  Parameters<typeof createAgentRouter>[0],
  'queryClaude' | 'queryCursor' | 'queryCodex' | 'queryOpenCode'
>;

/**
 * Assembles the production Agent router while accepting provider runners from
 * the centralized provider runtime service.
 */
export function createAgentModule(externalDependencies: AgentExternalDependencies) {
  return createAgentRouter({
    fileSystem: fs,
    crypto,
    homeDirectory: os.homedir,
    spawnProcess: spawn,
    platformMode: process.env.VITE_IS_PLATFORM === 'true',
    users: {
      getFirstUser: () => userDb.getFirstUser(),
    },
    apiKeys: {
      validateApiKey: (apiKey) => apiKeysDb.validateApiKey(apiKey),
    },
    githubTokens: {
      getActiveGithubToken: (userId) => githubTokensDb.getActiveGithubToken(userId),
    },
    projects: {
      createProjectPath: (projectPath, customName) =>
        projectsDb.createProjectPath(projectPath, customName),
    },
    models: providerModelsService,
    GithubClient: Octokit,
    ...externalDependencies,
  });
}
