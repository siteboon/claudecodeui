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
    const previousConfigDirectory = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = root;
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
      if (previousConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousConfigDirectory;
      await rm(root, { recursive: true, force: true });
    }
  });
}
