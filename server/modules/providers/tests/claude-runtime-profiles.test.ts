import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { AnyRecord, ProviderRuntimeContext } from '@/shared/types.js';

for (const scenario of ['selected', 'inherited', 'missing', 'invalid', 'default'] as const) {
  test(`Claude MCP configuration stays in the ${scenario} environment`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'claude-profile-'));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousConfigDirectory = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    delete process.env.CLAUDE_CONFIG_DIR;
    const profileDirectory = path.join(root, 'profile');
    const cwd = path.join(root, 'workspace');
    const defaultServers = { personal: { command: 'personal-mcp' } };
    const profileServers = { work: { command: 'work-mcp' }, shared: { command: 'project-mcp' } };
    let capturedOptions: AnyRecord | undefined;

    try {
      await mkdir(cwd);
      await mkdir(profileDirectory);
      await writeFile(path.join(root, '.claude.json'), JSON.stringify({ mcpServers: defaultServers }));
      if (scenario !== 'missing') {
        await writeFile(path.join(profileDirectory, '.claude.json'), scenario === 'invalid' ? '{invalid' : JSON.stringify({
          mcpServers: { work: profileServers.work, shared: { command: 'global-mcp' } },
          projects: { [cwd]: { mcpServers: { shared: profileServers.shared } } },
        }));
      }
      if (scenario === 'inherited') process.env.CLAUDE_CONFIG_DIR = profileDirectory;

      const context: ProviderRuntimeContext = {
        runtimeProfile: {
          id: scenario, name: scenario, provider: 'claude', isDefault: scenario === 'default',
          env: scenario === 'default' || scenario === 'inherited' ? {} : { CLAUDE_CONFIG_DIR: profileDirectory },
        },
        resolveProviderSessionId: () => null,
        resolveResumeModel: async () => undefined,
        getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'default' }),
        normalizeMessage: () => [],
        isProviderInstalled: async () => true,
        createQuery({ options }) {
          capturedOptions = options;
          return Object.assign((async function* () {})(), { interrupt: async () => {} });
        },
      };
      await queryClaudeSDK('hello', { sessionId: `profile-${scenario}`, cwd }, { send() {} }, context);

      assert.ok(capturedOptions, 'the runtime reached the SDK seam');
      assert.deepEqual(capturedOptions.mcpServers,
        scenario === 'default' ? defaultServers
          : scenario === 'missing' || scenario === 'invalid' ? undefined : profileServers);
      if (scenario !== 'default') assert.equal(capturedOptions.env.CLAUDE_CONFIG_DIR, profileDirectory);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      if (previousConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousConfigDirectory;
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  { platform: 'win32', config: false, emptyHome: false, expected: 'windows' },
  { platform: 'win32', config: true, emptyHome: false, expected: 'config' },
  { platform: 'linux', config: false, emptyHome: false, expected: 'posix' },
  { platform: 'win32', config: false, emptyHome: true, expected: 'fallback' },
  { platform: 'linux', config: false, emptyHome: true, expected: 'fallback' },
] as const) {
  test(`Claude MCP home on ${scenario.platform} selects ${scenario.expected}`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'claude-mcp-home-'));
    const saved = Object.fromEntries(['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]));
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const directories = Object.fromEntries(['windows', 'posix', 'config', 'fallback'].map((key) => [key, path.join(root, key)]));
    let capturedOptions: AnyRecord | undefined;
    try {
      for (const [key, directory] of Object.entries(directories)) {
        await mkdir(directory);
        await writeFile(path.join(directory, '.claude.json'), JSON.stringify({ mcpServers: { [key]: { command: key } } }));
      }
      delete process.env.CLAUDE_CONFIG_DIR;
      t.mock.method(os, 'homedir', () => directories.fallback);
      Object.defineProperty(process, 'platform', { ...platform, value: scenario.platform });
      const context: ProviderRuntimeContext = {
        runtimeProfile: {
          id: 'work', name: 'Work', provider: 'claude', isDefault: false,
          executable: path.join(root, 'claude.js'),
          env: {
            HOME: scenario.emptyHome && scenario.platform === 'linux' ? '' : directories.posix,
            USERPROFILE: scenario.emptyHome && scenario.platform === 'win32' ? '' : directories.windows,
            ...(scenario.config ? { CLAUDE_CONFIG_DIR: directories.config } : {}),
          },
        },
        resolveProviderSessionId: () => null,
        resolveResumeModel: async () => undefined,
        getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'default' }),
        normalizeMessage: () => [],
        isProviderInstalled: async () => true,
        createQuery({ options }) {
          capturedOptions = options;
          return Object.assign((async function* () {})(), { interrupt: async () => {} });
        },
      };
      await queryClaudeSDK('hello', { sessionId: 'mcp-home', cwd: root }, { send() {} }, context);
      assert.ok(capturedOptions);
      assert.deepEqual(capturedOptions.mcpServers, { [scenario.expected]: { command: scenario.expected } });
    } finally {
      Object.defineProperty(process, 'platform', platform);
      t.mock.restoreAll();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}
