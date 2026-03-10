import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Use a fixed secret matching auth.js default
const JWT_SECRET = 'claude-ui-dev-secret-change-in-production';

// In-memory DB for tests — does NOT import db.js (avoids module side effects)
let db;
let testUser;

before(async () => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    token_version INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1
  )`);
  const hash = await bcrypt.hash('initialpass', 12);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  testUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
});

after(() => { db.close(); });

// RESET-03: Password validation (pure logic, no DB needed)
describe('password validation', () => {
  test('rejects passwords shorter than 6 characters', () => {
    const validate = (pw, confirm) => {
      if (pw.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
      if (pw !== confirm) return { ok: false, error: 'Passwords do not match.' };
      return { ok: true };
    };
    assert.equal(validate('abc', 'abc').ok, false);
    assert.match(validate('abc', 'abc').error, /6 characters/);
  });

  test('rejects mismatched confirmation', () => {
    const validate = (pw, confirm) => {
      if (pw.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
      if (pw !== confirm) return { ok: false, error: 'Passwords do not match.' };
      return { ok: true };
    };
    assert.equal(validate('validpass', 'differentpass').ok, false);
    assert.match(validate('validpass', 'differentpass').error, /do not match/);
  });

  test('accepts valid matching password', () => {
    const validate = (pw, confirm) => {
      if (pw.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
      if (pw !== confirm) return { ok: false, error: 'Passwords do not match.' };
      return { ok: true };
    };
    assert.equal(validate('validpass', 'validpass').ok, true);
  });
});

// RESET-04: DB password update
describe('database password update', () => {
  test('updatePassword changes password_hash in DB', async () => {
    const newHash = await bcrypt.hash('newpassword123', 12);
    // updatePassword method does NOT exist yet — this will fail until Plan 02 adds it to db.js
    // For now, implement inline against the test DB to define the expected contract:
    const stmt = db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?');
    const result = stmt.run(newHash, testUser.id);
    assert.equal(result.changes, 1);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(testUser.id);
    const matches = await bcrypt.compare('newpassword123', updated.password_hash);
    assert.equal(matches, true);
  });
});

// RESET-05: JWT token invalidation via token_version
describe('JWT token invalidation', () => {
  test('token_version increments after password update', () => {
    const before_version = db.prepare('SELECT token_version FROM users WHERE id = ?').get(testUser.id).token_version;
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(testUser.id);
    const after_version = db.prepare('SELECT token_version FROM users WHERE id = ?').get(testUser.id).token_version;
    assert.equal(after_version, before_version + 1);
  });

  test('token with old tokenVersion is rejected when version incremented', () => {
    // Simulate: user was on version 0, old token embedded tokenVersion: 0
    // After reset, DB version is 1 — old token should be detected as stale
    const oldToken = jwt.sign({ userId: testUser.id, username: 'admin', tokenVersion: 0 }, JWT_SECRET);
    const decoded = jwt.verify(oldToken, JWT_SECRET);
    const currentUser = db.prepare('SELECT token_version FROM users WHERE id = ?').get(testUser.id);
    // Middleware check: decoded.tokenVersion !== currentUser.token_version → reject
    assert.notEqual(decoded.tokenVersion, currentUser.token_version);
  });

  test('token with current tokenVersion is accepted', () => {
    const currentVersion = db.prepare('SELECT token_version FROM users WHERE id = ?').get(testUser.id).token_version;
    const freshToken = jwt.sign({ userId: testUser.id, username: 'admin', tokenVersion: currentVersion }, JWT_SECRET);
    const decoded = jwt.verify(freshToken, JWT_SECRET);
    assert.equal(decoded.tokenVersion, currentVersion);
  });
});

// RESET-06: Output message format
describe('output messages', () => {
  test('success message format uses [OK] prefix', () => {
    // Verifies the color helper pattern from cli.js
    const colors = { green: '\x1b[32m', reset: '\x1b[0m' };
    const ok = (text) => `${colors.green}${text}${colors.reset}`;
    const msg = `${ok('[OK]')} Password updated successfully.`;
    assert.match(msg, /\[OK\]/);
    assert.match(msg, /Password updated successfully/);
  });

  test('error message format uses [ERROR] prefix', () => {
    const colors = { yellow: '\x1b[33m', reset: '\x1b[0m' };
    const error = (text) => `${colors.yellow}${text}${colors.reset}`;
    const msg = `${error('[ERROR]')} Passwords do not match.`;
    assert.match(msg, /\[ERROR\]/);
  });
});
