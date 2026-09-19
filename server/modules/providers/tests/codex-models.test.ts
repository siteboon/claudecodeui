import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexProviderModels } from '@/modules/providers/list/codex/codex-models.provider.js';
import type { CodexServerModel } from '@/modules/providers/list/codex/codex-app-server.client.js';

const CLI_MODELS: CodexServerModel[] = [
  {
    id: 'gpt-6-astra',
    displayName: 'GPT-6-Astra',
    description: 'Our most capable model for complex, demanding work.',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low' },
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
      { reasoningEffort: 'xhigh' },
      { reasoningEffort: 'max' },
      { reasoningEffort: 'ultra' },
    ],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-legacy',
    displayName: 'Legacy',
    hidden: true,
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
  },
  {
    id: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    description: 'Fast and affordable agentic coding model.',
    hidden: false,
    isDefault: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }],
    // A default outside the supported list must not reach the picker.
    defaultReasoningEffort: 'ultra',
  },
];

const adapterFor = (
  listModels: () => Promise<CodexServerModel[]>,
) => new CodexProviderModels({ listModels });

test('builds the catalog from the CLI answer, dropping hidden entries', async () => {
  const catalog = await adapterFor(async () => CLI_MODELS).getSupportedModels();

  assert.deepEqual(catalog.OPTIONS.map((option) => option.value), ['gpt-6-astra', 'gpt-5.6-luna']);
  assert.equal(catalog.DEFAULT, 'gpt-6-astra');

  const astra = catalog.OPTIONS[0];
  assert.equal(astra.label, 'GPT-6-Astra');
  assert.equal(astra.description, 'Our most capable model for complex, demanding work.');
  assert.deepEqual(astra.effort?.values.map((value) => value.value), ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(astra.effort?.default, 'medium');

  const luna = catalog.OPTIONS[1];
  assert.equal(luna.effort?.default, undefined);
});

test('falls back to the first entry when the CLI marks no default', async () => {
  const catalog = await adapterFor(async () => [
    { id: 'first-model', supportedReasoningEfforts: [] },
    { id: 'second-model' },
  ] as CodexServerModel[]).getSupportedModels();

  assert.equal(catalog.DEFAULT, 'first-model');
  assert.equal(catalog.OPTIONS[0].label, 'first-model');
  assert.equal(catalog.OPTIONS[0].effort, undefined);
});

test('surfaces the CLI failure instead of a curated fallback', async () => {
  const adapter = adapterFor(async () => {
    throw new Error('codex app-server did not answer');
  });

  await assert.rejects(() => adapter.getSupportedModels(), /did not answer/);
  // A failed run must not poison the cache: the next caller retries.
  await assert.rejects(() => adapter.getSupportedModels(), /did not answer/);
  const recovered = adapterFor(async () => [{ id: 'only-model' }] as CodexServerModel[]);
  assert.equal((await recovered.getSupportedModels()).DEFAULT, 'only-model');
});

test('treats an empty catalog as a failure', async () => {
  await assert.rejects(
    () => adapterFor(async () => []).getSupportedModels(),
    /no usable models/,
  );
});

test('shares one in-flight CLI run across concurrent callers', async () => {
  let calls = 0;
  const adapter = adapterFor(async () => {
    calls += 1;
    return [{ id: 'shared', isDefault: true }] as CodexServerModel[];
  });

  const [first, second] = await Promise.all([
    adapter.getSupportedModels(),
    adapter.getSupportedModels(),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.DEFAULT, second.DEFAULT);
});
