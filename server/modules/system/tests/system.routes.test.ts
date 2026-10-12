import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';

import type { createSystemRouter } from '../system.routes.js';

const JWT_SECRET = 'system-routes-test-secret';
const previousEnvironment = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  JWT_SECRET: process.env.JWT_SECRET,
  VITE_IS_PLATFORM: process.env.VITE_IS_PLATFORM,
};

/** Signs an HS256 session token the way the auth module does, with the test's secret. */
function signSessionToken(claims: { userId: number; username: string }): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ ...claims, iat: issuedAt, exp: issuedAt + 3600 })}`;
  return `${unsigned}.${createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')}`;
}

/**
 * The auth middleware and the shared Platform flag are read while their modules
 * are first imported, so the isolated database, the self-hosted mode and a
 * known secret have to be in place before any server module loads (the
 * developer shell may export Platform mode or point DATABASE_PATH at a real
 * install).
 */
async function setUpFixture(directory: string) {
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.VITE_IS_PLATFORM = 'false';
  const snapshotParent = path.join(directory, 'snapshots');
  await mkdir(snapshotParent);

  const { authenticateToken } = await import('@/modules/auth/index.js');
  const database = await import('@/modules/database/index.js');
  const { AppError } = await import('@/shared/utils.js');
  const { createSystemStorageService } = await import('../system-storage.service.js');
  const { createSystemRouter: createRouter } = await import('../system.routes.js');
  const { createSystemModule } = await import('../index.js');

  await database.initializeDatabase();
  const user = database.userDb.createUser('route-user', 'password-hash');
  database.projectsDb.createProjectPath('/workspace/route-project', 'Route Project');

  return {
    AppError,
    authenticateToken,
    closeConnection: database.closeConnection,
    createSystemModule,
    createSystemRouter: createRouter,
    createSystemStorageService,
    directory,
    getConnection: database.getConnection,
    snapshotParent,
    token: signSessionToken({ userId: Number(user.id), username: user.username }),
  };
}

// Both are assigned in before(), not at the top level: a failing import there
// would end the file before after() runs and leak the fixture directory.
let fixtureDirectory: string | undefined;
let fixture!: Awaited<ReturnType<typeof setUpFixture>>;

before(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'system-routes-'));
  fixture = await setUpFixture(fixtureDirectory);
});

after(async () => {
  fixture?.closeConnection();
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  if (fixtureDirectory) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

type SystemRouterServices = Parameters<typeof createSystemRouter>[0];

function createServices(options: { isPlatform?: boolean; onBackup?: () => void } = {}): SystemRouterServices {
  return {
    systemUpdateService: {
      updateSystem: async () => {
        throw new Error('Unexpected update');
      },
    },
    systemStorageService: fixture.createSystemStorageService({
      isPlatform: options.isPlatform ?? false,
      getDatabasePath: () => process.env.DATABASE_PATH ?? '',
      getAssetsPath: () => path.join(fixture.directory, 'assets'),
      backupDatabase: (destinationPath) => {
        options.onBackup?.();
        return fixture.getConnection().backup(destinationPath);
      },
      temporaryDirectory: fixture.snapshotParent,
      now: () => new Date('2026-10-12T18:30:05.000Z'),
    }),
  };
}

/**
 * Mounts `router` like server/index.ts mounts the system module: behind
 * authenticateToken at /api/system, followed by the same AppError response shape.
 */
async function withSystemServer(
  router: express.Router,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use('/api/system', fixture.authenticateToken, router);
  app.use((error: unknown, _request: ExpressRequest, response: ExpressResponse, _next: NextFunction) => {
    if (error instanceof fixture.AppError) {
      response.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function authorized(): RequestInit {
  return { headers: { Authorization: `Bearer ${fixture.token}` } };
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: { code?: string } }).error?.code;
}

/** Opens a downloaded snapshot and returns its user names, after checking that it is a sound SQLite file. */
function readSnapshotUsernames(contents: Buffer): string[] {
  const snapshot = new Database(contents, { readonly: true });
  try {
    assert.equal(snapshot.pragma('integrity_check', { simple: true }), 'ok');
    return (snapshot.prepare('SELECT username FROM users').all() as { username: string }[])
      .map((row) => row.username);
  } finally {
    snapshot.close();
  }
}

test('backup and storage routes reject requests without a valid token', async () => {
  let backupCalls = 0;
  const router = fixture.createSystemRouter(createServices({ onBackup: () => { backupCalls += 1; } }));
  await withSystemServer(router, async (baseUrl) => {
    for (const route of ['/api/system/backup', '/api/system/storage']) {
      const anonymous = await fetch(`${baseUrl}${route}`);
      assert.equal(anonymous.status, 401, route);
      assert.equal(((await anonymous.json()) as { code?: string }).code, 'AUTH_TOKEN_INVALID');

      const forged = await fetch(`${baseUrl}${route}`, { headers: { Authorization: 'Bearer not-a-token' } });
      assert.equal(forged.status, 401, route);
    }
  });

  assert.equal(backupCalls, 0);
});

test('an authenticated request downloads a consistent, uncached database snapshot', async () => {
  await withSystemServer(fixture.createSystemRouter(createServices()), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/system/backup`, authorized());

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-disposition'),
      'attachment; filename="cloudcli-backup-2026-10-12T18-30-05Z.db"',
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/vnd.sqlite3');

    const snapshot = new Database(Buffer.from(await response.arrayBuffer()), { readonly: true });
    try {
      assert.deepEqual(snapshot.prepare('SELECT username FROM users').all(), [{ username: 'route-user' }]);
      assert.deepEqual(
        snapshot.prepare('SELECT project_path FROM projects').all(),
        [{ project_path: '/workspace/route-project' }],
      );
    } finally {
      snapshot.close();
    }
  });

  assert.deepEqual(await readdir(fixture.snapshotParent), []);
});

test('an authenticated request reads the resolved storage locations', async () => {
  await withSystemServer(fixture.createSystemRouter(createServices()), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/system/storage`, authorized());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      databasePath: path.join(fixture.directory, 'auth.db'),
      assetsPath: path.join(fixture.directory, 'assets'),
    });
  });
});

test('platform installs answer 403 even for an authenticated request', async () => {
  let backupCalls = 0;
  const router = fixture.createSystemRouter(createServices({ isPlatform: true, onBackup: () => { backupCalls += 1; } }));
  await withSystemServer(router, async (baseUrl) => {
    for (const route of ['/api/system/backup', '/api/system/storage']) {
      const response = await fetch(`${baseUrl}${route}`, authorized());
      assert.equal(response.status, 403, route);
      assert.equal(await readErrorCode(response), 'PLATFORM_MANAGED_STORAGE', route);
    }
  });

  assert.equal(backupCalls, 0);
});

// The tests below build the router through the real createSystemModule, the
// way server/index.ts does, so the Platform flag, the live connection and the
// database path it wires into the storage service are covered too.

test('the system module refuses storage locations and backups on Platform installs', async () => {
  const router = fixture.createSystemModule({ appRoot: fixture.directory, installMode: 'npm', isPlatform: true });
  await withSystemServer(router, async (baseUrl) => {
    for (const route of ['/api/system/backup', '/api/system/storage']) {
      const response = await fetch(`${baseUrl}${route}`, authorized());
      assert.equal(response.status, 403, route);
      assert.equal(await readErrorCode(response), 'PLATFORM_MANAGED_STORAGE', route);
    }
  });
});

test('the self-hosted system module reports this database and backs up its live connection', async () => {
  const router = fixture.createSystemModule({ appRoot: fixture.directory, installMode: 'npm', isPlatform: false });
  await withSystemServer(router, async (baseUrl) => {
    const storage = await fetch(`${baseUrl}/api/system/storage`, authorized());
    assert.equal(storage.status, 200);
    assert.deepEqual(await storage.json(), {
      databasePath: path.join(fixture.directory, 'auth.db'),
      assetsPath: path.join(homedir(), '.cloudcli', 'assets'),
    });

    const requestedAt = Date.now();
    const backup = await fetch(`${baseUrl}/api/system/backup`, authorized());
    const respondedAt = Date.now();
    assert.equal(backup.status, 200);
    const contents = Buffer.from(await backup.arrayBuffer());
    assert.ok(contents.length > 0, 'the backup must not be empty');
    assert.deepEqual(readSnapshotUsernames(contents), ['route-user']);

    // The file is named after the moment it was taken (to the second).
    const stamp = /filename="cloudcli-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.db"/
      .exec(backup.headers.get('content-disposition') ?? '');
    assert.ok(stamp, `unexpected Content-Disposition: ${backup.headers.get('content-disposition')}`);
    const takenAt = Date.parse(`${stamp[1]}T${stamp[2]}:${stamp[3]}:${stamp[4]}Z`);
    assert.ok(takenAt >= requestedAt - 1000 && takenAt <= respondedAt, `backup named ${stamp[0]}`);
  });
});

test('the self-hosted system module stages its snapshot only in the OS temp directory', async () => {
  // os.tmpdir() follows TMPDIR on POSIX and TEMP/TMP on Windows. Pointing them at
  // a missing folder must make the backup fail, not write the copy of the
  // credential database somewhere else.
  const temporaryVariables = ['TMPDIR', 'TMP', 'TEMP'] as const;
  const previousTemporaryVariables = temporaryVariables.map((name) => process.env[name]);
  const missingDirectory = path.join(fixture.directory, 'missing-temp-directory');
  for (const name of temporaryVariables) {
    process.env[name] = missingDirectory;
  }

  try {
    const router = fixture.createSystemModule({ appRoot: fixture.directory, installMode: 'npm', isPlatform: false });
    await withSystemServer(router, async (baseUrl) => {
      const backup = await fetch(`${baseUrl}/api/system/backup`, authorized());
      assert.equal(backup.status, 500);
      assert.equal(await readErrorCode(backup), 'INTERNAL_ERROR');
    });
  } finally {
    temporaryVariables.forEach((name, index) => {
      const value = previousTemporaryVariables[index];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});
