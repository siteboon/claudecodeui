import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const originalProfileRoot = process.env.CLOUDCLI_BROWSER_USE_PROFILE_ROOT;
const testProfileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-profiles-'));
process.env.CLOUDCLI_BROWSER_USE_PROFILE_ROOT = testProfileRoot;

const {
  getProfilePath,
  normalizeDefaultProfileName,
  normalizeProfileName,
  PROFILE_ROOT,
  resolveSessionProfileName,
} = await import('@/modules/browser-use/browser-use.settings.js');

test.after(() => {
  if (originalProfileRoot === undefined) {
    delete process.env.CLOUDCLI_BROWSER_USE_PROFILE_ROOT;
  } else {
    process.env.CLOUDCLI_BROWSER_USE_PROFILE_ROOT = originalProfileRoot;
  }
  fs.rmSync(testProfileRoot, { recursive: true, force: true });
});

test('browser profile names are canonicalized before storage and path resolution', () => {
  assert.equal(normalizeProfileName(' Work Profile!! '), 'work-profile');
  assert.equal(normalizeProfileName(`${'-'.repeat(100)}Work Profile`), 'work-profile');
  assert.equal(normalizeDefaultProfileName(' Work Profile!! '), 'work-profile');
  assert.equal(
    getProfilePath(' Work Profile!! '),
    `${PROFILE_ROOT}/work-profile`,
  );
  assert.equal(
    resolveSessionProfileName({
      enabled: true,
      persistSessions: true,
      defaultProfileName: ' Work Profile!! ',
      browserBackend: 'playwright',
    }),
    'work-profile',
  );
});

test('browser profile aliases are rejected when the normalized profile already exists', () => {
  const profileName = `alias-test-${Date.now()}`;
  fs.mkdirSync(getProfilePath(profileName), { recursive: true });

  try {
    assert.throws(
      () => resolveSessionProfileName({
        enabled: true,
        persistSessions: false,
        defaultProfileName: 'default',
        browserBackend: 'playwright',
      }, profileName.toUpperCase()),
      /resolves to existing profile/,
    );
    assert.equal(
      resolveSessionProfileName({
        enabled: true,
        persistSessions: false,
        defaultProfileName: 'default',
        browserBackend: 'playwright',
      }, profileName),
      profileName,
    );
  } finally {
    fs.rmSync(getProfilePath(profileName), { recursive: true, force: true });
  }
});
