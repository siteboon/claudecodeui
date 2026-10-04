import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { AppError } from '@/shared/utils.js';

import { createKeepAwakeService } from '../keep-awake.service.js';
import { createSystemRouter } from '../system.routes.js';
import type { createSystemUpdateService } from '../system.service.js';

async function withSystemServer(
  run: (baseUrl: string, savedValues: boolean[]) => Promise<void>,
): Promise<void> {
  const savedValues: boolean[] = [];
  const keepAwakeService = createKeepAwakeService({
    platform: 'darwin',
    serverPid: 1,
    isPlatform: false,
    commandExists: () => true,
    spawnProcess: () => Object.assign(new EventEmitter(), { pid: 2, kill: () => true, unref: () => undefined }) as unknown as ChildProcess,
    killProcessGroup: () => undefined,
    readEnabled: () => false,
    writeEnabled: (enabled) => {
      savedValues.push(enabled);
    },
    logInfo: () => undefined,
    logWarn: () => undefined,
  });
  keepAwakeService.initialize();
  const systemUpdateService = {} as ReturnType<typeof createSystemUpdateService>;

  const app = express().use(express.json()).use('/api/system', createSystemRouter(systemUpdateService, keepAwakeService));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = error instanceof AppError ? error : new AppError('Internal server error');
    res.status(appError.statusCode).json({ success: false, error: { code: appError.code, message: appError.message } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, savedValues);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('keep-awake routes report the status and save a boolean setting', async () => {
  await withSystemServer(async (baseUrl, savedValues) => {
    const initial = await fetch(`${baseUrl}/api/system/keep-awake`);
    assert.deepEqual(await initial.json(), {
      success: true,
      data: { enabled: false, supported: true, active: false },
    });

    const saved = await fetch(`${baseUrl}/api/system/keep-awake`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), {
      success: true,
      data: { enabled: true, supported: true, active: false },
    });
    assert.deepEqual(savedValues, [true]);
  });
});

test('keep-awake route rejects anything but a boolean', async () => {
  await withSystemServer(async (baseUrl, savedValues) => {
    for (const body of [{ enabled: 'true' }, {}, { enabled: 1 }]) {
      const response = await fetch(`${baseUrl}/api/system/keep-awake`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      const payload = await response.json() as { error: { code: string } };
      assert.equal(payload.error.code, 'INVALID_KEEP_AWAKE_SETTING');
    }
    assert.deepEqual(savedValues, []);
  });
});
