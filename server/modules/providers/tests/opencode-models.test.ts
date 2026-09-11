import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  OpenCodeProviderModels,
  OPENCODE_PREDEFINED_MODELS,
} from '@/modules/providers/list/opencode/opencode-models.provider.js';

const OPENCODE_ENV_KEYS = ['OPENCODE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

/**
 * Builds the `providerID/modelID` + pretty-printed JSON records that
 * `opencode models --verbose` prints, from minimal per-model fixtures.
 */
const buildVerboseCliOutput = (
  models: { id: string; providerId: string; name?: string; variants?: string[]; status?: string }[],
): string => models.map((model) => [
  `${model.providerId}/${model.id}`,
  JSON.stringify({
    id: model.id,
    providerID: model.providerId,
    ...(model.name ? { name: model.name } : {}),
    ...(model.status ? { status: model.status } : {}),
    ...(model.variants
      ? { variants: Object.fromEntries(model.variants.map((variant) => [variant, {}])) }
      : {}),
  }, null, 2),
].join('\n')).join('\n');

/**
 * Runs one case against a throwaway OpenCode home, so the catalog the adapter
 * reports depends on the fixture rather than on the providers the machine
 * running the suite happens to be logged into.
 */
const withOpenCodeHome = async (
  setUp: (homeDir: string) => Promise<void>,
  runTest: (adapter: OpenCodeProviderModels) => Promise<void>,
  options: { runModelsCli?: () => Promise<string | null> } = {},
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
    // Default to "the CLI produced nothing" so file-probing fallback tests do
    // not spawn the real CLI from the developer machine running the suite.
    await runTest(new OpenCodeProviderModels({
      runModelsCli: options.runModelsCli ?? (async () => null),
    }));
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

test('OpenCode catalog reports user-defined providers from the CLI', async () => {
  // The curated catalog can never know a user's own providers, so the picker
  // only shows them because the adapter asks `opencode models --verbose`.
  const cliOutput = buildVerboseCliOutput([
    { id: 'gpt-5.6-sol', providerId: 'bit-openai', name: 'GPT 5.6 Sol', variants: ['low', 'xhigh', 'max'] },
    { id: 'deepseek-v4-pro', providerId: 'deepseek', name: 'DeepSeek V4 Pro' },
    { id: 'opencode/gpt-5.6-terra', providerId: 'opencode', name: 'GPT 5.6 Terra' },
  ]);

  await withOpenCodeHome(async () => {}, async (adapter) => {
    const catalog = await adapter.getSupportedModels();
    const byValue = new Map(catalog.OPTIONS.map((option) => [option.value, option]));

    const custom = byValue.get('bit-openai/gpt-5.6-sol');
    assert.ok(custom, 'user-defined provider model must reach the picker');
    assert.equal(custom.label, 'GPT 5.6 Sol');
    assert.equal(custom.description, 'bit-openai');
    assert.deepEqual(custom.effort?.values.map((entry) => entry.value), ['low', 'xhigh', 'max']);

    assert.ok(byValue.get('deepseek/deepseek-v4-pro'));
    assert.equal(byValue.get('deepseek/deepseek-v4-pro')?.effort, undefined);

    // A CLI id that already embeds a slash keeps its full value intact.
    assert.ok(byValue.get('opencode/opencode/gpt-5.6-terra'));
  }, { runModelsCli: async () => cliOutput });
});

test('OpenCode catalog prefers curated rows and CLI-listed models', async () => {
  const cliOutput = buildVerboseCliOutput([
    { id: 'gpt-5.6-terra', providerId: 'opencode' },
    { id: 'claude-fable-5', providerId: 'anthropic' },
    // A retired entry must never reach the picker.
    { id: 'gpt-4.9', providerId: 'openai', status: 'deprecated' },
  ]);

  await withOpenCodeHome(async () => {}, async (adapter) => {
    const catalog = await adapter.getSupportedModels();
    const values = catalog.OPTIONS.map((option) => option.value);

    assert.deepEqual(values, ['opencode/gpt-5.6-terra', 'anthropic/claude-fable-5']);
    // Curated metadata survives: curated labels and descriptions win over the
    // bare CLI record.
    const terra = catalog.OPTIONS.find((option) => option.value === 'opencode/gpt-5.6-terra');
    assert.equal(terra?.label, 'GPT 5.6 Terra');
    assert.equal(terra?.description, 'OpenCode Zen');
    assert.equal(catalog.DEFAULT, 'opencode/gpt-5.6-terra');
  }, { runModelsCli: async () => cliOutput });
});

test('OpenCode catalog default moves to a live model when curated default is absent', async () => {
  const cliOutput = buildVerboseCliOutput([
    { id: 'kimi-k2.6', providerId: 'volcengine-plan', name: 'Kimi K2.6' },
  ]);

  await withOpenCodeHome(async () => {}, async (adapter) => {
    const catalog = await adapter.getSupportedModels();
    assert.equal(catalog.DEFAULT, 'volcengine-plan/kimi-k2.6');
    assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
  }, { runModelsCli: async () => cliOutput });
});

test('OpenCode catalog shares one CLI run across concurrent lookups', async () => {
  let cliRuns = 0;
  const cliOutput = buildVerboseCliOutput([
    { id: 'glm-5.2', providerId: 'volcengine-plan', name: 'GLM 5.2' },
  ]);

  await withOpenCodeHome(async () => {}, async (adapter) => {
    const [first, second] = await Promise.all([
      adapter.getSupportedModels(),
      adapter.getCurrentActiveModel(),
    ]);
    assert.equal(cliRuns, 1);
    assert.equal(first.OPTIONS.length, 1);
    assert.equal(second.model, 'volcengine-plan/glm-5.2');
  }, { runModelsCli: async () => { cliRuns += 1; return cliOutput; } });
});

test('OpenCode exposes only the curated predefined catalog', async () => {
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
  assert.deepEqual([...providerIds].sort(), ['anthropic', 'opencode', 'opencode-go', 'openai'].sort());
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

test('OpenCode offers only models the install can route to', async () => {
  // Asking for a provider the user never connected fails the whole run with
  // "Model <id> is not valid", so an OpenCode Zen model must not be offered -
  // or defaulted to - on a machine that only holds an Anthropic key. This
  // covers the file-probing fallback taken when the CLI cannot answer.
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
      assert.equal(catalog.OPTIONS.length, 27);
      assert.equal(catalog.DEFAULT, 'opencode-go/grok-4.6');
      assert.ok(catalog.OPTIONS.some((option) => option.value === catalog.DEFAULT));
      assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
    },
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
  );
});
