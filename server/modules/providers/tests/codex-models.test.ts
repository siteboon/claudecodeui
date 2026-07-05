import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Codex models provider reads model_catalog_json from config.toml', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'codex-models-'));

  try {
    process.env.HOME = tempHome;
    const codexDir = path.join(tempHome, '.codex');
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      path.join(codexDir, 'config.toml'),
      'model = "custom/alpha"\nmodel_catalog_json = "catalog.json"\n',
      'utf8',
    );
    await writeFile(
      path.join(codexDir, 'catalog.json'),
      JSON.stringify({
        models: [
          { slug: 'custom/alpha', displayName: 'Custom Alpha', hidden: false },
          { slug: 'custom/hidden', displayName: 'Hidden', hidden: true },
        ],
      }),
      'utf8',
    );

    const { CodexProviderModels } = await import(
      `../list/codex/codex-models.provider.js?codex-test=${Date.now()}`
    );
    const provider = new CodexProviderModels();
    const models = await provider.getSupportedModels();
    const active = await provider.getCurrentActiveModel();

    assert.deepEqual(models.OPTIONS.map((option: { value: string }) => option.value), ['custom/alpha']);
    assert.equal(models.OPTIONS[0]?.label, 'Custom Alpha');
    assert.equal(models.DEFAULT, 'custom/alpha');
    assert.equal(active.model, 'custom/alpha');
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(tempHome, { recursive: true, force: true });
  }
});
