import assert from 'node:assert/strict';
import test from 'node:test';

import { startPluginServer } from '../plugin-process.service.js';

test('startPluginServer rejects an entry point outside the installation directory', async () => {
  await assert.rejects(
    startPluginServer('unsafe-extension', '/tmp/cloudcli-plugins/unsafe-extension', '../outside.js'),
    /Server entry must stay inside its installation directory/,
  );
});
