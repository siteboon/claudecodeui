import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';

// The auth middleware reads the platform flag and the JWT secret while it is
// first imported, so the isolated database, the self-hosted mode and a known
// secret have to be in place before any server module loads (the developer
// shell may export Platform mode or point DATABASE_PATH at a real install).
const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'system-routes-'));
const snapshotParent = path.join(fixtureDirectory, 'snapshots');
await mkdir(snapshotParent);
const JWT_SECRET = 'system-routes-test-secret';
const previousEnvironment = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  JWT_SECRET: process.env.JWT_SECRET,
  VITE_IS_PLATFORM: process.env.VITE_IS_PLATFORM,
};
process.env.DATABASE_PATH = path.join(fixtureDirectory, 'auth.db');
process.env.JWT_SECRET = JWT_SECRET;
process.env.VITE_IS_PLATFORM = 'false';

const { authenticateToken } = await import('@/modules/auth/index.js');
const {
  closeConnection,
  getConnection,
  initializeDatabase,
  projectsDb,
  userDb,
} = await import('@/modules/database/index.js');
const { createSystemStorageService } = await import('../system-storage.service.js');
const { createSystemRouter } = await import('../system.routes.js');

await initializeDatabase();
const user = userDb.createUser('route-user', 'password-hash');
projectsDb.createProjectPath('/workspace/route-project', 'Route Project');
const token = signSessionToken({ userId: Number(user.id), username: user.username });

/** Signs an HS256 session token the way the auth module does, with the test's secret. */
function signSessionToken(claims: { userId: number; username: string }): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ ...claims, iat: issuedAt, exp: issuedAt + 3600 })}`;
  return `${unsigned}.${createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')}`;
}

after(async () => {
  closeConnection();
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await rm(fixtureDirectory, { recursive: true, force: true });
});

type SystemRouterServices = Parameters<typeof createSystemRouter>[0];

function createServices(options: { isPlatform?: boolean; onBackup?: () => void } = {}): SystemRouterServices {
  return {
    systemUpdateService: {
      updateSystem: async () => {
        throw new Error('Unexpected update');
      },
    },
    systemStorageService: createSystemStorageService({
      isPlatform: options.isPlatform ?? false,
      getDatabasePath: () => process.env.DATABASE_PATH ?? '',
      getAssetsPath: () => path.join(fixtureDirectory, 'assets'),
      backupDatabase: (destinationPath) => {
        options.onBackup?.();
        return getConnection().backup(destinationPath);
      },
      temporaryDirectory: snapshotParent,
      now: () => new Date('2026-10-12T18:30:05.000Z'),
    }),
  };
}

/** Mounts the router exactly like server/index.ts: behind authenticateToken at /api/system. */
async function withSystemServer(
  services: SystemRouterServices,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  // Keeps Express's fallback error handler from printing the expected 403 stack traces.
  app.set('env', 'test');
  app.use('/api/system', authenticateToken, createSystemRouter(services));

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

test('backup and storage routes reject requests without a valid token', async () => {
  let backupCalls = 0;
  await withSystemServer(createServices({ onBackup: () => { backupCalls += 1; } }), async (baseUrl) => {
    for (const route of ['/api/system/backup', '/api/system/storage']) {
      const anonymous = await fetch(`${baseUrl}${route}`);
      assert.equal(anonymous.status, 401, route);
      assert.equal((await anonymous.json()).code, 'AUTH_TOKEN_INVALID');

      const forged = await fetch(`${baseUrl}${route}`, { headers: { Authorization: 'Bearer not-a-token' } });
      assert.equal(forged.status, 401, route);
    }
  });

  assert.equal(backupCalls, 0);
});

test('an authenticated request downloads a consistent, uncached database snapshot', async () => {
  await withSystemServer(createServices(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/system/backup`, {
      headers: { Authorization: `Bearer ${token}` },
    });

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

  assert.deepEqual(await readdir(snapshotParent), []);
});

test('an authenticated request reads the resolved storage locations', async () => {
  await withSystemServer(createServices(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/system/storage`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      databasePath: path.join(fixtureDirectory, 'auth.db'),
      assetsPath: path.join(fixtureDirectory, 'assets'),
    });
  });
});

test('platform installs answer 403 even for an authenticated request', async () => {
  let backupCalls = 0;
  await withSystemServer(
    createServices({ isPlatform: true, onBackup: () => { backupCalls += 1; } }),
    async (baseUrl) => {
      for (const route of ['/api/system/backup', '/api/system/storage']) {
        const response = await fetch(`${baseUrl}${route}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(response.status, 403, route);
      }
    },
  );

  assert.equal(backupCalls, 0);
});
