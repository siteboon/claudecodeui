import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';

async function withIsolatedClaudeAuth(runTest: (tempDirectory: string) => void | Promise<void>): Promise<void> {
  const previousHome = process.env.HOME;
  const previousCliPath = process.env.CLAUDE_CLI_PATH;
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-auth-'));

  process.env.HOME = tempDirectory;
  process.env.CLAUDE_CLI_PATH = '/bin/true';

  try {
    await mkdir(path.join(tempDirectory, '.claude'), { recursive: true });
    await runTest(tempDirectory);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = previousCliPath;
    }
    if (previousApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousApiKey;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('Claude auth warns when ANTHROPIC_API_KEY shadows OAuth credentials', async () => {
  await withIsolatedClaudeAuth(async (tempDirectory) => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    await writeFile(
      path.join(tempDirectory, '.claude', '.credentials.json'),
      JSON.stringify({
        email: 'user@example.com',
        claudeAiOauth: {
          accessToken: 'oauth-token',
          expiresAt: Date.now() + 60_000,
        },
      }),
      'utf8'
    );

    const status = await new ClaudeProviderAuth().getStatus();

    assert.equal(status.authenticated, true);
    assert.equal(status.method, 'api_key');
    assert.match(status.warning ?? '', /ANTHROPIC_API_KEY/);
    assert.match(status.warning ?? '', /OAuth/);
  });
});
