import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fsPromises, { chmod, mkdir, mkdtemp, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import {
  OpenCodeProviderModels,
  OPENCODE_PREDEFINED_MODELS,
} from '@/modules/providers/list/opencode/opencode-models.provider.js';

const OPENCODE_ENV_KEYS = [
  'OPENCODE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'WALLY_API_KEY',
  'NVIDIA_API_KEY',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_CONTENT',
];

/**
 * Runs one case against a throwaway OpenCode home, so the catalog the adapter
 * reports depends on the fixture rather than on the providers the machine
 * running the suite happens to be logged into.
 */
const withOpenCodeHome = async (
  setUp: (homeDir: string) => Promise<void>,
  runTest: (adapter: OpenCodeProviderModels) => Promise<void>,
  readModels: () => Promise<string[]> = async () => [],
): Promise<void> => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-catalog-'));
  const originalHomedir = os.homedir;
  const originalEnv = OPENCODE_ENV_KEYS.map((key) => [key, process.env[key]] as const);

  (os as any).homedir = () => homeDir;
  for (const key of OPENCODE_ENV_KEYS) {
    delete process.env[key];
  }

  try {
    await setUp(homeDir);
    await runTest(new OpenCodeProviderModels(readModels));
  } finally {
    (os as any).homedir = originalHomedir;
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(homeDir, { recursive: true, force: true });
  }
};

const writeOpenCodeAuth = async (homeDir: string, auth: Record<string, unknown>): Promise<void> => {
  const authDir = path.join(homeDir, '.local', 'share', 'opencode');
  await mkdir(authDir, { recursive: true });
  await writeFile(path.join(authDir, 'auth.json'), JSON.stringify(auth), 'utf8');
};

test('OpenCode falls back to the curated catalog only when no providers are known', async () => {
  await withOpenCodeHome(async () => {}, async (adapter) => {
    // Nothing readable about this install, so the picker keeps every option
    // rather than coming up empty.
    assert.deepEqual(await adapter.getSupportedModels(), OPENCODE_PREDEFINED_MODELS);
    assert.equal(
      (await adapter.getCurrentActiveModel()).model,
      OPENCODE_PREDEFINED_MODELS.DEFAULT,
    );
  });
  // OpenCode routes by `<providerID>/<modelID>`, so every option has to carry a
  // provider prefix that `opencode models --verbose` reports.
  const providerIds = new Set(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value.split('/')[0]),
  );
  assert.deepEqual([...providerIds].sort(), ['anthropic', 'opencode', 'opencode-go', 'openai', 'wally'].sort());
  assert.equal(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.every((option) => /^[a-z0-9-]+\/.+/.test(option.value)),
    true,
  );
  assert.equal(
    new Set(OPENCODE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value)).size,
    OPENCODE_PREDEFINED_MODELS.OPTIONS.length,
  );
  assert.equal(OPENCODE_PREDEFINED_MODELS.DEFAULT, 'opencode/gpt-5.6-terra');
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'opencode/claude-opus-5'),
  );
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'anthropic/claude-opus-5'),
  );
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'openai/gpt-5.6'),
  );
  // The Go gateway carries its own provider id, so its models must be curated
  // too - a Go subscriber otherwise authenticates while the picker offers
  // nothing they can run.
  const opencodeGoOptions = OPENCODE_PREDEFINED_MODELS.OPTIONS.filter(
    (option) => option.value.startsWith('opencode-go/'),
  );
  assert.equal(opencodeGoOptions.length, 27);
  assert.ok(opencodeGoOptions.every((option) => option.description === 'OpenCode Go'));
  const glmFlash = opencodeGoOptions.find(
    (option) => option.value === 'opencode-go/glm-5.3-flash',
  );
  assert.ok(glmFlash);
  // Effort choices come from `opencode models --verbose` variants; the runtime
  // turns a selected value into `--variant`, so the values have to match the
  // CLI's exactly.
  assert.deepEqual(
    glmFlash?.effort?.values.map((value) => value.value),
    ['low', 'high', 'max'],
  );
  assert.ok(
    opencodeGoOptions
      .filter((option) => !option.effort)
      .every((option) =>
        ['glm-5.1', 'kimi-k2.6', 'kimi-k2.7-code', 'mimo-v2.5', 'mimo-v2.5-pro',
          'minimax-m2.7', 'qwen3.6-plus', 'qwen3.7-max', 'qwen3.7-plus']
          .includes(option.value.slice('opencode-go/'.length)),
      ),
  );
});

test('OpenCode discovers only models available through connected providers', async () => {
  // Asking for a provider the user never connected fails the whole run with
  // "Model <id> is not valid", so an OpenCode Zen model must not be offered -
  // or defaulted to - on a machine that only holds an Anthropic key.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['anthropic']);
      assert.ok(catalog.OPTIONS.length > 0);
      assert.equal(catalog.DEFAULT.startsWith('anthropic/'), true);
      assert.ok(catalog.OPTIONS.some((option) => option.value === catalog.DEFAULT));
      assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
    },
    async () => ['anthropic/claude-sonnet-5', 'opencode/gpt-5.6-terra'],
  );

  // A Go subscriber's auth store holds only `opencode-go`, so the whole catalog
  // has to resolve to Go models and the default has to move onto one of them
  // instead of the unreachable Zen default.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'opencode-go': { type: 'api', key: 'test' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['opencode-go']);
      assert.equal(catalog.OPTIONS.length, 2);
      assert.equal(catalog.DEFAULT, 'opencode-go/grok-4.6');
      assert.ok(catalog.OPTIONS.some((option) => option.value === catalog.DEFAULT));
      assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
    },
    async () => ['opencode-go/grok-4.6', 'opencode-go/glm-5.3'],
  );

  // The catalog default survives whenever its own provider is connected.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, {
      opencode: { type: 'api', key: 'test' },
      openai: { type: 'oauth' },
    }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds].sort(), ['opencode', 'openai'].sort());
      assert.equal(catalog.DEFAULT, OPENCODE_PREDEFINED_MODELS.DEFAULT);
    },
    async () => ['opencode/gpt-5.6-terra', 'openai/gpt-5.6'],
  );

  // Providers configured rather than logged into count too.
  await withOpenCodeHome(
    async (homeDir) => {
      const configDir = path.join(homeDir, '.config', 'opencode');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        path.join(configDir, 'opencode.json'),
        JSON.stringify({ provider: { anthropic: { options: {} } } }),
        'utf8',
      );
    },
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['anthropic']);
    },
    async () => ['anthropic/claude-opus-5'],
  );

  // An API key in the environment is enough on its own.
  await withOpenCodeHome(
    async () => {
      process.env.OPENAI_API_KEY = 'test';
    },
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['openai']);
    },
    async () => ['openai/gpt-5.6'],
  );

  // A Wally key in the environment keeps its models next to a logged-in provider.
  await withOpenCodeHome(
    async (homeDir) => {
      await writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } });
      process.env.WALLY_API_KEY = 'test';
    },
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();

      assert.deepEqual(catalog.OPTIONS.map((option) => option.value), [
        'anthropic/claude-opus-5',
        'wally/deepseek-v4.1-flash',
      ]);
    },
    async () => ['anthropic/claude-opus-5', 'wally/deepseek-v4.1-flash', 'openai/gpt-5.6'],
  );

  // Two keys in the environment keep the models of both providers.
  await withOpenCodeHome(
    async () => {
      process.env.OPENROUTER_API_KEY = 'test';
      process.env.WALLY_API_KEY = 'test';
    },
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();

      assert.deepEqual(catalog.OPTIONS.map((option) => option.value), [
        'openrouter/qwen/qwen3-coder-flash',
        'wally/deepseek-v4.1-flash',
      ]);
    },
    async () => ['openrouter/qwen/qwen3-coder-flash', 'wally/deepseek-v4.1-flash', 'openai/gpt-5.6'],
  );
});

for (const failure of ['empty', 'rejected'] as const) {
  test(`OpenCode gives a Wally-only login a fallback after ${failure} initial discovery`, async () => {
    await withOpenCodeHome(
      async () => { process.env.WALLY_API_KEY = 'test'; },
      async (adapter) => {
        const catalog = await adapter.getSupportedModels();
        assert.deepEqual(catalog.OPTIONS.map((option) => option.value), ['wally/deepseek-v4.1-flash']);
        assert.equal(catalog.DEFAULT, 'wally/deepseek-v4.1-flash');
        assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
      },
      async () => {
        if (failure === 'rejected') throw new Error('OpenCode unavailable');
        return [];
      },
    );
  });
}

test('OpenCode preserves CLI-discovered environment-only providers when a Wally key is added', async () => {
  for (const withWally of [false, true]) {
    await withOpenCodeHome(
      async () => {
        process.env.NVIDIA_API_KEY = 'test';
        if (withWally) process.env.WALLY_API_KEY = 'test';
      },
      async (adapter) => {
        const catalog = await adapter.getSupportedModels();
        const expected = ['nvidia/vendor/model'];
        if (withWally) expected.push('wally/deepseek-v4.1-flash');
        assert.deepEqual(catalog.OPTIONS.map((option) => option.value), expected);
        assert.equal(catalog.DEFAULT, expected[0]);
      },
      async () => withWally
        ? ['nvidia/vendor/model', 'wally/deepseek-v4.1-flash', 'openai/gpt-5.6']
        : ['nvidia/vendor/model'],
    );
  }
});

for (const [envKey, providerId] of [
  ['WALLY_API_KEY', 'wally'],
  ['GOOGLE_GENERATIVE_AI_API_KEY', 'google'],
  ['GROQ_API_KEY', 'groq'],
]) {
  test(`OpenCode discovers ${envKey} models and retains other connected providers`, async () => {
    const model = providerId === 'wally' ? 'wally/deepseek-v4.1-flash' : `${providerId}/test-model`;
    await withOpenCodeHome(
      async (homeDir) => {
        process.env[envKey] = 'test';
        if (providerId !== 'wally') {
          await writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } });
        }
      },
      async (adapter) => {
        const catalog = await adapter.getSupportedModels();
        const expected = providerId === 'wally' ? [model] : [model, 'anthropic/claude-opus-5'];
        assert.deepEqual(catalog.OPTIONS.map((option) => option.value), expected);
        assert.equal(catalog.DEFAULT, model);
      },
      async () => providerId === 'wally'
        ? ['openai/gpt-5.6', model]
        : ['openai/gpt-5.6', model, 'anthropic/claude-opus-5',
          providerId === 'google' ? 'groq/test-model' : 'google/test-model'],
    );
  });
}

test('OpenCode uses discovered GitHub Copilot models and never falls back to foreign providers', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'github-copilot': { type: 'oauth' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();

      assert.deepEqual(catalog.OPTIONS.map((option) => option.value), [
        'github-copilot/gpt-5.6-terra',
        'github-copilot/claude-sonnet-5.5',
      ]);
      assert.equal(catalog.DEFAULT, 'github-copilot/gpt-5.6-terra');
      assert.equal((await adapter.getCurrentActiveModel()).model, 'github-copilot/gpt-5.6-terra');
    },
    async () => [
      'github-copilot/gpt-5.6-terra',
      'opencode/gpt-5.6-terra',
      'github-copilot/claude-sonnet-5.5',
    ],
  );

  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'github-copilot': { type: 'oauth' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();

      assert.deepEqual(catalog.OPTIONS, []);
      assert.equal(catalog.DEFAULT, '');
    },
  );

  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'github-copilot': { type: 'oauth' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();

      assert.deepEqual(catalog.OPTIONS, []);
      assert.equal(catalog.DEFAULT, '');
    },
    async () => Promise.reject(new Error('OpenCode unavailable')),
  );
});

test('OpenCode keeps curated metadata for discovered models it already knows', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'opencode-go': { type: 'api', key: 'test' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const [known, unknown] = catalog.OPTIONS;

      // The runtime turns the selected effort into `--variant`, so a known
      // model losing its levels would silently hide the Reasoning picker.
      assert.equal(known.value, 'opencode-go/glm-5.3-flash');
      assert.equal(known.label, 'GLM 5.3 Flash');
      assert.equal(known.description, 'OpenCode Go');
      assert.deepEqual(known.effort?.values.map((value) => value.value), ['low', 'high', 'max']);
      assert.deepEqual(unknown, {
        value: 'opencode-go/new-model',
        label: 'new-model',
        description: 'opencode-go',
      });
    },
    async () => ['opencode-go/glm-5.3-flash', 'opencode-go/new-model'],
  );
});

test('OpenCode counts providers from OPENCODE_CONFIG and OPENCODE_CONFIG_CONTENT', async () => {
  const listing = async () => ['my-proxy/foo', 'anthropic/claude-sonnet-5', 'opencode/gpt-5.6-terra'];
  const expectProxyAndAnthropic = async (adapter: OpenCodeProviderModels): Promise<void> => {
    const catalog = await adapter.getSupportedModels();
    assert.deepEqual(
      catalog.OPTIONS.map((option) => option.value),
      ['my-proxy/foo', 'anthropic/claude-sonnet-5'],
    );
  };

  await withOpenCodeHome(
    async (homeDir) => {
      await writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } });
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: { 'my-proxy': {} } });
    },
    expectProxyAndAnthropic,
    listing,
  );

  await withOpenCodeHome(
    async (homeDir) => {
      await writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } });
      const configPath = path.join(homeDir, 'custom-opencode.json');
      await writeFile(configPath, JSON.stringify({ provider: { 'my-proxy': {} } }), 'utf8');
      process.env.OPENCODE_CONFIG = configPath;
    },
    expectProxyAndAnthropic,
    listing,
  );
});

test('OpenCode caches the CLI model listing and refreshes it in the background', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } }),
    async () => {
      let now = 0;
      let listing = ['anthropic/claude-sonnet-5'];
      const pendingReads: Array<() => void> = [];
      let readCount = 0;
      const adapter = new OpenCodeProviderModels(
        () => {
          readCount += 1;
          const snapshot = listing;
          return new Promise((resolve) => {
            pendingReads.push(() => resolve(snapshot));
          });
        },
        () => now,
      );
      const flushRead = async (): Promise<void> => {
        for (let i = 0; i < 1000 && pendingReads.length === 0; i++) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        assert.ok(pendingReads.length > 0, 'model reader started');
        pendingReads.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
      };

      // Concurrent first loads share one CLI invocation.
      const firstLoads = Promise.all([adapter.getSupportedModels(), adapter.getSupportedModels()]);
      await new Promise((resolve) => setImmediate(resolve));
      await flushRead();
      const [first, second] = await firstLoads;
      assert.equal(readCount, 1);
      assert.deepEqual(first.OPTIONS.map((option) => option.value), ['anthropic/claude-sonnet-5']);
      assert.deepEqual(second, first);

      // Fresh cache: no new process.
      await adapter.getSupportedModels();
      assert.equal(readCount, 1);

      // Stale cache answers immediately and refreshes behind the response.
      now = 5 * 60_000;
      listing = ['anthropic/claude-opus-5'];
      const stale = await adapter.getSupportedModels();
      assert.deepEqual(stale.OPTIONS.map((option) => option.value), ['anthropic/claude-sonnet-5']);
      assert.equal(readCount, 2);
      await flushRead();
      const refreshed = await adapter.getSupportedModels();
      assert.deepEqual(refreshed.OPTIONS.map((option) => option.value), ['anthropic/claude-opus-5']);
      assert.equal(readCount, 2);
    },
  );
});

test('OpenCode invalidates removed unknown providers and recovers after failed refreshes', async () => {
  for (const source of ['auth', 'config']) {
    let home = '';
    await withOpenCodeHome(async (homeDir) => {
      home = homeDir;
      process.env.WALLY_API_KEY = 'test';
      if (source === 'auth') {
        await writeOpenCodeAuth(home, { nvidia: { type: 'api', key: 'test' } });
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: { nvidia: {} } });
      }
    }, async () => {
      let now = 0;
      let reads = 0;
      let fail = false;
      const listing = ['nvidia/vendor/model', 'wally/deepseek-ai/DeepSeek-V4.1-Flash'];
      const adapter = new OpenCodeProviderModels(async () => {
        reads += 1;
        if (fail) {
          if (reads % 2) throw new Error('test failure');
          return [];
        }
        return listing;
      }, () => now);
      assert.equal((await adapter.getSupportedModels()).DEFAULT, listing[0]);
      if (source === 'auth') await writeOpenCodeAuth(home, {});
      else delete process.env.OPENCODE_CONFIG_CONTENT;
      fail = true;
      assert.equal((await adapter.getSupportedModels()).DEFAULT, listing[1]);
      assert.equal(reads, 1); // Removal does not require another CLI process.
      for (const time of [300_000, 330_000, 360_000]) {
        now = time;
        await adapter.getSupportedModels();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal((await adapter.getSupportedModels()).DEFAULT, listing[1]);
      }
      fail = false;
      now += 30_000;
      await adapter.getSupportedModels();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal((await adapter.getSupportedModels()).DEFAULT, listing[0]);
    });
  }
});

test('OpenCode preserves stale discovery with current local provider evidence', async () => {
  for (const source of ['auth', 'config']) {
    let home = '';
    await withOpenCodeHome(async (homeDir) => {
      home = homeDir;
      process.env.WALLY_API_KEY = 'test';
      if (source === 'auth') {
        await writeOpenCodeAuth(home, { 'github-copilot': { type: 'oauth' } });
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: { 'github-copilot': {} } });
      }
    }, async () => {
      let now = 0;
      let reads = 0;
      let finishRefresh: (models: string[]) => void = () => assert.fail('refresh not started');
      const listing = ['github-copilot/test-model', 'wally/deepseek-v4.1-flash'];
      const adapter = new OpenCodeProviderModels(() => {
        reads += 1;
        if (reads === 1) return Promise.resolve(listing);
        if (reads === 2) return new Promise<string[]>((resolve) => { finishRefresh = resolve; });
        return Promise.reject(new Error('test failure'));
      }, () => now);
      const values = async () => (await adapter.getSupportedModels()).OPTIONS.map((option) => option.value);
      assert.deepEqual(await values(), listing);
      now = 300_000;
      assert.deepEqual(await values(), listing); // Refresh is still pending.
      finishRefresh([]);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(await values(), listing); // Empty refresh retains local evidence.
      now += 30_000;
      assert.deepEqual(await values(), listing);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(await values(), listing); // Rejected refresh does too.
      assert.equal(reads, 3);
      if (source === 'auth') await writeOpenCodeAuth(home, {});
      else delete process.env.OPENCODE_CONFIG_CONTENT;
      assert.deepEqual(await values(), [listing[1]]);
      assert.equal(reads, 3);
    });
  }
});

test('OpenCode ignores an older provider snapshot after a concurrent login', async () => {
  let home = '';
  await withOpenCodeHome(async (homeDir) => {
    home = homeDir;
    process.env.WALLY_API_KEY = 'test';
    await writeOpenCodeAuth(home, {});
  }, async () => {
    let reads = 0;
    const listing = ['nvidia/vendor/model', 'wally/deepseek-v4.1-flash'];
    const adapter = new OpenCodeProviderModels(async () => {
      reads += 1;
      return listing;
    });
    let releaseConfig: () => void = () => {};
    let signalConfig: () => void = () => {};
    const configReached = new Promise<void>((resolve) => { signalConfig = resolve; });
    const configGate = new Promise<void>((resolve) => { releaseConfig = resolve; });
    const originalReadFile = fsPromises.readFile;
    let gated = false;
    const readMock = mock.method(fsPromises, 'readFile', async (
      filePath: Parameters<typeof fsPromises.readFile>[0], options: any,
    ) => {
      // The auth file has already been read when the first config read begins.
      if (!gated && String(filePath) === path.join(home, '.config', 'opencode', 'opencode.json')) {
        gated = true;
        signalConfig();
        await configGate;
      }
      return originalReadFile(filePath, options);
    });
    syncBuiltinESMExports();
    const olderRequest = adapter.getSupportedModels();
    try {
      await configReached;
      await writeOpenCodeAuth(home, { nvidia: { type: 'api', key: 'test' } });
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map((option) => option.value), listing);
      releaseConfig();
      await olderRequest;
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map((option) => option.value), listing);
      assert.equal(reads, 1); // Newer evidence survives without another CLI read.
    } finally {
      releaseConfig();
      await olderRequest;
      readMock.mock.restore();
      syncBuiltinESMExports();
    }
  });
});

test('OpenCode bounds stale env-only unknown discovery across empty and rejected refreshes', async () => {
  await withOpenCodeHome(async () => {
    process.env.WALLY_API_KEY = 'test';
    process.env.NVIDIA_API_KEY = 'test';
  }, async () => {
    let now = 0;
    let reads = 0;
    const adapter = new OpenCodeProviderModels(async () => {
      reads += 1;
      if (reads === 2) return [];
      if (reads === 3) throw new Error('test failure');
      return ['nvidia/vendor/model', 'wally/deepseek-ai/DeepSeek-V4.1-Flash'];
    }, () => now);
    assert.equal((await adapter.getSupportedModels()).DEFAULT, 'nvidia/vendor/model');
    now = 299_999;
    assert.equal((await adapter.getSupportedModels()).DEFAULT, 'nvidia/vendor/model');
    assert.equal(reads, 1);
    for (const time of [300_000, 330_000]) {
      now = time;
      await adapter.getSupportedModels();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal((await adapter.getSupportedModels()).DEFAULT, 'wally/deepseek-ai/DeepSeek-V4.1-Flash');
    }
    now = 360_000;
    await adapter.getSupportedModels();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await adapter.getSupportedModels()).DEFAULT, 'nvidia/vendor/model');
  });
});

test('OpenCode does not restore a removed provider from an in-flight refresh', async () => {
  let home = '';
  await withOpenCodeHome(async (homeDir) => {
    home = homeDir;
    process.env.WALLY_API_KEY = 'test';
    await writeOpenCodeAuth(home, { nvidia: { type: 'api', key: 'test' } });
  }, async () => {
    let now = 0;
    let reads = 0;
    let finishRefresh: (models: string[]) => void = () => assert.fail('refresh not started');
    const listing = ['nvidia/vendor/model', 'wally/deepseek-ai/DeepSeek-V4.1-Flash'];
    const adapter = new OpenCodeProviderModels(() => {
      reads += 1;
      return reads === 2
        ? new Promise<string[]>((resolve) => { finishRefresh = resolve; })
        : Promise.resolve(listing);
    }, () => now);
    assert.equal((await adapter.getSupportedModels()).DEFAULT, listing[0]);
    now = 300_000;
    await adapter.getSupportedModels();
    await writeOpenCodeAuth(home, {});
    assert.equal((await adapter.getSupportedModels()).DEFAULT, listing[1]);
    finishRefresh(listing);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await adapter.getSupportedModels()).DEFAULT, listing[1]);
    assert.equal(reads, 3); // One bounded retry after the removal revision.
    now += 30_000;
    await adapter.getSupportedModels();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await adapter.getSupportedModels()).DEFAULT, listing[0]);
  });
});

test('OpenCode retries a failed CLI listing sooner than a successful one', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } }),
    async () => {
      let now = 0;
      let readCount = 0;
      const adapter = new OpenCodeProviderModels(
        async () => {
          readCount += 1;
          if (readCount === 1) {
            throw new Error('OpenCode unavailable');
          }
          return ['anthropic/claude-sonnet-5'];
        },
        () => now,
      );

      // Failure falls back to the connected-provider slice of the static catalog.
      const fallback = await adapter.getSupportedModels();
      assert.ok(fallback.OPTIONS.every((option) => option.value.startsWith('anthropic/')));

      now = 30_000;
      await adapter.getSupportedModels();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(readCount, 2);
      const recovered = await adapter.getSupportedModels();
      assert.deepEqual(recovered.OPTIONS.map((option) => option.value), ['anthropic/claude-sonnet-5']);
    },
  );
});

test('OpenCode keeps serving the last good listing when a refresh fails', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } }),
    async () => {
      let now = 0;
      let readCount = 0;
      const adapter = new OpenCodeProviderModels(
        async () => {
          readCount += 1;
          // The first refresh times out, as any listing can on a busy host.
          if (readCount === 2) {
            return [];
          }
          return readCount === 1 ? ['anthropic/claude-sonnet-5'] : ['anthropic/claude-opus-5'];
        },
        () => now,
      );
      const listedValues = async (): Promise<string[]> =>
        (await adapter.getSupportedModels()).OPTIONS.map((option) => option.value);

      assert.deepEqual(await listedValues(), ['anthropic/claude-sonnet-5']);

      // The failed refresh must not put the static catalog back in the picker...
      now = 5 * 60_000;
      await adapter.getSupportedModels();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(readCount, 2);
      assert.deepEqual(await listedValues(), ['anthropic/claude-sonnet-5']);
      // Reading the catalog again before the retry is due starts no listing.
      assert.equal(readCount, 2);

      // ...and is retried on the short schedule.
      now += 30_000;
      await adapter.getSupportedModels();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(readCount, 3);
      assert.deepEqual(await listedValues(), ['anthropic/claude-opus-5']);
    },
  );
});

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

/**
 * A stand-in for the real CLI, configured by the `fake.json` next to it:
 * `opencode models` prints `listing.txt` in one write and exits with
 * `exitCode` (default 0). `gated` makes it drop a `started` marker first and
 * wait for a `release` file, so a test can move a mocked clock while the
 * listing "runs"; it records a SIGTERM in `killed`, and with `partial` it
 * prints one model line before it waits, as a CLI killed at the budget may
 * already have. `cutUnlessFile` makes it print only the first 100 lines
 * unless its stdout is a regular file, which is what real OpenCode does into
 * a pipe that CloudCLI is too busy to read: it exited 0 after 85 of 373 lines
 * with the reader held up while it wrote, and after 75-306 of 358 on a
 * one-core host.
 */
const FAKE_OPENCODE_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const file = (name) => path.join(__dirname, name);
const config = JSON.parse(fs.readFileSync(file('fake.json'), 'utf8'));
const print = () => {
  let listing = fs.readFileSync(file('listing.txt'), 'utf8');
  if (config.cutUnlessFile && !fs.fstatSync(1).isFile()) {
    listing = listing.split('\\n').slice(0, 100).join('\\n');
  }
  fs.writeSync(1, listing);
  process.exit(config.exitCode ?? 0);
};
if (!config.gated) {
  print();
} else {
  process.on('SIGTERM', () => {
    fs.writeFileSync(file('killed'), '');
    process.exit(143);
  });
  if (config.partial) {
    fs.writeSync(1, 'openrouter/partial/model\\n');
  }
  fs.writeFileSync(file('started'), '');
  // Never outlive a broken test run (its cleanup deletes this directory).
  const giveUpAt = Date.now() + 30000;
  const poll = () => {
    if (!fs.existsSync(__dirname) || Date.now() > giveUpAt) {
      process.exit(1);
    }
    if (fs.existsSync(file('release'))) {
      print();
      return;
    }
    setTimeout(poll, 20);
  };
  poll();
}
`;

type FakeOpenCodeCliConfig = {
  gated?: boolean;
  partial?: boolean;
  cutUnlessFile?: boolean;
  exitCode?: number;
  /** Puts no `opencode` on PATH at all. */
  missing?: boolean;
};

type FakeOpenCodeCli = {
  /** Lets a gated `opencode models` print its listing and exit. */
  release: () => Promise<void>;
  waitForStart: () => Promise<void>;
  waitForKill: () => Promise<void>;
  /** Whatever the adapter left in the temp dir it was given, or (on Linux) still holds open there. */
  leftoverTempEntries: () => Promise<string[]>;
};

// The files under `dir` this process still has open, deleted ones included. Linux only; on Windows
// an open file keeps the adapter's cleanup from deleting it, so the entries show it there.
const openFilesUnder = async (dir: string): Promise<string[]> => {
  if (process.platform !== 'linux') {
    return [];
  }
  const prefix = `${await realpath(dir)}${path.sep}`;
  const targets = await Promise.all((await readdir('/proc/self/fd')).map(
    (fd) => readlink(path.join('/proc/self/fd', fd)).catch(() => ''),
  ));
  return targets.filter((target) => target.startsWith(prefix));
};

// Waits in real time (the budget tests mock only setTimeout, not setImmediate
// or Date) and fails instead of hanging when the fake never gets there.
const waitForFile = async (filePath: string, description: string): Promise<void> => {
  const giveUpAt = Date.now() + 15_000;
  while (!existsSync(filePath)) {
    if (Date.now() > giveUpAt) {
      assert.fail(`timed out waiting for ${description}`);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

/**
 * Runs `run` with the fake `opencode` first on PATH, and with os.tmpdir()
 * pointing at a fresh directory, so a test sees any temp file the adapter
 * leaves behind. The default reader runs the `opencode` it finds on PATH,
 * like production.
 */
const withFakeOpenCodeCli = async (
  listing: string,
  config: FakeOpenCodeCliConfig,
  run: (fake: FakeOpenCodeCli) => Promise<void>,
): Promise<void> => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-fake-cli-'));
  const tempDir = path.join(binDir, 'tmp');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  // os.tmpdir() reads TMPDIR on POSIX and TEMP/TMP on Windows, on every call.
  const tempKeys = ['TMPDIR', 'TMP', 'TEMP'].map(findEnvKey);
  const originalEnv = [pathKey, pathExtKey, ...tempKeys].map((key) => [key, process.env[key]] as const);
  const originalPath = process.env[pathKey];
  const originalPathExt = process.env[pathExtKey];
  const fake: FakeOpenCodeCli = {
    release: () => writeFile(path.join(binDir, 'release'), ''),
    waitForStart: () => waitForFile(path.join(binDir, 'started'), 'the fake `opencode models` to start'),
    waitForKill: () => waitForFile(path.join(binDir, 'killed'), 'the fake `opencode models` to get SIGTERM'),
    leftoverTempEntries: async () => [...await readdir(tempDir), ...await openFilesUnder(tempDir)],
  };

  try {
    await mkdir(tempDir);
    if (!config.missing) {
      const script = path.join(binDir, 'opencode.cjs');
      await writeFile(script, FAKE_OPENCODE_SCRIPT);
      await writeFile(path.join(binDir, 'fake.json'), JSON.stringify(config));
      await writeFile(path.join(binDir, 'listing.txt'), listing);
      if (process.platform === 'win32') {
        await writeFile(path.join(binDir, 'opencode.cmd'), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
        if (!originalPathExt?.toUpperCase().includes('.CMD')) {
          process.env[pathExtKey] = `.COM;.EXE;.BAT;.CMD${originalPathExt ? `;${originalPathExt}` : ''}`;
        }
      } else {
        // exec so the adapter's kill() on timeout reaches the node process itself.
        const wrapper = path.join(binDir, 'opencode');
        await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
        await chmod(wrapper, 0o755);
      }
    }
    process.env[pathKey] = config.missing ? binDir : `${binDir}${path.delimiter}${originalPath ?? ''}`;
    for (const key of tempKeys) {
      process.env[key] = tempDir;
    }

    await run(fake);
  } finally {
    // Lets a gated fake that is still polling exit right away.
    await fake.release().catch(() => {});
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    // On Windows a fake that outlived its kill can hold a file here a moment longer.
    await rm(binDir, { recursive: true, force: true, maxRetries: 10 });
  }
};

test('OpenCode waits for an `opencode models` listing that takes longer than 5 s', async () => {
  const listing = ['openrouter/qwen/qwen3-coder-flash', 'openrouter/google/gemini-3-pro-image-preview'];
  await withOpenCodeHome(async () => {}, () => withFakeOpenCodeCli(listing.join('\n'), { gated: true }, async (fake) => {
    // The adapter arms its timeout as soon as it spawns the CLI, so it must see the mocked setTimeout.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = new OpenCodeProviderModels().getSupportedModels();
      // Move the clock only once the CLI runs, i.e. once the timeout is armed.
      await fake.waitForStart();

      // On one core that another process also used, listing took from about 10 s to over 30 s. A
      // 5 s budget fell back to the static catalog there, which has none of the OpenRouter models of
      // a user whose key CloudCLI cannot see (#1695).
      mock.timers.tick(29_999);
      await fake.release();

      const models = await pending;
      assert.deepEqual(models.OPTIONS.map((option) => option.value), listing);
      assert.equal(models.DEFAULT, listing[0]);
    } finally {
      mock.timers.reset();
    }
  }));
});

test('OpenCode still gives up on, and kills, an `opencode models` that never answers', async () => {
  const listing = 'openrouter/qwen/qwen3-coder-flash\n';
  await withOpenCodeHome(async () => {}, () => withFakeOpenCodeCli(listing, { gated: true, partial: true }, async (fake) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = new OpenCodeProviderModels().getSupportedModels();
      await fake.waitForStart();

      mock.timers.tick(30_000);

      // The line the CLI printed before it was killed is not taken for a listing: no provider is
      // readable in this home, so the whole static catalog stands in.
      assert.deepEqual(await pending, OPENCODE_PREDEFINED_MODELS);
      // On Windows kill() ends the .cmd shim's cmd.exe, which does not signal the node behind it,
      // and that node still holds the listing file.
      if (process.platform !== 'win32') {
        await fake.waitForKill();
        assert.deepEqual(await fake.leftoverTempEntries(), []);
      }
    } finally {
      mock.timers.reset();
    }
  }));
});

test('OpenCode reads the whole listing of a CLI that exits as soon as it has written it', async () => {
  const listing = Array.from({ length: 5_000 }, (_, index) => `openrouter/vendor/model-${index}`);
  // A line that is not a model reference, and no newline after the last one.
  const output = ['Listing models', ...listing].join('\n');
  await withOpenCodeHome(async () => {}, () => withFakeOpenCodeCli(output, { cutUnlessFile: true }, async (fake) => {
    const values = (await new OpenCodeProviderModels().getSupportedModels()).OPTIONS.map((option) => option.value);

    assert.equal(values.length, listing.length);
    assert.deepEqual(values, listing);
    assert.deepEqual(await fake.leftoverTempEntries(), []);
  }));
});

test('OpenCode ignores the output of an `opencode models` that fails, and copes with none on PATH', async () => {
  const listing = 'openrouter/qwen/qwen3-coder-flash\n';
  for (const config of [{ exitCode: 1 }, { missing: true }]) {
    await withOpenCodeHome(async () => {}, () => withFakeOpenCodeCli(listing, config, async (fake) => {
      // A failed run may have printed only part of its listing.
      assert.deepEqual(await new OpenCodeProviderModels().getSupportedModels(), OPENCODE_PREDEFINED_MODELS);
      assert.deepEqual(await fake.leftoverTempEntries(), []);
    }));
  }
});

const writeOpenCodeSessionDatabase = async (homeDir: string, rows: Array<Record<string, unknown>>) => {
  const dbPath = path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db');
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE session (
        id text PRIMARY KEY,
        model text,
        agent text,
        directory text,
        time_created integer NOT NULL,
        time_updated integer NOT NULL
      );
    `);
    const insert = db.prepare(
      'INSERT INTO session (id, model, agent, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const [index, row] of rows.entries()) {
      insert.run(
        row.id,
        row.model,
        row.agent ?? null,
        row.directory ?? '/tmp/project',
        row.timeCreated ?? 1700000000000,
        row.timeUpdated ?? 1700000001000 + index,
      );
    }
  } finally {
    db.close();
  }
};

test('OpenCode composes the provider prefix into session model ids', async () => {
  // The lookup translates the app session id through the sessions database,
  // so point it at a throwaway file rather than the developer's real one.
  const tempSessionsDirectory = await mkdtemp(path.join(os.tmpdir(), 'opencode-session-model-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  try {
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempSessionsDirectory, 'auth.db');
    await initializeDatabase();
    // OpenCode stores the provider and model id in separate fields of the
    // session row ({"id":"z-ai/glm-5.3-flash","providerID":"openrouter"}), but
    // the CLI's `--model` flag only resolves the composed
    // `<providerID>/<modelID>` form. Resuming such a session without the prefix
    // fails with an unknown-model server error, which hits OpenRouter users
    // hardest because their model ids carry a slash themselves.
    await withOpenCodeHome(
      (homeDir) => writeOpenCodeSessionDatabase(homeDir, [
        {
          id: 'ses_openrouter',
          model: JSON.stringify({
            id: 'z-ai/glm-5.3-flash',
            providerID: 'openrouter',
            variant: 'default',
          }),
        },
        {
          id: 'ses_qualified',
          // An id that already carries the provider prefix must survive as-is.
          model: JSON.stringify({
            id: 'openrouter/z-ai/glm-5.3-flash',
            providerID: 'openrouter',
          }),
        },
        {
          id: 'ses_plain_string',
          model: 'opencode/gpt-5.6-terra',
        },
        {
          id: 'ses_github_copilot',
          model: JSON.stringify({
            id: 'gpt-5.6-terra',
            providerID: 'github-copilot',
          }),
        },
      ]),
      async (adapter) => {
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_openrouter')).model,
          'openrouter/z-ai/glm-5.3-flash',
        );
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_qualified')).model,
          'openrouter/z-ai/glm-5.3-flash',
        );
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_plain_string')).model,
          'opencode/gpt-5.6-terra',
        );
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_github_copilot')).model,
          'github-copilot/gpt-5.6-terra',
        );
      },
    );
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempSessionsDirectory, { recursive: true, force: true });
  }
});

// Review regressions use only injected model readers and synthetic local auth.
test('review: first discovery observes credential removal', async () => {
  let home = '';
  await withOpenCodeHome(async (dir) => {
    home = dir;
    process.env.WALLY_API_KEY = 'test';
    await writeOpenCodeAuth(home, { nvidia: { key: 'test' } });
  }, async () => {
    const adapter = new OpenCodeProviderModels(async () => {
      await writeOpenCodeAuth(home, {});
      return ['nvidia/test', 'wally/test'];
    });
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), ['wally/test']);
  });
});

test('review: reconnect refreshes pruned known provider before expiry', async () => {
  let home = '';
  await withOpenCodeHome(async (dir) => {
    home = dir; process.env.WALLY_API_KEY = 'test';
    await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
  }, async () => {
    let reads = 0;
    const adapter = new OpenCodeProviderModels(async () => {
      reads++; return ['anthropic/test', 'wally/test'];
    });
    await adapter.getSupportedModels();
    await writeOpenCodeAuth(home, {});
    await adapter.getSupportedModels();
    await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
    await adapter.getSupportedModels();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), ['anthropic/test', 'wally/test']);
    assert.equal(reads, 2);
  });
});

test('review: malformed auth preserves the last snapshot but empty auth removes', async () => {
  let home = '';
  await withOpenCodeHome(async (dir) => {
    home = dir; process.env.WALLY_API_KEY = 'test';
    await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
  }, async (adapter) => {
    await adapter.getSupportedModels();
    await writeFile(path.join(home, '.local/share/opencode/auth.json'), '{');
    assert.equal((await adapter.getSupportedModels()).DEFAULT, 'anthropic/test');
    await writeOpenCodeAuth(home, {});
    assert.equal((await adapter.getSupportedModels()).DEFAULT, 'wally/test');
  }, async () => ['anthropic/test', 'wally/test']);
});

test('review: static fallback does not restore a removed Wally provider', async () => {
  await withOpenCodeHome(async () => { process.env.WALLY_API_KEY = 'test'; }, async (adapter) => {
    await adapter.getSupportedModels();
    delete process.env.WALLY_API_KEY;
    const catalog = await adapter.getSupportedModels();
    assert.ok(catalog.OPTIONS.length > 0);
    assert.ok(catalog.OPTIONS.every(x => !x.value.startsWith('wally/')));
  });
});

test('review: healthy pending refresh preserves env-only models until failure', async () => {
  await withOpenCodeHome(async () => { process.env.WALLY_API_KEY = 'test'; }, async () => {
    let now = 0; let reads = 0;
    let finish: (value: string[]) => void = () => assert.fail('not started');
    const listing = ['nvidia/test', 'wally/test'];
    const adapter = new OpenCodeProviderModels(async () => {
      if (++reads === 1) return listing;
      return new Promise<string[]>(resolve => { finish = resolve; });
    }, () => now);
    await adapter.getSupportedModels(); now = 300_000;
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
    finish(listing); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
    now = 600_000;
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
    finish([]); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), ['wally/test']);
    now = 630_000;
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), ['wally/test']);
    finish([]); await new Promise(resolve => setImmediate(resolve));
  });
});

test('review: waiting request uses latest known-provider snapshot', async () => {
  let home = '';
  await withOpenCodeHome(async (dir) => {
    home = dir; await writeOpenCodeAuth(home, { wally: { key: 'test' } });
  }, async () => {
    let finish: (value: string[]) => void = () => assert.fail('not started');
    let started: () => void = () => {};
    const gate = new Promise<void>(resolve => { started = resolve; });
    let reads = 0;
    const adapter = new OpenCodeProviderModels(() => {
      if (++reads > 1) return Promise.resolve(['openai/test']);
      return new Promise<string[]>(resolve => { finish = resolve; started(); });
    });
    const older = adapter.getSupportedModels(); await gate;
    await writeOpenCodeAuth(home, { openai: { key: 'test' } });
    let captured: () => void = () => {};
    const snapshotCaptured = new Promise<void>(resolve => { captured = resolve; });
    const originalRead = fsPromises.readFile;
    const readMock = mock.method(fsPromises, 'readFile', async (
      file: Parameters<typeof fsPromises.readFile>[0], options: any,
    ) => {
      try { return await originalRead(file, options); }
      finally {
        if (String(file).endsWith('/opencode.jsonc')) captured();
      }
    });
    syncBuiltinESMExports();
    const newer = adapter.getSupportedModels();
    try {
      await snapshotCaptured;
      // The final config read has finished; drain its application microtasks.
      await new Promise(resolve => setImmediate(resolve));
    } finally {
      readMock.mock.restore(); syncBuiltinESMExports();
    }
    finish(['wally/test', 'openai/test']);
    const [a, b] = await Promise.all([older, newer]);
    assert.ok(a.OPTIONS.length > 0);
    assert.ok(a.OPTIONS.every(x => x.value.startsWith('openai/')));
    assert.deepEqual(a, b);
  });
});

test('review: credential capture order prevents stale logout eviction', async () => {
  let home = '';
  await withOpenCodeHome(async (dir) => {
    home = dir; process.env.WALLY_API_KEY = 'test';
    await writeOpenCodeAuth(home, { nvidia: { key: 'test' } });
  }, async () => {
    let reads = 0;
    const listing = ['nvidia/test', 'wally/test'];
    const adapter = new OpenCodeProviderModels(async () => { reads++; return listing; });
    await adapter.getSupportedModels();
    await writeOpenCodeAuth(home, {});
    let releaseAuth: () => void = () => {};
    let releaseConfig: () => void = () => {};
    let authReached: () => void = () => {};
    let configReached: () => void = () => {};
    const authSignal = new Promise<void>(r => { authReached = r; });
    const configSignal = new Promise<void>(r => { configReached = r; });
    const authGate = new Promise<void>(r => { releaseAuth = r; });
    const configGate = new Promise<void>(r => { releaseConfig = r; });
    let authHeld = false; let configHeld = false;
    const original = fsPromises.readFile;
    const readMock = mock.method(fsPromises, 'readFile', async (
      file: Parameters<typeof fsPromises.readFile>[0], options: any,
    ) => {
      if (!authHeld && String(file).endsWith('/auth.json')) {
        authHeld = true; authReached(); await authGate;
      } else if (!configHeld && String(file).endsWith('/config.json')) {
        configHeld = true; configReached(); await configGate;
      }
      return original(file, options);
    });
    syncBuiltinESMExports();
    const first = adapter.getSupportedModels();
    let second: Promise<unknown> | undefined;
    try {
      await authSignal;
      second = adapter.getSupportedModels(); await configSignal;
      await writeOpenCodeAuth(home, { nvidia: { key: 'test' } });
      releaseAuth(); await first;
      releaseConfig(); await second;
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
      assert.equal(reads, 1, 'stale logout must not evict and rediscover');
    } finally {
      releaseAuth(); releaseConfig(); await Promise.all([first, second]);
      readMock.mock.restore(); syncBuiltinESMExports();
    }
  });
});

test('review: revision change retries discovery without restoring the removed provider', async () => {
  let home = '';
  await withOpenCodeHome(async (dir) => {
    home = dir; process.env.WALLY_API_KEY = 'test';
    await writeOpenCodeAuth(home, { nvidia: { key: 'test' } });
  }, async () => {
    let now = 0; let reads = 0;
    let retried: () => void = () => {};
    const retryStarted = new Promise<void>(resolve => { retried = resolve; });
    let finish: (value: string[]) => void = () => assert.fail('not started');
    const adapter = new OpenCodeProviderModels(async () => {
      reads++;
      if (reads === 1) return ['nvidia/test', 'wally/test'];
      if (reads === 2) return new Promise<string[]>(resolve => { finish = resolve; });
      retried();
      return ['nvidia/test', 'proxy/test', 'wally/test'];
    }, () => now);
    await adapter.getSupportedModels(); now = 300_000;
    await adapter.getSupportedModels();
    await writeOpenCodeAuth(home, { proxy: { key: 'test' } });
    await adapter.getSupportedModels();
    finish(['proxy/test', 'wally/test']);
    // Baseline has no retry: one request deterministically exposes the missing result.
    await Promise.race([retryStarted, adapter.getSupportedModels().then(() => undefined)]);
    await new Promise(resolve => setImmediate(resolve));
    const result = await adapter.getSupportedModels();
    assert.deepEqual(result.OPTIONS.map(x => x.value), ['proxy/test', 'wally/test']);
    assert.equal(reads, 3);
  });
});

for (const source of ['auth', 'env', 'config'] as const) {
  test(`revision5: reconnect during pending refresh (${source})`, async () => {
    let home = '';
    const connect = async (enabled: boolean) => {
      if (source === 'auth') {
        await writeOpenCodeAuth(home, enabled ? { anthropic: { key: 'test' } } : {});
      } else if (source === 'env') {
        if (enabled) process.env.ANTHROPIC_API_KEY = 'test';
        else delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: enabled ? { anthropic: {} } : {} });
      }
    };
    await withOpenCodeHome(async (dir) => {
      home = dir;
      process.env.WALLY_API_KEY = 'test';
      await connect(true);
    }, async () => {
      let now = 0;
      let reads = 0;
      let finish: (listing: string[]) => void = () => assert.fail('refresh not started');
      const listing = ['anthropic/test', 'wally/test'];
      const adapter = new OpenCodeProviderModels(async () => {
        reads++;
        if (reads === 2) return new Promise<string[]>(resolve => { finish = resolve; });
        assert.ok(reads <= 3, 'reconnection must not spin or retry without bound');
        return listing;
      }, () => now);
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
      await connect(false);
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), ['wally/test']);
      now = 300_000;
      await adapter.getSupportedModels();
      assert.equal(reads, 2);
      await connect(true);
      await adapter.getSupportedModels();
      assert.equal(reads, 2, 'pending discovery must remain shared');
      finish(['wally/test']);
      await new Promise(resolve => setImmediate(resolve));
      await adapter.getSupportedModels();
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
      assert.equal(reads, 3, 'a discovery after reconnect is required');
      await adapter.getSupportedModels();
      assert.equal(reads, 3, 'stable credentials must not cause repeated discovery');
    });
  });
}

for (const invalid of ['null', '[]', '42']) {
  test(`revision5: invalid auth shape ${invalid} preserves snapshot`, async () => {
    let home = '';
    const listing = ['anthropic/test', 'wally/test'];
    await withOpenCodeHome(async (dir) => {
      home = dir;
      process.env.WALLY_API_KEY = 'test';
      await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
    }, async (adapter) => {
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
      const authPath = path.join(home, '.local/share/opencode/auth.json');
      await writeFile(authPath, invalid);
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
      await writeOpenCodeAuth(home, {});
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), ['wally/test']);
      await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
      await adapter.getSupportedModels();
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
      await rm(authPath);
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), ['wally/test']);
    }, async () => listing);
  });
}

test('revision5: reconnect churn during retry remains bounded', async () => {
  let home = '';
  await withOpenCodeHome(async (dir) => {
    home = dir;
    process.env.WALLY_API_KEY = 'test';
    await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
  }, async () => {
    let now = 0;
    let reads = 0;
    const listing = ['anthropic/test', 'wally/test'];
    let finish: (value: string[]) => void = () => assert.fail('refresh not started');
    const adapter = new OpenCodeProviderModels(async () => {
      reads++;
      assert.ok(reads <= 4, 'refresh must retry at most once during churn');
      if (reads === 2 || reads === 3) {
        return new Promise<string[]>(resolve => { finish = resolve; });
      }
      return listing;
    }, () => now);
    await adapter.getSupportedModels();
    await writeOpenCodeAuth(home, {});
    await adapter.getSupportedModels();
    now = 300_000;
    await adapter.getSupportedModels();
    await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
    await adapter.getSupportedModels();
    finish(['wally/test']);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 3, 'reconnect requires a new discovery');
    await writeOpenCodeAuth(home, {});
    await adapter.getSupportedModels();
    await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
    await adapter.getSupportedModels();
    finish(listing);
    await new Promise(resolve => setImmediate(resolve));
    // Churn during the one retry discards its listing and uses the short backoff.
    for (let i = 0; i < 3; i++) {
      assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), ['wally/test']);
      assert.equal(reads, 3);
    }
    now += 30_000;
    await adapter.getSupportedModels();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
    assert.equal(reads, 4);
  });
});

for (const source of ['auth', 'env', 'config'] as const) {
  test(`revision6: provider addition during concurrent first discovery (${source})`, async () => {
    let home = '';
    await withOpenCodeHome(async (dir) => {
      home = dir;
      process.env.WALLY_API_KEY = 'test';
    }, async () => {
      let reads = 0;
      let started: () => void = () => {};
      const listingStarted = new Promise<void>(resolve => { started = resolve; });
      let finish: (listing: string[]) => void = () => assert.fail('listing not started');
      const listing = ['anthropic/test', 'wally/test'];
      const adapter = new OpenCodeProviderModels(async () => {
        reads++;
        assert.ok(reads <= 2, 'first discovery must retry at most once');
        if (reads === 1) {
          return new Promise<string[]>(resolve => { finish = resolve; started(); });
        }
        return listing;
      }, () => 0);
      // Observe completion of the real snapshot update in the concurrent request.
      const originalUpdate = (adapter as any).updateProviderSnapshot.bind(adapter);
      let snapshots = 0;
      let applied: () => void = () => {};
      const snapshotApplied = new Promise<void>(resolve => { applied = resolve; });
      const updateMock = mock.method(adapter as any, 'updateProviderSnapshot', async () => {
        await originalUpdate();
        if (++snapshots === 2) applied();
      });
      const first = adapter.getSupportedModels();
      await listingStarted;
      if (source === 'auth') {
        await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
      } else if (source === 'env') {
        process.env.ANTHROPIC_API_KEY = 'test';
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: { anthropic: {} } });
      }
      const concurrent = adapter.getSupportedModels();
      await snapshotApplied;
      assert.equal(reads, 1, 'concurrent first requests must share the pending listing');
      finish(['wally/test']);
      try {
        for (const catalog of await Promise.all([first, concurrent])) {
          assert.deepEqual(catalog.OPTIONS.map(x => x.value), listing);
        }
        assert.equal(reads, 2, 'the new provider requires one fresh discovery');
        for (let i = 0; i < 3; i++) {
          assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
          assert.equal(reads, 2, 'stable credentials must not spin');
        }
      } finally {
        updateMock.mock.restore();
      }
    });
  });
}

for (const source of ['auth', 'env', 'config'] as const) {
  test(`revision7: provider addition during single-request first discovery (${source})`, async () => {
    let home = '';
    await withOpenCodeHome(async (dir) => {
      home = dir;
      process.env.WALLY_API_KEY = 'test';
    }, async () => {
      let reads = 0;
      let started: () => void = () => {};
      const listingStarted = new Promise<void>(resolve => { started = resolve; });
      let finish: (listing: string[]) => void = () => assert.fail('listing not started');
      const listing = ['anthropic/test', 'wally/test'];
      const adapter = new OpenCodeProviderModels(async () => {
        reads++;
        assert.ok(reads <= 2, 'first discovery must retry at most once');
        if (reads === 1) {
          return new Promise<string[]>(resolve => { finish = resolve; started(); });
        }
        return listing;
      }, () => 0);
      const pending = adapter.getSupportedModels();
      await listingStarted;
      if (source === 'auth') {
        await writeOpenCodeAuth(home, { anthropic: { key: 'test' } });
      } else if (source === 'env') {
        process.env.ANTHROPIC_API_KEY = 'test';
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: { anthropic: {} } });
      }
      // No other request observes the addition before the old listing resolves.
      finish(['wally/test']);
      assert.deepEqual((await pending).OPTIONS.map(x => x.value), listing);
      assert.equal(reads, 2, 'the same request must perform one fresh discovery');
      for (let i = 0; i < 3; i++) {
        assert.deepEqual((await adapter.getSupportedModels()).OPTIONS.map(x => x.value), listing);
        assert.equal(reads, 2, 'stable credentials must not spin');
      }
    });
  });
}
