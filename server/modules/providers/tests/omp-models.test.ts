/** Catalog parsing and subprocess-cache behavior. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseOmpModels, OMP_CONFIGURED_MODEL_SENTINEL, OmpProviderModels, readOmpContextWindow } from '@/modules/providers/list/omp/omp-models.provider.js';

describe('parseOmpModels', () => {
  it('maps selector/name, marks thinking models with effort, sentinel first, dedupes', () => {
    // Real omp shape: `thinking` is this model's own level array, OR null.
    const json = JSON.stringify({
      models: [
        { provider: 'openai', id: 'gpt-5.2', selector: 'openai/gpt-5.2', name: 'GPT-5.2', thinking: ['minimal', 'low', 'medium', 'high'], contextWindow: 400000 },
        { provider: 'anthropic', id: 'opus', selector: 'anthropic/opus', name: 'Claude Opus', thinking: null },
        { provider: 'openai', id: 'gpt-5.2', selector: 'openai/gpt-5.2', name: 'dup' }, // duplicate selector
      ],
    });
    const def = parseOmpModels(json);

    assert.equal(def.OPTIONS[0].value, OMP_CONFIGURED_MODEL_SENTINEL, 'sentinel first');
    assert.equal(def.DEFAULT, OMP_CONFIGURED_MODEL_SENTINEL);

    const gpt = def.OPTIONS.find((o) => o.value === 'openai/gpt-5.2')!;
    assert.equal(gpt.label, 'GPT-5.2');
    assert.equal(gpt.description, 'openai/gpt-5.2');
    assert.ok(gpt.effort, 'thinking model gets effort');
    // effort levels are exactly the model's own list (not a hardcoded 7).
    assert.deepEqual(gpt.effort!.values.map((v) => v.value), ['minimal', 'low', 'medium', 'high']);

    const opus = def.OPTIONS.find((o) => o.value === 'anthropic/opus')!;
    assert.equal(opus.effort, undefined, 'non-thinking model has no effort');

    assert.equal(def.OPTIONS.filter((o) => o.value === 'openai/gpt-5.2').length, 1, 'deduped');
  });

  it('falls back to sentinel-only on empty catalog', () => {
    assert.deepEqual(parseOmpModels('{"models":[]}').OPTIONS.map((o) => o.value), [OMP_CONFIGURED_MODEL_SENTINEL]);
  });
});

it('shares catalog loads, expires successes and holds failures before retrying', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omp-catalog-cache-'));
  const script = path.join(root, 'omp.cjs');
  const binary = process.platform === 'win32' ? path.join(root, 'omp.cmd') : script;
  const response = path.join(root, 'response.json');
  const calls = path.join(root, 'calls');
  const previousPath = process.env.OMP_PATH;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  try {
    await fs.writeFile(script, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, 'call\\n');
process.stdout.write(fs.readFileSync(${JSON.stringify(response)}, 'utf8'));
`, { mode: 0o755 });
    if (process.platform === 'win32') {
      await fs.writeFile(binary, `@"${process.execPath}" "${script}" %*\r\n`);
    }
    process.env.OMP_PATH = binary;
    await fs.writeFile(response, JSON.stringify({ models: [
      { provider: 'test', id: 'first', selector: 'test/first', contextWindow: 123_456 },
    ] }));
    const provider = new OmpProviderModels();
    const [first, concurrent, contextWindow] = await Promise.all([
      provider.getSupportedModels(),
      new OmpProviderModels().getSupportedModels(),
      readOmpContextWindow('test', 'first'),
    ]);
    assert.deepEqual(first.OPTIONS.map((option) => option.value), [OMP_CONFIGURED_MODEL_SENTINEL, 'test/first']);
    assert.deepEqual(concurrent, first);
    assert.equal(contextWindow, 123_456);
    assert.equal(await fs.readFile(calls, 'utf8'), 'call\n');

    await fs.writeFile(response, JSON.stringify({ models: [
      { provider: 'test', id: 'second', selector: 'test/second', contextWindow: 654_321 },
    ] }));
    now += 299_999;
    assert.deepEqual(await provider.getSupportedModels(), first);
    now += 1;
    const refreshed = await provider.getSupportedModels();
    assert.deepEqual(refreshed.OPTIONS.map((option) => option.value), [OMP_CONFIGURED_MODEL_SENTINEL, 'test/second']);
    assert.equal(await readOmpContextWindow('test', 'second'), 654_321);
    assert.equal(await fs.readFile(calls, 'utf8'), 'call\ncall\n');

    await fs.writeFile(response, 'malformed json');
    now += 300_000;
    assert.deepEqual((await provider.getSupportedModels()).OPTIONS.map((option) => option.value), [OMP_CONFIGURED_MODEL_SENTINEL]);
    await fs.writeFile(response, JSON.stringify({ models: [
      { provider: 'test', id: 'recovered', selector: 'test/recovered', contextWindow: 777_777 },
    ] }));
    now += 59_999;
    assert.equal(await readOmpContextWindow('test', 'recovered'), null);
    assert.deepEqual((await provider.getSupportedModels()).OPTIONS.map((option) => option.value), [OMP_CONFIGURED_MODEL_SENTINEL]);
    assert.equal(await fs.readFile(calls, 'utf8'), 'call\ncall\ncall\n');
    now += 1;
    assert.equal(await readOmpContextWindow('test', 'recovered'), 777_777);
    assert.deepEqual((await provider.getSupportedModels()).OPTIONS.map((option) => option.value), [OMP_CONFIGURED_MODEL_SENTINEL, 'test/recovered']);
    assert.equal(await fs.readFile(calls, 'utf8'), 'call\ncall\ncall\ncall\n');
  } finally {
    if (previousPath === undefined) delete process.env.OMP_PATH;
    else process.env.OMP_PATH = previousPath;
    await fs.rm(root, { recursive: true, force: true });
  }
});
