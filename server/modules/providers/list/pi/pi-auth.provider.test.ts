import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelInfo, RpcClientOptions } from '@earendil-works/pi-coding-agent';

import { PiRpcClient } from './pi-rpc-client.provider.js';
import { PiAuthProvider } from './pi-auth.provider.js';

const MODEL: ModelInfo = { provider: 'p', id: 'm1', contextWindow: 1000, reasoning: false };

function fakeSpawnSync(status: number | null, error?: Error) {
  return (() => ({ status, error, pid: 1, output: [], stdout: '', stderr: '', signal: null })) as unknown as typeof import('cross-spawn').sync;
}

/** A probe rpc client stub honouring the PiAuthProvider surface. */
function makeRpcStub(opts: { models?: ModelInfo[]; throwOnModels?: boolean } = {}) {
  return {
    start: async () => {},
    getAvailableModels: async () => {
      if (opts.throwOnModels) throw new Error('probe failed');
      return opts.models ?? [MODEL];
    },
    close: async () => {},
  };
}

// T12: --version fails -> not installed, not authenticated, no throw.
test('T12 executable --version failing reports not installed without throwing', async () => {
  const provider = new PiAuthProvider({
    paths: { getCliPath: () => 'pi' },
    spawnSync: fakeSpawnSync(1),
    createRpcClient: () => makeRpcStub(),
  });

  const status = await provider.getStatus();
  assert.equal(status.installed, false);
  assert.equal(status.authenticated, false);
  assert.equal(status.provider, 'pi');
});

// T13: installed but probe yields no models (or throws) -> installed, not authenticated, no throw.
test('T13 installed but probe with no models reports not authenticated', async () => {
  const provider = new PiAuthProvider({
    paths: { getCliPath: () => 'pi' },
    spawnSync: fakeSpawnSync(0),
    createRpcClient: () => makeRpcStub({ models: [] }),
  });

  const status = await provider.getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
});

test('T13b installed but probe throwing reports not authenticated without throwing', async () => {
  const provider = new PiAuthProvider({
    paths: { getCliPath: () => 'pi' },
    spawnSync: fakeSpawnSync(0),
    createRpcClient: () => makeRpcStub({ throwOnModels: true }),
  });

  const status = await provider.getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
});

test('installed and probe with >=1 model reports authenticated', async () => {
  const provider = new PiAuthProvider({
    paths: { getCliPath: () => 'pi' },
    spawnSync: fakeSpawnSync(0),
    createRpcClient: () => makeRpcStub({ models: [MODEL] }),
  });

  const status = await provider.getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, true);
});

// T28: probe flags must equal runtime flags, both containing --no-extensions.
test('T28 probe uses same flags as runtime including --no-extensions', async () => {
  let capturedArgs: string[] | undefined;

  // The default createRpcClient builds a real PiRpcClient, which injects the
  // fixed runtime flags. Wiring a capturing underlying-client deps lets us
  // observe the exact argv the probe would spawn with.
  const provider = new PiAuthProvider({
    paths: { getCliPath: () => 'pi' },
    spawnSync: fakeSpawnSync(0),
    createRpcClient: (options: RpcClientOptions) =>
      new PiRpcClient(options, {
        createClient: (built) => {
          capturedArgs = built.args;
          return {
            start: async () => {},
            stop: async () => {},
            onEvent: () => () => {},
            getStderr: () => '',
            prompt: async () => {},
            abort: async () => {},
            getState: async () => ({}) as never,
            getAvailableModels: async () => [MODEL],
            getCommands: async () => [],
          };
        },
      }),
  });

  const status = await provider.getStatus();
  assert.equal(status.authenticated, true);
  assert.ok(capturedArgs, 'probe should spawn through PiRpcClient');
  assert.ok(
    capturedArgs?.includes('--no-extensions'),
    'probe flags must contain --no-extensions (same as runtime)',
  );
});
