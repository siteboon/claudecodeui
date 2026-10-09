import assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test, { after } from 'node:test';

import express from 'express';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, so it
// is set before the router is imported. The paths need not exist.
const previousAllowedPaths = process.env.ALLOWED_PATHS;
process.env.ALLOWED_PATHS = '/srv/cloudcli-allowed';

const { createAgentRouter } = await import('../agent.routes.js');

after(() => {
  if (previousAllowedPaths === undefined) {
    delete process.env.ALLOWED_PATHS;
  } else {
    process.env.ALLOWED_PATHS = previousAllowedPaths;
  }
});

type AgentDependencies = Parameters<typeof createAgentRouter>[0];

test('the agent API refuses a project or clone destination outside ALLOWED_PATHS', async () => {
  const registeredPaths: string[] = [];
  const spawnedCommands: string[] = [];
  const unexpectedProviderCall = async (): Promise<never> => {
    throw new Error('Provider runtime should not be called');
  };
  const dependencies = {
    fileSystem: {} as AgentDependencies['fileSystem'],
    crypto: nodeCrypto,
    homeDirectory: () => '/home/test',
    spawnProcess: ((command: string) => {
      spawnedCommands.push(command);
      throw new Error('spawn should not run');
    }) as unknown as AgentDependencies['spawnProcess'],
    platformMode: true,
    users: { getFirstUser: () => ({ id: 1, username: 'test-user' }) },
    apiKeys: { validateApiKey: () => undefined },
    githubTokens: { getActiveGithubToken: () => null },
    projects: {
      createProjectPath: (projectPath: string) => {
        registeredPaths.push(projectPath);
        return { outcome: 'created' };
      },
    },
    models: {} as AgentDependencies['models'],
    sessions: {
      getSessionById: () => null,
      getSessionByProviderSessionId: () => null,
      createAppSession: () => ({ sessionId: 'app-session-1' }),
    },
    runs: {
      startRun: (() => null) as unknown as AgentDependencies['runs']['startRun'],
      completeRunIfCurrent: () => undefined,
      isProcessing: () => false,
    },
    queryClaude: unexpectedProviderCall as AgentDependencies['queryClaude'],
    queryCursor: unexpectedProviderCall as AgentDependencies['queryCursor'],
    queryCodex: unexpectedProviderCall as AgentDependencies['queryCodex'],
    queryOpenCode: unexpectedProviderCall as AgentDependencies['queryOpenCode'],
    GithubClient: class {} as unknown as AgentDependencies['GithubClient'],
  } satisfies AgentDependencies;

  const app = express().use(express.json()).use('/api/agent', createAgentRouter(dependencies));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent`;
    const post = (body: Record<string, unknown>) => fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello', stream: false, ...body }),
    });

    assert.equal((await post({ projectPath: '/srv/cloudcli-outside/app' })).status, 403);
    // Without a projectPath a clone lands under ~/.claude/external-projects.
    assert.equal((await post({ githubUrl: 'https://github.com/owner/repo' })).status, 403);
    assert.equal(
      (await post({ githubUrl: 'https://github.com/owner/repo', projectPath: '/srv/cloudcli-allowed10' })).status,
      403,
    );
    assert.notEqual((await post({ projectPath: '/srv/cloudcli-allowed/app' })).status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert.deepEqual(spawnedCommands, []);
  assert.deepEqual(registeredPaths, []);
});
