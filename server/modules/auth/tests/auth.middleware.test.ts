// @ts-nocheck -- the middleware is untyped by design; these tests exercise it as Express does.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, userDb } from '@/modules/database/index.js';

// The middleware reads the signing secret at module load time and falls back to
// the database when JWT_SECRET is unset, so both must be pinned before the
// module graph is imported. Hence the dynamic import.
process.env.JWT_SECRET = 'auth-middleware-test-secret';
const {
  authenticateToken,
  authenticateDownloadToken,
  authenticateWebSocket,
  generateToken,
  generateDownloadToken,
} = await import('../auth.middleware.js');

const jwt = (await import('jsonwebtoken')).default;

function createResponse() {
  const state: { statusCode: number | null; body: unknown; headers: Record<string, string> } = {
    statusCode: null,
    body: null,
    headers: {},
  };
  const response = {
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return response;
    },
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      state.body = payload;
      return response;
    },
  };
  return { response, state };
}

async function withIsolatedDatabase(
  runTest: (user: { id: number; username: string }) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'auth-middleware-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const created = userDb.createUser('alice', 'hashed-password');
    await runTest({ id: Number(created.id), username: created.username });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('authenticateDownloadToken accepts a scoped token and exposes its claim', async () => {
  await withIsolatedDatabase(async (user) => {
    const token = generateDownloadToken(user, { projectId: 'project-1', path: 'docs/report.pdf' });
    const request = { query: { t: token } };
    const { response, state } = createResponse();
    let nextCalled = false;

    authenticateDownloadToken(request, response, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(state.statusCode, null);
    assert.deepEqual(request.downloadClaim, { projectId: 'project-1', path: 'docs/report.pdf' });
    assert.equal(request.user?.id, user.id);
  });
});

test('authenticateDownloadToken rejects a request with no token', async () => {
  const request = { query: {} };
  const { response, state } = createResponse();
  let nextCalled = false;

  authenticateDownloadToken(request, response, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(state.statusCode, 401);
});

test('authenticateDownloadToken rejects a session token presented as a download token', async () => {
  await withIsolatedDatabase(async (user) => {
    const request = { query: { t: generateToken(user) } };
    const { response, state } = createResponse();
    let nextCalled = false;

    authenticateDownloadToken(request, response, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(state.statusCode, 401);
  });
});

test('authenticateDownloadToken rejects an expired download token', async () => {
  await withIsolatedDatabase(async (user) => {
    const expiredToken = jwt.sign(
      { userId: user.id, username: user.username, scope: 'file-download', projectId: 'project-1', path: 'a.txt' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' },
    );
    const request = { query: { t: expiredToken } };
    const { response, state } = createResponse();
    let nextCalled = false;

    authenticateDownloadToken(request, response, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(state.statusCode, 401);
  });
});

test('authenticateDownloadToken rejects a token whose user no longer exists', async () => {
  await withIsolatedDatabase(async (user) => {
    const token = generateDownloadToken({ id: user.id + 999, username: 'ghost' }, {
      projectId: 'project-1',
      path: 'a.txt',
    });
    const request = { query: { t: token } };
    const { response, state } = createResponse();
    let nextCalled = false;

    authenticateDownloadToken(request, response, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(state.statusCode, 401);
  });
});

// Regression: the scope guard must not be so broad that it rejects real sessions.
test('authenticateToken still accepts an ordinary session token', async () => {
  await withIsolatedDatabase(async (user) => {
    const request = { headers: { authorization: `Bearer ${generateToken(user)}` }, query: {} };
    const { response, state } = createResponse();
    let nextCalled = false;

    await authenticateToken(request, response, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(state.statusCode, null);
    assert.equal(request.user?.username, 'alice');
  });
});

// Regression: a download token must never act as a session credential, on any
// transport authenticateToken reads.
test('authenticateToken rejects a download token as a Bearer credential and as a query token', async () => {
  await withIsolatedDatabase(async (user) => {
    const token = generateDownloadToken(user, { projectId: 'project-1', path: 'a.txt' });

    const bearerRequest = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const bearer = createResponse();
    let bearerNextCalled = false;
    await authenticateToken(bearerRequest, bearer.response, () => { bearerNextCalled = true; });

    assert.equal(bearerNextCalled, false);
    assert.equal(bearer.state.statusCode, 401);

    // Same guard has to hold for the SSE query-parameter transport.
    const queryRequest = { headers: {}, query: { token } };
    const query = createResponse();
    let queryNextCalled = false;
    await authenticateToken(queryRequest, query.response, () => { queryNextCalled = true; });

    assert.equal(queryNextCalled, false);
    assert.equal(query.state.statusCode, 401);
  });
});

test('authenticateWebSocket rejects a download token but accepts a session token', async () => {
  await withIsolatedDatabase(async (user) => {
    const downloadToken = generateDownloadToken(user, { projectId: 'project-1', path: 'a.txt' });

    assert.equal(authenticateWebSocket(downloadToken), null);
    assert.deepEqual(authenticateWebSocket(generateToken(user)), {
      userId: user.id,
      username: 'alice',
    });
  });
});
