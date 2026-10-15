import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { CODEX_PREDEFINED_MODELS, CodexProviderModels } from '@/modules/providers/list/codex/codex-models.provider.js';

test('model discovery paginates and maps future models and efforts without opening a thread', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-models-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = path.join(dir, 'codex.cjs');
  const realSpawn = childProcess.spawn;
  // Stub the process boundary, not model/list: exercise the actual RPC transport.
  const spawn = t.mock.method(childProcess, 'spawn', (...[command, args, options]: Parameters<typeof childProcess.spawn>) => {
    assert.equal(command, process.execPath);
    assert.equal(args?.at(-1), 'app-server');
    return realSpawn(process.execPath, [cli, 'app-server'], options ?? {});
  });
  syncBuiltinESMExports();
  t.after(() => {
    spawn.mock.restore();
    syncBuiltinESMExports();
  });
  await writeFile(cli, `#!${process.execPath}
const readline = require('node:readline');
if (process.argv[2] !== 'app-server') process.exit(1);
let initialized = false;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialized') { initialized = true; return; }
  let result;
  if (m.method === 'initialize') result = {};
  else if (initialized && m.method === 'model/list' && m.params.includeHidden === false) {
    result = m.params.cursor === 'page-2'
      ? { data: [{ id: 'catalog-id', model: 'future-model', displayName: 'Future Model', description: 'From CLI', isDefault: true,
          defaultReasoningEffort: 'future-effort', supportedReasoningEfforts: [
            { reasoningEffort: 'future-effort', description: 'From CLI effort' }
          ] }], nextCursor: null }
      : { data: [{ model: 'first' }, { model: 'hidden', hidden: true, isDefault: true }, {}], nextCursor: 'page-2' };
  } else { process.exit(2); }
  process.stdout.write(JSON.stringify({ id: m.id, result }) + '\\n');
});
`);
  const models = await codexAppServer.listModels();
  assert.equal(models.DEFAULT, 'future-model');
  assert.deepEqual(models.OPTIONS.map((model) => model.value), ['first', 'future-model']);
  assert.equal(models.OPTIONS[0].label, 'first');
  assert.deepEqual(models.OPTIONS[1], {
    value: 'future-model', label: 'Future Model', description: 'From CLI',
    effort: { default: 'future-effort', values: [{ value: 'future-effort', description: 'From CLI effort' }] },
  });

  // An empty catalog must not replace the adapter's usable fallback.
  await writeFile(cli, `#!${process.execPath}
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.id) process.stdout.write(JSON.stringify({id:m.id,result:{data:[],nextCursor:null}})+'\\n');
});
`);
  await assert.rejects(codexAppServer.listModels(), /no visible models/);

  for (const [result, expected] of [
    [{ data: [{ model: 'only-model' }], nextCursor: null }, 'only-model'],
    [{ data: 'invalid' }, /invalid model catalog/],
    [{ data: [{ model: 'only-model' }], nextCursor: 'repeated' }, /repeated.*cursor/],
  ] as const) {
    await writeFile(cli, `#!${process.execPath}
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.id) process.stdout.write(JSON.stringify({id:m.id,result:${JSON.stringify(result)}})+'\\n');
});
`);
    if (typeof expected === 'string') {
      assert.equal((await codexAppServer.listModels()).DEFAULT, expected);
    } else {
      await assert.rejects(codexAppServer.listModels(), expected);
    }
  }
});

test('concurrent catalog requests share discovery and refresh after the cache expires', async (t) => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const catalog = { OPTIONS: [{ value: 'new-cli-model', label: 'New CLI Model' }], DEFAULT: 'new-cli-model' };
  const discovery = t.mock.method(codexAppServer, 'listModels', async () => catalog);
  const adapter = new CodexProviderModels();
  const results = await Promise.all([adapter.getSupportedModels(), adapter.getSupportedModels()]);
  assert.deepEqual(results, [catalog, catalog]);
  await adapter.getSupportedModels();
  assert.equal(discovery.mock.callCount(), 1);
  now += 60_001;
  await adapter.getSupportedModels();
  assert.equal(discovery.mock.callCount(), 2);
});

test('failed discovery retains the last successful catalog and retries after expiry', async (t) => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'warn', () => {});
  let fail = false;
  const catalog = { OPTIONS: [{ value: 'new-cli-model', label: 'New CLI Model' }], DEFAULT: 'new-cli-model' };
  const discovery = t.mock.method(codexAppServer, 'listModels', async () => {
    if (fail) throw new Error('CLI unavailable');
    return catalog;
  });
  const adapter = new CodexProviderModels();
  assert.deepEqual(await adapter.getSupportedModels(), catalog);
  now += 60_001;
  fail = true;
  assert.deepEqual(await adapter.getSupportedModels(), catalog);
  await adapter.getSupportedModels();
  assert.equal(discovery.mock.callCount(), 2);
  now += 60_001;
  fail = false;
  assert.deepEqual(await adapter.getSupportedModels(), catalog);
  assert.equal(discovery.mock.callCount(), 3);
});

test('first discovery failure uses the bundled catalog rather than breaking the picker', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(codexAppServer, 'listModels', async () => { throw new Error('CLI unavailable'); });
  assert.deepEqual(await new CodexProviderModels().getSupportedModels(), CODEX_PREDEFINED_MODELS);
});
