import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveAuthMode } from '../../../../shared/authConfig.js';
import { validateFrontendAuthMode } from '../services/auth-config.service.js';

test('frontend artifacts must match the running server authentication mode', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cloudcli-auth-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const normalMode = resolveAuthMode({});
  const bypassMode = resolveAuthMode({ DISABLE_AUTH: 'true' });
  const platformMode = resolveAuthMode({ VITE_IS_PLATFORM: 'true' });

  // Source-only checkouts use Vite, with no built frontend to serve.
  assert.doesNotThrow(() => validateFrontendAuthMode(directory, normalMode));
  writeFileSync(path.join(directory, 'index.html'), '<div id="root"></div>');
  assert.throws(() => validateFrontendAuthMode(directory, normalMode), /missing or invalid/);

  for (const frontendMode of [normalMode, bypassMode, platformMode]) {
    writeFileSync(path.join(directory, 'auth-config.json'), JSON.stringify(frontendMode));
    for (const serverMode of [normalMode, bypassMode, platformMode]) {
      if (frontendMode === serverMode) {
        assert.doesNotThrow(() => validateFrontendAuthMode(directory, serverMode));
      } else {
        assert.throws(() => validateFrontendAuthMode(directory, serverMode), /do not match/);
      }
    }
  }

  for (const invalid of ['{', 'null', '{}', '{"isPlatform":"false"}']) {
    writeFileSync(path.join(directory, 'auth-config.json'), invalid);
    assert.throws(() => validateFrontendAuthMode(directory, normalMode), /configuration is missing or invalid|settings do not match/);
  }
});
