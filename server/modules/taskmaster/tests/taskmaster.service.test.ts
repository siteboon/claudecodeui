import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { createTaskmasterService } from '../taskmaster.service.js';

type ServiceDependencies = Parameters<typeof createTaskmasterService>[0];

function createDependencies(
  homeDirectory: string,
  files: Record<string, string>,
): ServiceDependencies {
  return {
    getHomeDirectory: () => homeDirectory,
    readTextFile: async (filePath) => {
      const content = files[filePath];
      if (content === undefined) {
        throw new Error(`Missing fake file: ${filePath}`);
      }
      return content;
    },
  };
}

test('detectMcpServer returns a redacted TaskMaster server status', async () => {
  const homeDirectory = path.join(path.sep, 'fake-home');
  const configurationPath = path.join(homeDirectory, '.claude.json');
  const service = createTaskmasterService(createDependencies(homeDirectory, {
    [configurationPath]: JSON.stringify({
      mcpServers: {
        'task-master-ai': {
          command: 'npx',
          args: ['-y', 'task-master-ai'],
          env: { ANTHROPIC_API_KEY: 'secret-value' },
        },
      },
    }),
  }));

  assert.deepEqual(await service.detectMcpServer(), {
    hasMCPServer: true,
    isConfigured: true,
    hasApiKeys: true,
    scope: 'user',
    config: {
      command: 'npx',
      args: ['-y', 'task-master-ai'],
      url: null,
      envVars: ['ANTHROPIC_API_KEY'],
      type: 'stdio',
    },
  });
});

test('detectMcpServer checks the fallback configuration after malformed JSON', async () => {
  const homeDirectory = path.join(path.sep, 'fake-home');
  const primaryConfigurationPath = path.join(homeDirectory, '.claude.json');
  const fallbackConfigurationPath = path.join(homeDirectory, '.claude', 'settings.json');
  const service = createTaskmasterService(createDependencies(homeDirectory, {
    [primaryConfigurationPath]: '{ malformed',
    [fallbackConfigurationPath]: JSON.stringify({
      projects: {
        '/workspace/project': {
          mcpServers: {
            'project-task-master': { url: 'https://taskmaster.example.test/mcp' },
          },
        },
      },
    }),
  }));

  assert.deepEqual(await service.detectMcpServer(), {
    hasMCPServer: true,
    isConfigured: true,
    hasApiKeys: false,
    scope: 'local',
    projectPath: '/workspace/project',
    config: {
      command: null,
      args: [],
      url: 'https://taskmaster.example.test/mcp',
      envVars: [],
      type: 'http',
    },
  });
});

test('detectMcpServer reports when no readable Claude configuration exists', async () => {
  const homeDirectory = path.join(path.sep, 'fake-home');
  const service = createTaskmasterService(createDependencies(homeDirectory, {}));

  assert.deepEqual(await service.detectMcpServer(), {
    hasMCPServer: false,
    reason: 'No Claude configuration file found',
    hasConfig: false,
  });
});
