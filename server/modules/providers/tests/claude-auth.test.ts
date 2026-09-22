import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';
import type { ProviderAuthStatus, ProviderAuthSubscriptionOverride } from '@/shared/types.js';

// checkCredentials() is private, but unlike getStatus() it never shells out to the
// `claude` CLI — it only reads env vars and ~/.claude files. Calling it directly
// (TypeScript's `private` has no runtime effect) tests the priority order without
// depending on `claude` being installed in the test environment.
type CheckCredentialsResult = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
  subscriptionOverride?: ProviderAuthSubscriptionOverride;
};

const checkCredentials = (auth: ClaudeProviderAuth): Promise<CheckCredentialsResult> =>
  (auth as unknown as { checkCredentials: () => Promise<CheckCredentialsResult> }).checkCredentials();

// getStatus() is the public API the route serves, but it first shells out to
// `claude --version`. Stubbing checkInstalled() lets the test cover the mapping
// from checkCredentials() to the wire shape without the CLI.
const getStatusWithCliInstalled = (auth: ClaudeProviderAuth): Promise<ProviderAuthStatus> => {
  (auth as unknown as { checkInstalled: () => boolean }).checkInstalled = () => true;
  return auth.getStatus();
};

const validSubscriptionCredentials = (email?: string) => ({
  claudeAiOauth: {
    accessToken: 'valid-token',
    refreshToken: 'live-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
  },
  ...(email ? { email } : {}),
});

const ENV_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;

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

// Issue #568: Claude Code silently prefers ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
// over the `claude /login` subscription, billing every request to the key. The
// status must say so — and only when a usable login is really being bypassed.

test('checkCredentials: ANTHROPIC_API_KEY in the process env alongside a valid subscription login reports the override', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, validSubscriptionCredentials('someone@example.com'));

    await withEnv({ ANTHROPIC_API_KEY: 'test-api-key' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      // The existing fields are untouched: the key still wins and keeps its label.
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'api_key');
      assert.equal(status.email, 'API Key Auth');
      assert.deepEqual(status.subscriptionOverride, {
        variable: 'ANTHROPIC_API_KEY',
        source: 'process_env',
        subscriptionEmail: 'someone@example.com',
      });
    });
  });
});

test('checkCredentials: ANTHROPIC_AUTH_TOKEN in the process env alongside a valid subscription login names the auth token', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, validSubscriptionCredentials());

    await withEnv({ ANTHROPIC_AUTH_TOKEN: 'test-auth-token', ANTHROPIC_API_KEY: 'test-api-key' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.method, 'api_key');
      assert.equal(status.email, 'Auth Token');
      assert.deepEqual(status.subscriptionOverride, {
        variable: 'ANTHROPIC_AUTH_TOKEN',
        source: 'process_env',
        subscriptionEmail: null,
      });
    });
  });
});

test('checkCredentials: ANTHROPIC_API_KEY in settings.json env alongside a valid subscription login points at settings.json', async () => {
  await withTempHome(async (homeDir) => {
    await writeSettingsFile(homeDir, { ANTHROPIC_API_KEY: 'test-api-key-from-settings' });
    await writeCredentialsFile(homeDir, validSubscriptionCredentials('someone@example.com'));

    await withEnv({}, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.method, 'api_key');
      assert.equal(status.email, 'API Key Auth');
      assert.deepEqual(status.subscriptionOverride, {
        variable: 'ANTHROPIC_API_KEY',
        source: 'settings_file',
        subscriptionEmail: 'someone@example.com',
      });
    });
  });
});

test('checkCredentials: ANTHROPIC_API_KEY with no credentials file reports no override', async () => {
  await withTempHome(async () => {
    await withEnv({ ANTHROPIC_API_KEY: 'test-api-key' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'api_key');
      assert.equal(status.subscriptionOverride, undefined);
    });
  });
});

test('checkCredentials: ANTHROPIC_API_KEY with an expired subscription login reports no override', async () => {
  await withTempHome(async (homeDir) => {
    // Nothing usable is being bypassed here, so warning would only confuse.
    await writeCredentialsFile(homeDir, {
      claudeAiOauth: {
        accessToken: 'stale-token',
        refreshToken: 'stale-refresh-token',
        expiresAt: 1_000_000_000_000,
        refreshTokenExpiresAt: 1_000_000_000_000,
      },
    });

    await withEnv({ ANTHROPIC_API_KEY: 'test-api-key' }, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'api_key');
      assert.equal(status.subscriptionOverride, undefined);
    });
  });
});

test('checkCredentials: a valid subscription login with no API key reports credentials_file and no override', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, validSubscriptionCredentials('someone@example.com'));

    await withEnv({}, async () => {
      const status = await checkCredentials(new ClaudeProviderAuth());
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'credentials_file');
      assert.equal(status.email, 'someone@example.com');
      assert.equal(status.subscriptionOverride, undefined);
    });
  });
});

test('getStatus: passes the subscription override through to the wire shape, and omits the key when there is none', async () => {
  await withTempHome(async (homeDir) => {
    await writeCredentialsFile(homeDir, validSubscriptionCredentials('someone@example.com'));

    await withEnv({ ANTHROPIC_API_KEY: 'test-api-key' }, async () => {
      const status = await getStatusWithCliInstalled(new ClaudeProviderAuth());
      assert.equal(status.installed, true);
      assert.equal(status.provider, 'claude');
      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'api_key');
      assert.equal(status.email, 'API Key Auth');
      assert.deepEqual(status.subscriptionOverride, {
        variable: 'ANTHROPIC_API_KEY',
        source: 'process_env',
        subscriptionEmail: 'someone@example.com',
      });
    });

    await withEnv({}, async () => {
      const status = await getStatusWithCliInstalled(new ClaudeProviderAuth());
      assert.equal(status.method, 'credentials_file');
      // Omitted, not null: existing JSON consumers see exactly the old payload.
      assert.equal('subscriptionOverride' in status, false);
    });
  });
});
