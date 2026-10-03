import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The middleware reads the JWT secret at module load, so the database has to
 * exist and point somewhere disposable before the import happens.
 */
async function withMiddleware(
  runTest: (authenticateToken: (req: unknown, res: unknown, next: () => void) => Promise<void>) => Promise<void>
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'auth-middleware-'));
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');

  // Dynamic on purpose: both modules open the database at import time, so the
  // disposable DATABASE_PATH above has to be in place before they load.
  const { closeConnection, initializeDatabase } = await import('@/modules/database/index.js');

  try {
    // Inside the try: a failed init or import must still restore
    // DATABASE_PATH and remove the temporary directory.
    await initializeDatabase();

    const { authenticateToken } = await import('@/modules/auth/index.js');
    await runTest(authenticateToken);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function captureWarnings(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  return { lines, restore: () => { console.warn = original; } };
}

test('a rejection logs a single line even when the request forges one', async () => {
  await withMiddleware(async (authenticateToken) => {
    const capture = captureWarnings();
    let nextCalled = false;
    const responseHeaders: Record<string, string> = {};
    let statusCode = 0;

    const req = {
      method: 'GET',
      baseUrl: '/api',
      path: '/projects',
      query: {},
      headers: {
        // A user agent is attacker-supplied: the newline would otherwise append
        // a second, invented log entry and the quote would close the ua field.
        'user-agent': 'Evil/1.0"\n[Auth] 401 forged GET /api/admin ua="innocent',
      },
    };
    const res = {
      setHeader(name: string, value: string) {
        responseHeaders[name] = value;
      },
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };

    try {
      await authenticateToken(req, res, () => {
        nextCalled = true;
      });
    } finally {
      capture.restore();
    }

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
    assert.equal(responseHeaders['X-Auth-Error'], 'invalid-token');

    assert.equal(capture.lines.length, 1);
    const [line] = capture.lines;
    assert.equal(line.includes('\n'), false);
    assert.equal(line.includes('forged'), true, 'the text survives, only its framing is neutralised');
    assert.match(line, /^\[Auth\] 401 no-token GET \/api\/projects ua="Evil\/1\.0'/);
    // Exactly one ua field, so the injected one did not become a field of its own.
    assert.equal(line.split('ua="').length - 1, 1);
  });
});
