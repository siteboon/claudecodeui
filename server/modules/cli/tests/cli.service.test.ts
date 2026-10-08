import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { CliEnvironment, CliOutput } from '@/shared/types.js';

import { createCliService } from '../cli.service.js';

function createHarness() {
  const logMessages: string[] = [];
  const errorMessages: string[] = [];
  const environment: CliEnvironment = {};
  const output: CliOutput = {
    log: (message = '') => logMessages.push(message),
    error: (message = '') => errorMessages.push(message),
  };
  let serverStarts = 0;
  let sandboxArguments: string[] = [];
  const service = createCliService({
    applicationRoot: '/application',
    defaultDatabasePath: '/home/user/.cloudcli/auth.db',
    homeDirectory: '/home/user',
    packageMetadata: {
      version: '1.2.3',
      homepage: 'https://cloudcli.example',
      bugsUrl: 'https://cloudcli.example/issues',
    },
    environment,
    fileSystem: {
      pathExists: () => false,
      getFileStats: () => ({ size: 0, modifiedAt: new Date(0) }),
    },
    output,
    sandboxService: {
      execute: async (argumentsList) => {
        sandboxArguments = argumentsList;
        return 7;
      },
    },
    getLatestPackageVersion: async () => '1.2.3',
    updateGlobalPackage: () => undefined,
    startServer: async () => {
      serverStarts += 1;
    },
    startBrowserUseMcp: async () => undefined,
  });

  return {
    service,
    environment,
    logMessages,
    errorMessages,
    getServerStarts: () => serverStarts,
    getSandboxArguments: () => sandboxArguments,
  };
}

test('applies CLI options to the injected environment before starting the server', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run([
    '--port',
    '8080',
    '--database-path=/data/app.db',
  ]);

  assert.equal(exitCode, 0);
  assert.equal(harness.environment.SERVER_PORT, '8080');
  assert.equal(harness.environment.DATABASE_PATH, '/data/app.db');
  assert.equal(harness.getServerStarts(), 1);
});

test('passes only sandbox arguments to the injected sandbox service', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['sandbox', 'ls']);

  assert.equal(exitCode, 7);
  assert.deepEqual(harness.getSandboxArguments(), ['ls']);
});

test('returns a failure code for an unknown command without exiting the process', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['unknown']);

  assert.equal(exitCode, 1);
  assert.match(harness.errorMessages[0], /Unknown command: unknown/);
});

const TLS_FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/tests/fixtures');

test('status reports HTTPS and an https:// UI address when SSL_CERT/SSL_KEY load', async () => {
  const harness = createHarness();
  harness.environment.SSL_CERT = path.join(TLS_FIXTURES, 'test-only-tls-cert.pem');
  harness.environment.SSL_KEY = path.join(TLS_FIXTURES, 'test-only-tls-key.pem');

  assert.equal(await harness.service.run(['status']), 0);

  const output = harness.logMessages.join('\n');
  assert.match(output, /HTTPS: .*\[OK\] SSL_CERT=.*test-only-tls-cert\.pem/);
  assert.match(output, /Access the UI at https:\/\/localhost:3001/);
});

test('status warns that the server will use plain HTTP when the SSL setup is incomplete', async () => {
  const harness = createHarness();
  harness.environment.SSL_CERT = path.join(TLS_FIXTURES, 'test-only-tls-cert.pem');

  assert.equal(await harness.service.run(['status']), 0);

  const output = harness.logMessages.join('\n');
  assert.match(output, /HTTPS: .*\[WARN\] Off, the server will use plain HTTP\. SSL_CERT is set but SSL_KEY is not\./);
  assert.match(output, /Access the UI at http:\/\/localhost:3001/);
});
