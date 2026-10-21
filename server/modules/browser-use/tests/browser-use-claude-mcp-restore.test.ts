import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { closeConnection, initializeDatabase } from '@/modules/database/index.js';

const ENV_KEYS = ['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'DATABASE_PATH'] as const;

const readClaudeUserServers = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    const config = JSON.parse(await fs.readFile(filePath, 'utf8')) as { mcpServers?: Record<string, unknown> };
    return config.mcpServers ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
};

/**
 * Browser MCP is registered only when its setting is toggled. A server that
 * enabled it before CloudCLI followed CLAUDE_CONFIG_DIR left the Claude entry
 * in ~/.claude.json, which a CLI using that config folder never reads, while
 * the setting still says enabled (#1576). Startup puts it where the CLI reads.
 * HOME, the config folder and the database are all throwaway.
 */
test('startup restores the Browser MCP entry in the Claude config the CLI reads', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-mcp-claude-restore-'));
  const configDir = path.join(tempRoot, 'claude-profile');
  const homeConfigPath = path.join(tempRoot, '.claude.json');
  const profileConfigPath = path.join(configDir, '.claude.json');

  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  delete process.env.CLAUDE_CONFIG_DIR;
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  await initializeDatabase();

  try {
    // Enabled while the server ran without CLAUDE_CONFIG_DIR: the entry is in ~/.claude.json.
    await browserUseService.updateSettings({ enabled: true });
    const homeEntry = (await readClaudeUserServers(homeConfigPath))['cloudcli-browser'];
    assert.ok(homeEntry);

    // The server now starts with CLAUDE_CONFIG_DIR set.
    process.env.CLAUDE_CONFIG_DIR = configDir;
    assert.deepEqual(await browserUseService.restoreClaudeAgentMcpRegistration(), { restored: true });
    assert.deepEqual((await readClaudeUserServers(profileConfigPath))['cloudcli-browser'], homeEntry);

    // Already there on the next start: nothing is written.
    assert.deepEqual(await browserUseService.restoreClaudeAgentMcpRegistration(), { restored: false });

    // Turned off: removed where the CLI reads it, and not put back on the next start.
    await browserUseService.updateSettings({ enabled: false });
    assert.deepEqual(await browserUseService.restoreClaudeAgentMcpRegistration(), { restored: false });
    assert.equal((await readClaudeUserServers(profileConfigPath))['cloudcli-browser'], undefined);
  } finally {
    closeConnection();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
