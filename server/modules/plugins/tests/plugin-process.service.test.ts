import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startPluginServer, stopPluginServer } from '../plugin-process.service.js';

// A plugin server that records the environment it was started with, then
// reports ready the way a real one does.
const RECORDING_SERVER = `
const fs = require('node:fs');
fs.writeFileSync('env.json', JSON.stringify(process.env));
console.log(JSON.stringify({ ready: true, port: 1 }));
setInterval(() => {}, 1000);
`;

const HOST_ENV: Record<string, string> = {
  LANG: 'ru_RU.UTF-8',
  LANGUAGE: 'ru:en',
  LC_TIME: 'en_GB.UTF-8',
  CLOUDCLI_TEST_SECRET: 'must-not-leak',
};

test('plugin servers inherit the host locale and nothing else from its environment', async (t) => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-plugin-env-'));
  fs.writeFileSync(path.join(pluginDir, 'server.cjs'), RECORDING_SERVER);

  const saved = Object.fromEntries(Object.keys(HOST_ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, HOST_ENV);

  t.after(async () => {
    await stopPluginServer('env-probe');
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(pluginDir, { recursive: true, force: true });
  });

  await startPluginServer('env-probe', pluginDir, 'server.cjs');
  const env = JSON.parse(fs.readFileSync(path.join(pluginDir, 'env.json'), 'utf8'));

  assert.equal(env.LANG, 'ru_RU.UTF-8');
  assert.equal(env.LANGUAGE, 'ru:en');
  assert.equal(env.LC_TIME, 'en_GB.UTF-8');
  assert.equal(env.PLUGIN_NAME, 'env-probe');
  assert.equal(env.CLOUDCLI_TEST_SECRET, undefined);
});
