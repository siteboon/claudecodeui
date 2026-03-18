import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePassword } from '../server/utils/validation.js';

// Real modules — dynamically imported after setting DATABASE_PATH
let userDb, initializeDatabase, db;
let generateToken, authenticateToken;
let tmpDbPath;

before(async () => {
  tmpDbPath = path.join(os.tmpdir(), `test-auth-${Date.now()}-${process.pid}.db`);
  process.env.DATABASE_PATH = tmpDbPath;

  const dbMod = await import('../server/database/db.js');
  ({ userDb, initializeDatabase, db } = dbMod);
  await initializeDatabase();

  const authMod = await import('../server/middleware/auth.js');
  ({ generateToken, authenticateToken } = authMod);
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDbPath + suffix); } catch {}
  }
  delete process.env.DATABASE_PATH;
});

// Password validation (pure function from server/utils/validation.js)
describe('password validation', () => {
  test('rejects passwords shorter than 6 characters', () => {
    const result = validatePassword('abc', 'abc');
    assert.equal(result.ok, false);
    assert.match(result.error, /6 characters/);
  });

  test('rejects mismatched confirmation', () => {
    const result = validatePassword('validpass', 'different');
    assert.equal(result.ok, false);
    assert.match(result.error, /do not match/);
  });

  test('accepts valid matching password', () => {
    const result = validatePassword('validpass', 'validpass');
    assert.equal(result.ok, true);
  });
});

// Database password update (real userDb methods)
describe('database password update', () => {
  test('updatePassword changes hash and increments token_version', async () => {
    const hash = await bcrypt.hash('oldpassword', 4);
    const user = userDb.createUser('update-test-user', hash);
    assert.equal(user.token_version, 0);

    const newHash = await bcrypt.hash('newpassword123', 4);
    const success = userDb.updatePassword(user.id, newHash);
    assert.equal(success, true);

    const updated = userDb.getUserById(user.id);
    assert.equal(updated.token_version, 1);

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    const matches = await bcrypt.compare('newpassword123', row.password_hash);
    assert.equal(matches, true);
  });

  test('updatePassword returns false for nonexistent user', () => {
    const success = userDb.updatePassword(99999, 'somehash');
    assert.equal(success, false);
  });
});

// JWT token invalidation (real generateToken + authenticateToken middleware)
describe('JWT token invalidation', () => {
  test('token with old tokenVersion is rejected after password update', async () => {
    const hash = await bcrypt.hash('password1', 4);
    const user = userDb.createUser('jwt-stale-user', hash);

    const token = generateToken(user);

    // Simulate password reset — increments token_version
    const newHash = await bcrypt.hash('password2', 4);
    userDb.updatePassword(user.id, newHash);

    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
      setHeader() {},
    };
    let nextCalled = false;
    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /expired|log in again/i);
  });

  test('token with current tokenVersion is accepted', async () => {
    const hash = await bcrypt.hash('password1', 4);
    const user = userDb.createUser('jwt-valid-user', hash);

    const token = generateToken(user);

    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
      setHeader() {},
    };
    let nextCalled = false;
    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.user.id, user.id);
  });
});
