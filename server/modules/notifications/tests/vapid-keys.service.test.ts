import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before, mock } from 'node:test';

// @ts-expect-error -- web-push does not provide declarations in this project.
import webPush from 'web-push';

import { closeConnection, getConnection, initializeDatabase, vapidKeysDb } from '@/modules/database/index.js';

const DEFAULT_VAPID_SUBJECT = 'https://github.com/siteboon/claudecodeui';

const previousDatabasePath = process.env.DATABASE_PATH;
const previousVapidSubject = process.env.VAPID_SUBJECT;
let temporaryDirectory = '';
let configureWebPush: () => void;

type ConfiguredWebPush = { subject: string; keys: { publicKey: string; privateKey: string }; warnings: string[] };

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'vapid-keys-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  await initializeDatabase();
  // Imported only after DATABASE_PATH points at the temporary database, as a guard: a service
  // version that opens the database while loading (as older ones did) must never reach a real one.
  ({ configureWebPush } = await import('../vapid-keys.service.js'));
});

after(async () => {
  closeConnection();
  setEnv('DATABASE_PATH', previousDatabasePath);
  setEnv('VAPID_SUBJECT', previousVapidSubject);
  await rm(temporaryDirectory, { recursive: true, force: true });
});

/** Runs the real configureWebPush() and reports the subject and key pair it handed to web-push. */
function configureWithSubject(
  vapidSubject: string | undefined,
  configure: () => void = configureWebPush,
): ConfiguredWebPush {
  setEnv('VAPID_SUBJECT', vapidSubject);
  const setVapidDetails = mock.method(webPush, 'setVapidDetails');
  const warnings: string[] = [];
  const warn = mock.method(console, 'warn', (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
  const log = mock.method(console, 'log', () => {});

  try {
    configure();
    assert.equal(setVapidDetails.mock.callCount(), 1);
    const [subject, publicKey, privateKey] = setVapidDetails.mock.calls[0].arguments as string[];
    return { subject, keys: { publicKey, privateKey }, warnings };
  } finally {
    setVapidDetails.mock.restore();
    warn.mock.restore();
    log.mock.restore();
  }
}

test('configureWebPush uses a public https subject that Apple accepts by default', () => {
  const { subject, warnings } = configureWithSubject(undefined);

  // Apple's push service answers 403 BadJwtToken for `.local` and localhost contacts.
  assert.equal(subject, DEFAULT_VAPID_SUBJECT);
  assert.doesNotMatch(subject, /\.local\b|localhost/);
  assert.deepEqual(warnings, []);
});

test('configureWebPush uses VAPID_SUBJECT when it is a mailto: address or https: URL', () => {
  assert.equal(configureWithSubject('mailto:ops@example.com').subject, 'mailto:ops@example.com');
  assert.equal(configureWithSubject('  https://example.com/contact  ').subject, 'https://example.com/contact');
});

test('configureWebPush falls back to the default subject for a blank VAPID_SUBJECT', () => {
  const { subject, warnings } = configureWithSubject('   ');

  assert.equal(subject, DEFAULT_VAPID_SUBJECT);
  assert.deepEqual(warnings, []);
});

test('configureWebPush ignores an invalid VAPID_SUBJECT with a warning instead of throwing', () => {
  for (const invalidSubject of ['ops@example.com', 'http://example.com', 'not a url']) {
    const { subject, warnings } = configureWithSubject(invalidSubject);

    assert.equal(subject, DEFAULT_VAPID_SUBJECT, invalidSubject);
    assert.equal(warnings.length, 1, invalidSubject);
    assert.match(warnings[0], /VAPID_SUBJECT/);
    assert.ok(warnings[0].includes(invalidSubject), invalidSubject);
  }
});

test('configureWebPush stores one VAPID key pair and reuses it after a restart', async () => {
  const beforeRestart = configureWithSubject(undefined);
  assert.deepEqual(vapidKeysDb.getVapidKeys(), beforeRestart.keys);

  // A fresh module instance has no cached keys, like a restarted server reading the same database.
  // A new key pair here would invalidate every existing browser subscription.
  const restartedService = await import(`../vapid-keys.service.js?restart=${Date.now()}`);
  const afterRestart = configureWithSubject(undefined, restartedService.configureWebPush);

  assert.deepEqual(afterRestart.keys, beforeRestart.keys);
  const { count } = getConnection().prepare('SELECT COUNT(*) AS count FROM vapid_keys').get() as { count: number };
  assert.equal(count, 1);
});
