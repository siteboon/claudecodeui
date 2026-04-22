import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeProviderAuth } from '../../../../dist-server/server/modules/providers/list/claude/claude-auth.provider.js';

test('ClaudeProviderAuth treats ANTHROPIC_AUTH_TOKEN in process env as authenticated', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-auth-env-'));
  const previousHome = process.env.HOME;
  const previousToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  const previousCliPath = process.env.CLAUDE_CLI_PATH;

  process.env.HOME = tempHome;
  process.env.CLAUDE_CLI_PATH = 'true';
  process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const auth = new ClaudeProviderAuth();
    const status = await auth.getStatus();

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, true);
    assert.equal(status.method, 'api_key');
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousToken === undefined) {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_AUTH_TOKEN = previousToken;
    }

    if (previousApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousApiKey;
    }

    if (previousCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = previousCliPath;
    }

    await fs.rm(tempHome, { recursive: true, force: true });
  }
});
