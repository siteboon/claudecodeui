import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { providerMcpService } from '@/modules/providers/index.js';

import { taskmasterRoutes } from '../taskmaster.module.js';

const ENV_KEYS = ['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR'] as const;

/**
 * The sidebar's TaskMaster status must look where the MCP settings save Claude
 * servers and where a CLI spawned by this server loads them. With
 * CLAUDE_CONFIG_DIR set, that is `$CLAUDE_CONFIG_DIR/.claude.json`, not
 * `~/.claude.json` (#1576). Runs the production wiring of the module.
 */
test('TaskMaster MCP detection follows CLAUDE_CONFIG_DIR like the MCP settings and the CLI', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmaster-claude-config-dir-'));
  const configDir = path.join(tempRoot, 'claude-profile');
  await fs.mkdir(configDir, { recursive: true });

  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  process.env.CLAUDE_CONFIG_DIR = configDir;

  const app = express().use('/api/taskmaster', taskmasterRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const readStatus = async (): Promise<Record<string, unknown>> => {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/taskmaster/mcp-status`);
    assert.equal(response.status, 200);
    return await response.json() as Record<string, unknown>;
  };

  try {
    // Added with `claude mcp add --scope user` under that profile.
    await fs.writeFile(path.join(configDir, '.claude.json'), JSON.stringify({
      mcpServers: { 'task-master-ai': { type: 'stdio', command: 'npx', args: ['-y', 'task-master-ai'] } },
    }));
    const cliAdded = await readStatus();
    assert.equal(cliAdded.hasMCPServer, true);
    assert.equal(cliAdded.scope, 'user');

    // Saved through CloudCLI's MCP settings instead.
    await fs.writeFile(path.join(configDir, '.claude.json'), JSON.stringify({ mcpServers: {} }));
    assert.equal((await readStatus()).hasMCPServer, false);
    await providerMcpService.upsertProviderMcpServer('claude', {
      name: 'task-master-ai',
      scope: 'user',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'task-master-ai'],
      env: { ANTHROPIC_API_KEY: 'secret-value' },
    });
    const savedInSettings = await readStatus();
    assert.equal(savedInSettings.hasMCPServer, true);
    assert.deepEqual((savedInSettings.config as Record<string, unknown>).envVars, ['ANTHROPIC_API_KEY']);

    // Without the variable, detection reads ~/.claude.json again.
    delete process.env.CLAUDE_CONFIG_DIR;
    await fs.writeFile(path.join(tempRoot, '.claude.json'), JSON.stringify({ mcpServers: { other: { command: 'node' } } }));
    const homeStatus = await readStatus();
    assert.equal(homeStatus.hasMCPServer, false);
    assert.equal(homeStatus.configPath, path.join(tempRoot, '.claude.json'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
