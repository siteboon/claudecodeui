import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { OpenCodeProviderModels } from '@/modules/providers/list/opencode/opencode-models.provider.js';

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
 * Runs one case against a throwaway OpenCode home so nothing reaches the
 * developer machine's own OpenCode state; the CLI itself is always the
 * fixture passed in via `runModelsCli`.
 */
const withOpenCodeHome = async (
  runTest: (adapter: OpenCodeProviderModels) => Promise<void>,
  runModelsCli: () => Promise<string | null>,
): Promise<void> => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-catalog-'));
  const originalHomedir = os.homedir;

  (os as any).homedir = () => homeDir;
  try {
    await runTest(new OpenCodeProviderModels({ runModelsCli }));
  } finally {
    (os as any).homedir = originalHomedir;
    await rm(homeDir, { recursive: true, force: true });
  }
};

test('OpenCode catalog reports user-defined providers from the CLI', async () => {
  // The picker only shows the user's own providers because the adapter asks
  // `opencode models --verbose` - nothing hardcoded could ever know them.
  const cliOutput = buildVerboseCliOutput([
    { id: 'gpt-5.6-sol', providerId: 'bit-openai', name: 'GPT 5.6 Sol', variants: ['low', 'xhigh', 'max'] },
    { id: 'deepseek-v4-pro', providerId: 'deepseek', name: 'DeepSeek V4 Pro' },
    { id: 'opencode/gpt-5.6-terra', providerId: 'opencode', name: 'GPT 5.6 Terra' },
  ]);

  await withOpenCodeHome(async (adapter) => {
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
  }, async () => cliOutput);
});

test('OpenCode catalog labels come from the CLI and drop retired models', async () => {
  const cliOutput = buildVerboseCliOutput([
    { id: 'gpt-5.6-terra', providerId: 'opencode' },
    { id: 'claude-fable-5', providerId: 'anthropic', name: 'Fable 5' },
    // A retired entry must never reach the picker.
    { id: 'gpt-4.9', providerId: 'openai', status: 'deprecated' },
  ]);

  await withOpenCodeHome(async (adapter) => {
    const catalog = await adapter.getSupportedModels();
    const values = catalog.OPTIONS.map((option) => option.value);

    assert.deepEqual(values, ['opencode/gpt-5.6-terra', 'anthropic/claude-fable-5']);
    // Without a `name` the label falls back to the model id with the provider
    // prefix stripped; a `name` wins verbatim.
    assert.equal(catalog.OPTIONS[0]?.label, 'gpt-5.6-terra');
    assert.equal(catalog.OPTIONS[0]?.description, 'opencode');
    assert.equal(catalog.OPTIONS[1]?.label, 'Fable 5');
    assert.equal(catalog.DEFAULT, 'opencode/gpt-5.6-terra');
  }, async () => cliOutput);
});

test('OpenCode catalog default moves to a live model when the preferred default is absent', async () => {
  const cliOutput = buildVerboseCliOutput([
    { id: 'kimi-k2.6', providerId: 'volcengine-plan', name: 'Kimi K2.6' },
  ]);

  await withOpenCodeHome(async (adapter) => {
    const catalog = await adapter.getSupportedModels();
    assert.equal(catalog.DEFAULT, 'volcengine-plan/kimi-k2.6');
    assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
  }, async () => cliOutput);
});

test('OpenCode catalog keeps the preferred default when the CLI lists it', async () => {
  const cliOutput = buildVerboseCliOutput([
    { id: 'kimi-k2.6', providerId: 'volcengine-plan', name: 'Kimi K2.6' },
    { id: 'gpt-5.6-terra', providerId: 'opencode', name: 'GPT 5.6 Terra' },
  ]);

  await withOpenCodeHome(async (adapter) => {
    const catalog = await adapter.getSupportedModels();
    assert.equal(catalog.DEFAULT, 'opencode/gpt-5.6-terra');
  }, async () => cliOutput);
});

test('OpenCode catalog shares one CLI run across concurrent lookups', async () => {
  let cliRuns = 0;
  const cliOutput = buildVerboseCliOutput([
    { id: 'glm-5.2', providerId: 'volcengine-plan', name: 'GLM 5.2' },
  ]);

  await withOpenCodeHome(async (adapter) => {
    const [first, second] = await Promise.all([
      adapter.getSupportedModels(),
      adapter.getCurrentActiveModel(),
    ]);
    assert.equal(cliRuns, 1);
    assert.equal(first.OPTIONS.length, 1);
    assert.equal(second.model, 'volcengine-plan/glm-5.2');
  }, async () => { cliRuns += 1; return cliOutput; });
});

test('OpenCode catalog is empty when the CLI cannot answer', async () => {
  // No hardcoded fallback: an unusable CLI yields an empty picker (plus the
  // console warning) rather than a curated list the install may not run.
  await withOpenCodeHome(async (adapter) => {
    assert.deepEqual(await adapter.getSupportedModels(), { OPTIONS: [], DEFAULT: '' });
  }, async () => null);

  // Unparseable output counts as no answer too.
  await withOpenCodeHome(async (adapter) => {
    assert.deepEqual(await adapter.getSupportedModels(), { OPTIONS: [], DEFAULT: '' });
  }, async () => 'not a catalog at all');
});
