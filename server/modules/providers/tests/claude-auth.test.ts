import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';

// checkCredentials() is private, but unlike getStatus() it never shells out to the
// `claude` CLI — it only reads env vars and ~/.claude files. Calling it directly
// (TypeScript's `private` has no runtime effect) tests the priority order without
// depending on `claude` being installed in the test environment.
type CheckCredentialsResult = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const checkCredentials = (auth: ClaudeProviderAuth): Promise<CheckCredentialsResult> =>
  (auth as unknown as { checkCredentials: () => Promise<CheckCredentialsResult> }).checkCredentials();

const ENV_KEYS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_VERTEX_PROJECT_ID',
] as const;

const withEnv = async (
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  fn: () => Promise<void>,
) => {
  const original: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  for (const key of ENV_KEYS) {
    original[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
};

const withTempHome = async (fn: (homeDir: string) => Promise<void>) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'claude-auth-test-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;
  try {
    await fn(homeDir);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(homeDir, { recursive: true, force: true });
  }
};

const writeCredentialsFile = async (homeDir: string, body: unknown) => {
  const claudeDir = path.join(homeDir, '.claude');
  await mkdir(claudeDir, { recursive: true });
  await writeFile(path.join(claudeDir, '.credentials.json'), JSON.stringify(body));
};

const writeSettingsFile = async (homeDir: string, env: Record<string, string>) => {
  const claudeDir = path.join(homeDir, '.claude');
  await mkdir(claudeDir, { recursive: true });
  await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({ env }));
};

test('checkCredentials: CLAUDE_CODE_OAUTH_TOKEN set is authenticated via environment, even with a stale credentials file', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, {
      claudeAiOauth: { accessToken: 'stale-token', expiresAt: 1_000_000_000_000 }, // long expired
    });

    await withEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'environment');
    });
  });
});

test('checkCredentials: CLAUDE_CODE_OAUTH_TOKEN configured via settings.json env block is authenticated via environment', async () => {
  await withTempHome(async (homeDir) => {
    await writeSettingsFile(homeDir, { CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token-from-settings' });
    await writeCredentialsFile(homeDir, {
      claudeAiOauth: { accessToken: 'stale-token', expiresAt: 1_000_000_000_000 }, // long expired
    });

    await withEnv({}, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'environment');
    });
  });
});

test('checkCredentials: no CLAUDE_CODE_OAUTH_TOKEN, valid credentials file falls back to credentials_file', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, {
      claudeAiOauth: { accessToken: 'valid-token', expiresAt: Date.now() + 60 * 60 * 1000 },
      email: 'someone@example.com',
    });

    await withEnv({}, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'credentials_file');
      assert.equal(status.email, 'someone@example.com');
    });
  });
});

test('checkCredentials: no CLAUDE_CODE_OAUTH_TOKEN, expired credentials file reports not authenticated', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, {
      claudeAiOauth: { accessToken: 'stale-token', expiresAt: 1_000_000_000_000 },
    });

    await withEnv({}, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, false);
      assert.match(status.error ?? '', /expired/i);
    });
  });
});

test('checkCredentials: expired access token with a live refresh token is still authenticated', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, {
      claudeAiOauth: {
        accessToken: 'stale-token',
        refreshToken: 'live-refresh-token',
        expiresAt: 1_000_000_000_000,
        refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      },
      email: 'someone@example.com',
    });

    await withEnv({}, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'credentials_file');
      assert.equal(status.email, 'someone@example.com');
    });
  });
});

test('checkCredentials: expired access token with a refresh token that has no recorded expiry is authenticated', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, {
      claudeAiOauth: {
        accessToken: 'stale-token',
        refreshToken: 'live-refresh-token',
        expiresAt: 1_000_000_000_000,
      },
    });

    await withEnv({}, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'credentials_file');
    });
  });
});

test('checkCredentials: expired access token with an expired refresh token reports not authenticated', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, {
      claudeAiOauth: {
        accessToken: 'stale-token',
        refreshToken: 'stale-refresh-token',
        expiresAt: 1_000_000_000_000,
        refreshTokenExpiresAt: 1_000_000_000_000,
      },
    });

    await withEnv({}, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, false);
      assert.match(status.error ?? '', /expired/i);
    });
  });
});

test('checkCredentials: ANTHROPIC_API_KEY takes precedence over CLAUDE_CODE_OAUTH_TOKEN', async () => {
  await withTempHome(async () => {
    await withEnv(
      { ANTHROPIC_API_KEY: 'test-api-key', CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token' },
      async () => {
        const status = await checkCredentials(new ClaudeProviderAuth());
        assert.equal(status.authenticated, true);
        assert.equal(status.method, 'api_key');
      },
    );
  });
});

test('checkCredentials: CLAUDE_CODE_USE_VERTEX in settings.json env is authenticated via the cloud provider', async () => {
  await withTempHome(async (homeDir) => {
    await writeSettingsFile(homeDir, {
      CLAUDE_CODE_USE_VERTEX: '1',
      ANTHROPIC_VERTEX_PROJECT_ID: 'my-gcp-project',
      CLOUD_ML_REGION: 'us-east5',
    });

    await withEnv({}, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'cloud_provider');
      assert.equal(status.email, 'Google Vertex AI (my-gcp-project)');
    });
  });
});

test('checkCredentials: CLAUDE_CODE_USE_VERTEX in the process env is authenticated, with or without a project id', async () => {
  await withTempHome(async () => {
    await withEnv({ CLAUDE_CODE_USE_VERTEX: 'true', ANTHROPIC_VERTEX_PROJECT_ID: 'env-project' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'cloud_provider');
      assert.equal(status.email, 'Google Vertex AI (env-project)');
    });

    // The Vertex client can resolve the project from Google credentials, so a
    // missing ANTHROPIC_VERTEX_PROJECT_ID does not stop the CLI from working.
    await withEnv({ CLAUDE_CODE_USE_VERTEX: 'TRUE' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'cloud_provider');
      assert.equal(status.email, 'Google Vertex AI');
    });
  });
});

test('checkCredentials: Bedrock, Foundry, Claude Platform on AWS and Mantle switches are authenticated via the cloud provider', async () => {
  const cases = [
    { key: 'CLAUDE_CODE_USE_BEDROCK', label: 'Amazon Bedrock' },
    { key: 'CLAUDE_CODE_USE_FOUNDRY', label: 'Microsoft Foundry' },
    { key: 'CLAUDE_CODE_USE_ANTHROPIC_AWS', label: 'Claude Platform on AWS' },
    { key: 'CLAUDE_CODE_USE_MANTLE', label: 'Amazon Bedrock (Mantle)' },
  ] as const;

  await withTempHome(async () => {
    for (const { key, label } of cases) {
      await withEnv({ [key]: 'yes' }, async () => {
        const status = await checkCredentials(new ClaudeProviderAuth());
        assert.equal(status.authenticated, true, key);
        assert.equal(status.method, 'cloud_provider', key);
        assert.equal(status.email, label, key);
      });
    }
  });
});

test('checkCredentials: a cloud provider switch wins over an Anthropic API key, matching the CLI routing', async () => {
  await withTempHome(async () => {
    await withEnv({ ANTHROPIC_API_KEY: 'test-api-key', CLAUDE_CODE_USE_BEDROCK: '1' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'cloud_provider');
      assert.equal(status.email, 'Amazon Bedrock');
    });
  });
});

test('checkCredentials: with several cloud provider switches on, the one the CLI picks first is reported', async () => {
  await withTempHome(async () => {
    await withEnv({ CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_BEDROCK: '1' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.method, 'cloud_provider');
      assert.equal(status.email, 'Amazon Bedrock');
    });
  });
});

test('checkCredentials: a disabled cloud provider switch does not count as authenticated', async () => {
  await withTempHome(async (homeDir) => {
    await withEnv({ CLAUDE_CODE_USE_VERTEX: '0', CLAUDE_CODE_USE_BEDROCK: 'false' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, false);
      assert.equal(status.method, null);
    });

    // settings.json env is applied over the process env by the CLI, so an
    // explicit "0" there switches Vertex off even when the process env enables it.
    await writeSettingsFile(homeDir, { CLAUDE_CODE_USE_VERTEX: '0' });
    await withEnv({ CLAUDE_CODE_USE_VERTEX: '1' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, false);
      assert.equal(status.method, null);
    });
  });
});
