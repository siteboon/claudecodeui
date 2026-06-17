import assert from 'node:assert/strict';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

test('browser monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});
