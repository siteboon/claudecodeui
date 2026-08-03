import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PiPaths } from '@/modules/providers/list/pi/pi-paths.provider.js';
import { PROVIDER_WATCH_PATHS } from '@/modules/providers/services/sessions-watcher.service.js';

test('PROVIDER_WATCH_PATHS includes a pi entry for each Pi session root', () => {
  const piEntries = PROVIDER_WATCH_PATHS.filter((entry) => entry.provider === 'pi');
  assert.ok(piEntries.length > 0, 'expected at least one pi watch entry');

  const expectedRoots = new PiPaths().getSessionRoots();
  const watchedRoots = piEntries.map((entry) => entry.rootPath);
  for (const root of expectedRoots) {
    assert.ok(
      watchedRoots.includes(root),
      `expected PROVIDER_WATCH_PATHS to watch pi session root ${root}`
    );
  }
});
