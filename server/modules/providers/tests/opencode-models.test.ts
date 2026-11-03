import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import {
  OpenCodeProviderModels,
  OPENCODE_PREDEFINED_MODELS,
} from '@/modules/providers/list/opencode/opencode-models.provider.js';

const OPENCODE_ENV_KEYS = [
  'OPENCODE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_CONTENT',
];

/**
 * Runs one case against a throwaway OpenCode home, so the catalog the adapter
 * reports depends on the fixture rather than on the providers the machine
 * running the suite happens to be logged into.
 */
const withOpenCodeHome = async (
  setUp: (homeDir: string) => Promise<void>,
  runTest: (adapter: OpenCodeProviderModels) => Promise<void>,
  readModels: () => Promise<string[]> = async () => [],
): Promise<void> => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-catalog-'));
  const originalHomedir = os.homedir;
  const originalEnv = OPENCODE_ENV_KEYS.map((key) => [key, process.env[key]] as const);

  (os as any).homedir = () => homeDir;
  for (const key of OPENCODE_ENV_KEYS) {
    delete process.env[key];
  }

  try {
    await setUp(homeDir);
    await runTest(new OpenCodeProviderModels(readModels));
  } finally {
    (os as any).homedir = originalHomedir;
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(homeDir, { recursive: true, force: true });
  }
};

const writeOpenCodeAuth = async (homeDir: string, auth: Record<string, unknown>): Promise<void> => {
  const authDir = path.join(homeDir, '.local', 'share', 'opencode');
  await mkdir(authDir, { recursive: true });
  await writeFile(path.join(authDir, 'auth.json'), JSON.stringify(auth), 'utf8');
};

test('OpenCode falls back to the curated catalog only when no providers are known', async () => {
  await withOpenCodeHome(async () => {}, async (adapter) => {
    // Nothing readable about this install, so the picker keeps every option
    // rather than coming up empty.
    assert.deepEqual(await adapter.getSupportedModels(), OPENCODE_PREDEFINED_MODELS);
    assert.equal(
      (await adapter.getCurrentActiveModel()).model,
      OPENCODE_PREDEFINED_MODELS.DEFAULT,
    );
  });
  // OpenCode routes by `<providerID>/<modelID>`, so every option has to carry a
  // provider prefix that `opencode models --verbose` reports.
  const providerIds = new Set(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value.split('/')[0]),
  );
  assert.deepEqual([...providerIds].sort(), ['anthropic', 'opencode', 'opencode-go', 'openai'].sort());
  assert.equal(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.every((option) => /^[a-z0-9-]+\/.+/.test(option.value)),
    true,
  );
  assert.equal(
    new Set(OPENCODE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value)).size,
    OPENCODE_PREDEFINED_MODELS.OPTIONS.length,
  );
  assert.equal(OPENCODE_PREDEFINED_MODELS.DEFAULT, 'opencode/gpt-5.6-terra');
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'opencode/claude-opus-5'),
  );
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'anthropic/claude-opus-5'),
  );
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'openai/gpt-5.6'),
  );
  // The Go gateway carries its own provider id, so its models must be curated
  // too - a Go subscriber otherwise authenticates while the picker offers
  // nothing they can run.
  const opencodeGoOptions = OPENCODE_PREDEFINED_MODELS.OPTIONS.filter(
    (option) => option.value.startsWith('opencode-go/'),
  );
  assert.equal(opencodeGoOptions.length, 27);
  assert.ok(opencodeGoOptions.every((option) => option.description === 'OpenCode Go'));
  const glmFlash = opencodeGoOptions.find(
    (option) => option.value === 'opencode-go/glm-5.3-flash',
  );
  assert.ok(glmFlash);
  // Effort choices come from `opencode models --verbose` variants; the runtime
  // turns a selected value into `--variant`, so the values have to match the
  // CLI's exactly.
  assert.deepEqual(
    glmFlash?.effort?.values.map((value) => value.value),
    ['low', 'high', 'max'],
  );
  assert.ok(
    opencodeGoOptions
      .filter((option) => !option.effort)
      .every((option) =>
        ['glm-5.1', 'kimi-k2.6', 'kimi-k2.7-code', 'mimo-v2.5', 'mimo-v2.5-pro',
          'minimax-m2.7', 'qwen3.6-plus', 'qwen3.7-max', 'qwen3.7-plus']
          .includes(option.value.slice('opencode-go/'.length)),
      ),
  );
});

test('OpenCode discovers only models available through connected providers', async () => {
  // Asking for a provider the user never connected fails the whole run with
  // "Model <id> is not valid", so an OpenCode Zen model must not be offered -
  // or defaulted to - on a machine that only holds an Anthropic key.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['anthropic']);
      assert.ok(catalog.OPTIONS.length > 0);
      assert.equal(catalog.DEFAULT.startsWith('anthropic/'), true);
      assert.ok(catalog.OPTIONS.some((option) => option.value === catalog.DEFAULT));
      assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
    },
    async () => ['anthropic/claude-sonnet-5', 'opencode/gpt-5.6-terra'],
  );

  // A Go subscriber's auth store holds only `opencode-go`, so the whole catalog
  // has to resolve to Go models and the default has to move onto one of them
  // instead of the unreachable Zen default.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'opencode-go': { type: 'api', key: 'test' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['opencode-go']);
      assert.equal(catalog.OPTIONS.length, 2);
      assert.equal(catalog.DEFAULT, 'opencode-go/grok-4.6');
      assert.ok(catalog.OPTIONS.some((option) => option.value === catalog.DEFAULT));
      assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
    },
    async () => ['opencode-go/grok-4.6', 'opencode-go/glm-5.3'],
  );

  // The catalog default survives whenever its own provider is connected.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, {
      opencode: { type: 'api', key: 'test' },
      openai: { type: 'oauth' },
    }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds].sort(), ['opencode', 'openai'].sort());
      assert.equal(catalog.DEFAULT, OPENCODE_PREDEFINED_MODELS.DEFAULT);
    },
    async () => ['opencode/gpt-5.6-terra', 'openai/gpt-5.6'],
  );

  // Providers configured rather than logged into count too.
  await withOpenCodeHome(
    async (homeDir) => {
      const configDir = path.join(homeDir, '.config', 'opencode');
      await mkdir(configDir, { recursive: true });
      await writeFile(
        path.join(configDir, 'opencode.json'),
        JSON.stringify({ provider: { anthropic: { options: {} } } }),
        'utf8',
      );
    },
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['anthropic']);
    },
    async () => ['anthropic/claude-opus-5'],
  );

  // An API key in the environment is enough on its own.
  await withOpenCodeHome(
    async () => {
      process.env.OPENAI_API_KEY = 'test';
    },
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['openai']);
    },
    async () => ['openai/gpt-5.6'],
  );
});

test('OpenCode uses discovered GitHub Copilot models and never falls back to foreign providers', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'github-copilot': { type: 'oauth' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();

      assert.deepEqual(catalog.OPTIONS.map((option) => option.value), [
        'github-copilot/gpt-5.6-terra',
        'github-copilot/claude-sonnet-5.5',
      ]);
      assert.equal(catalog.DEFAULT, 'github-copilot/gpt-5.6-terra');
      assert.equal((await adapter.getCurrentActiveModel()).model, 'github-copilot/gpt-5.6-terra');
    },
    async () => [
      'github-copilot/gpt-5.6-terra',
      'opencode/gpt-5.6-terra',
      'github-copilot/claude-sonnet-5.5',
    ],
  );

  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'github-copilot': { type: 'oauth' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();

      assert.deepEqual(catalog.OPTIONS, []);
      assert.equal(catalog.DEFAULT, '');
    },
  );

  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'github-copilot': { type: 'oauth' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();

      assert.deepEqual(catalog.OPTIONS, []);
      assert.equal(catalog.DEFAULT, '');
    },
    async () => Promise.reject(new Error('OpenCode unavailable')),
  );
});

test('OpenCode keeps curated metadata for discovered models it already knows', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'opencode-go': { type: 'api', key: 'test' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const [known, unknown] = catalog.OPTIONS;

      // The runtime turns the selected effort into `--variant`, so a known
      // model losing its levels would silently hide the Reasoning picker.
      assert.equal(known.value, 'opencode-go/glm-5.3-flash');
      assert.equal(known.label, 'GLM 5.3 Flash');
      assert.equal(known.description, 'OpenCode Go');
      assert.deepEqual(known.effort?.values.map((value) => value.value), ['low', 'high', 'max']);
      assert.deepEqual(unknown, {
        value: 'opencode-go/new-model',
        label: 'new-model',
        description: 'opencode-go',
      });
    },
    async () => ['opencode-go/glm-5.3-flash', 'opencode-go/new-model'],
  );
});

test('OpenCode counts providers from OPENCODE_CONFIG and OPENCODE_CONFIG_CONTENT', async () => {
  const listing = async () => ['my-proxy/foo', 'anthropic/claude-sonnet-5', 'opencode/gpt-5.6-terra'];
  const expectProxyAndAnthropic = async (adapter: OpenCodeProviderModels): Promise<void> => {
    const catalog = await adapter.getSupportedModels();
    assert.deepEqual(
      catalog.OPTIONS.map((option) => option.value),
      ['my-proxy/foo', 'anthropic/claude-sonnet-5'],
    );
  };

  await withOpenCodeHome(
    async (homeDir) => {
      await writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } });
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: { 'my-proxy': {} } });
    },
    expectProxyAndAnthropic,
    listing,
  );

  await withOpenCodeHome(
    async (homeDir) => {
      await writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } });
      const configPath = path.join(homeDir, 'custom-opencode.json');
      await writeFile(configPath, JSON.stringify({ provider: { 'my-proxy': {} } }), 'utf8');
      process.env.OPENCODE_CONFIG = configPath;
    },
    expectProxyAndAnthropic,
    listing,
  );
});

test('OpenCode caches the CLI model listing and refreshes it in the background', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } }),
    async () => {
      let now = 0;
      let listing = ['anthropic/claude-sonnet-5'];
      const pendingReads: Array<() => void> = [];
      let readCount = 0;
      const adapter = new OpenCodeProviderModels(
        () => {
          readCount += 1;
          const snapshot = listing;
          return new Promise((resolve) => {
            pendingReads.push(() => resolve(snapshot));
          });
        },
        () => now,
      );
      const flushRead = async (): Promise<void> => {
        pendingReads.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
      };

      // Concurrent first loads share one CLI invocation.
      const firstLoads = Promise.all([adapter.getSupportedModels(), adapter.getSupportedModels()]);
      await new Promise((resolve) => setImmediate(resolve));
      await flushRead();
      const [first, second] = await firstLoads;
      assert.equal(readCount, 1);
      assert.deepEqual(first.OPTIONS.map((option) => option.value), ['anthropic/claude-sonnet-5']);
      assert.deepEqual(second, first);

      // Fresh cache: no new process.
      await adapter.getSupportedModels();
      assert.equal(readCount, 1);

      // Stale cache answers immediately and refreshes behind the response.
      now = 5 * 60_000;
      listing = ['anthropic/claude-opus-5'];
      const stale = await adapter.getSupportedModels();
      assert.deepEqual(stale.OPTIONS.map((option) => option.value), ['anthropic/claude-sonnet-5']);
      assert.equal(readCount, 2);
      await flushRead();
      const refreshed = await adapter.getSupportedModels();
      assert.deepEqual(refreshed.OPTIONS.map((option) => option.value), ['anthropic/claude-opus-5']);
      assert.equal(readCount, 2);
    },
  );
});

test('OpenCode retries a failed CLI listing sooner than a successful one', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } }),
    async () => {
      let now = 0;
      let readCount = 0;
      const adapter = new OpenCodeProviderModels(
        async () => {
          readCount += 1;
          if (readCount === 1) {
            throw new Error('OpenCode unavailable');
          }
          return ['anthropic/claude-sonnet-5'];
        },
        () => now,
      );

      // Failure falls back to the connected-provider slice of the static catalog.
      const fallback = await adapter.getSupportedModels();
      assert.ok(fallback.OPTIONS.every((option) => option.value.startsWith('anthropic/')));

      now = 30_000;
      await adapter.getSupportedModels();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(readCount, 2);
      const recovered = await adapter.getSupportedModels();
      assert.deepEqual(recovered.OPTIONS.map((option) => option.value), ['anthropic/claude-sonnet-5']);
    },
  );
});

test('OpenCode keeps serving the last good listing when a refresh fails', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } }),
    async () => {
      let now = 0;
      let readCount = 0;
      const adapter = new OpenCodeProviderModels(
        async () => {
          readCount += 1;
          // The first refresh times out, as any listing can on a busy host.
          if (readCount === 2) {
            return [];
          }
          return readCount === 1 ? ['anthropic/claude-sonnet-5'] : ['anthropic/claude-opus-5'];
        },
        () => now,
      );
      const listedValues = async (): Promise<string[]> =>
        (await adapter.getSupportedModels()).OPTIONS.map((option) => option.value);

      assert.deepEqual(await listedValues(), ['anthropic/claude-sonnet-5']);

      // The failed refresh must not put the static catalog back in the picker...
      now = 5 * 60_000;
      await adapter.getSupportedModels();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(readCount, 2);
      assert.deepEqual(await listedValues(), ['anthropic/claude-sonnet-5']);
      // Reading the catalog again before the retry is due starts no listing.
      assert.equal(readCount, 2);

      // ...and is retried on the short schedule.
      now += 30_000;
      await adapter.getSupportedModels();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(readCount, 3);
      assert.deepEqual(await listedValues(), ['anthropic/claude-opus-5']);
    },
  );
});

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

/**
 * A stand-in for the real CLI, configured by the `fake.json` next to it:
 * `opencode models` prints `listing.txt` in one write and exits with
 * `exitCode` (default 0). `gated` makes it drop a `started` marker first and
 * wait for a `release` file, so a test can move a mocked clock while the
 * listing "runs"; it records a SIGTERM in `killed`, and with `partial` it
 * prints one model line before it waits, as a CLI killed at the budget may
 * already have. `cutUnlessFile` makes it print only the first 100 lines
 * unless its stdout is a regular file, which is what real OpenCode does into
 * a pipe that CloudCLI is too busy to read: it exited 0 after 85 of 373 lines
 * with the reader held up while it wrote, and after 75-306 of 358 on a
 * one-core host.
 */
const FAKE_OPENCODE_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const file = (name) => path.join(__dirname, name);
const config = JSON.parse(fs.readFileSync(file('fake.json'), 'utf8'));
const print = () => {
  let listing = fs.readFileSync(file('listing.txt'), 'utf8');
  if (config.cutUnlessFile && !fs.fstatSync(1).isFile()) {
    listing = listing.split('\\n').slice(0, 100).join('\\n');
  }
  fs.writeSync(1, listing);
  process.exit(config.exitCode ?? 0);
};
if (!config.gated) {
  print();
} else {
  process.on('SIGTERM', () => {
    fs.writeFileSync(file('killed'), '');
    process.exit(143);
  });
  if (config.partial) {
    fs.writeSync(1, 'openrouter/partial/model\\n');
  }
  fs.writeFileSync(file('started'), '');
  // Never outlive a broken test run (its cleanup deletes this directory).
  const giveUpAt = Date.now() + 30000;
  const poll = () => {
    if (!fs.existsSync(__dirname) || Date.now() > giveUpAt) {
      process.exit(1);
    }
    if (fs.existsSync(file('release'))) {
      print();
      return;
    }
    setTimeout(poll, 20);
  };
  poll();
}
`;

type FakeOpenCodeCliConfig = {
  gated?: boolean;
  partial?: boolean;
  cutUnlessFile?: boolean;
  exitCode?: number;
  /** Puts no `opencode` on PATH at all. */
  missing?: boolean;
};

type FakeOpenCodeCli = {
  /** Lets a gated `opencode models` print its listing and exit. */
  release: () => Promise<void>;
  waitForStart: () => Promise<void>;
  waitForKill: () => Promise<void>;
  /** Whatever the adapter left in the temp dir it was given, or (on Linux) still holds open there. */
  leftoverTempEntries: () => Promise<string[]>;
};

// The files under `dir` this process still has open, deleted ones included. Linux only; on Windows
// an open file keeps the adapter's cleanup from deleting it, so the entries show it there.
const openFilesUnder = async (dir: string): Promise<string[]> => {
  if (process.platform !== 'linux') {
    return [];
  }
  const prefix = `${await realpath(dir)}${path.sep}`;
  const targets = await Promise.all((await readdir('/proc/self/fd')).map(
    (fd) => readlink(path.join('/proc/self/fd', fd)).catch(() => ''),
  ));
  return targets.filter((target) => target.startsWith(prefix));
};

// Waits in real time (the budget tests mock only setTimeout, not setImmediate
// or Date) and fails instead of hanging when the fake never gets there.
const waitForFile = async (filePath: string, description: string): Promise<void> => {
  const giveUpAt = Date.now() + 15_000;
  while (!existsSync(filePath)) {
    if (Date.now() > giveUpAt) {
      assert.fail(`timed out waiting for ${description}`);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

/**
 * Runs `run` with the fake `opencode` first on PATH, and with os.tmpdir()
 * pointing at a fresh directory, so a test sees any temp file the adapter
 * leaves behind. The default reader runs the `opencode` it finds on PATH,
 * like production.
 */
const withFakeOpenCodeCli = async (
  listing: string,
  config: FakeOpenCodeCliConfig,
  run: (fake: FakeOpenCodeCli) => Promise<void>,
): Promise<void> => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-fake-cli-'));
  const tempDir = path.join(binDir, 'tmp');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  // os.tmpdir() reads TMPDIR on POSIX and TEMP/TMP on Windows, on every call.
  const tempKeys = ['TMPDIR', 'TMP', 'TEMP'].map(findEnvKey);
  const originalEnv = [pathKey, pathExtKey, ...tempKeys].map((key) => [key, process.env[key]] as const);
  const originalPath = process.env[pathKey];
  const originalPathExt = process.env[pathExtKey];
  const fake: FakeOpenCodeCli = {
    release: () => writeFile(path.join(binDir, 'release'), ''),
    waitForStart: () => waitForFile(path.join(binDir, 'started'), 'the fake `opencode models` to start'),
    waitForKill: () => waitForFile(path.join(binDir, 'killed'), 'the fake `opencode models` to get SIGTERM'),
    leftoverTempEntries: async () => [...await readdir(tempDir), ...await openFilesUnder(tempDir)],
  };

  try {
    await mkdir(tempDir);
    if (!config.missing) {
      const script = path.join(binDir, 'opencode.cjs');
      await writeFile(script, FAKE_OPENCODE_SCRIPT);
      await writeFile(path.join(binDir, 'fake.json'), JSON.stringify(config));
      await writeFile(path.join(binDir, 'listing.txt'), listing);
      if (process.platform === 'win32') {
        await writeFile(path.join(binDir, 'opencode.cmd'), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
        if (!originalPathExt?.toUpperCase().includes('.CMD')) {
          process.env[pathExtKey] = `.COM;.EXE;.BAT;.CMD${originalPathExt ? `;${originalPathExt}` : ''}`;
        }
      } else {
        // exec so the adapter's kill() on timeout reaches the node process itself.
        const wrapper = path.join(binDir, 'opencode');
        await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
        await chmod(wrapper, 0o755);
      }
    }
    process.env[pathKey] = config.missing ? binDir : `${binDir}${path.delimiter}${originalPath ?? ''}`;
    for (const key of tempKeys) {
      process.env[key] = tempDir;
    }

    await run(fake);
  } finally {
    // Lets a gated fake that is still polling exit right away.
    await fake.release().catch(() => {});
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    // On Windows a fake that outlived its kill can hold a file here a moment longer.
    await rm(binDir, { recursive: true, force: true, maxRetries: 10 });
  }
};

test('OpenCode waits for an `opencode models` listing that takes longer than 5 s', async () => {
  const listing = ['openrouter/qwen/qwen3-coder-flash', 'openrouter/google/gemini-3-pro-image-preview'];
  await withOpenCodeHome(async () => {}, () => withFakeOpenCodeCli(listing.join('\n'), { gated: true }, async (fake) => {
    // The adapter arms its timeout as soon as it spawns the CLI, so it must see the mocked setTimeout.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = new OpenCodeProviderModels().getSupportedModels();
      // Move the clock only once the CLI runs, i.e. once the timeout is armed.
      await fake.waitForStart();

      // On one core that another process also used, listing took from about 10 s to over 30 s. A
      // 5 s budget fell back to the static catalog there, which has none of the OpenRouter models of
      // a user whose key CloudCLI cannot see (#1695).
      mock.timers.tick(29_999);
      await fake.release();

      const models = await pending;
      assert.deepEqual(models.OPTIONS.map((option) => option.value), listing);
      assert.equal(models.DEFAULT, listing[0]);
    } finally {
      mock.timers.reset();
    }
  }));
});

test('OpenCode still gives up on, and kills, an `opencode models` that never answers', async () => {
  const listing = 'openrouter/qwen/qwen3-coder-flash\n';
  await withOpenCodeHome(async () => {}, () => withFakeOpenCodeCli(listing, { gated: true, partial: true }, async (fake) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = new OpenCodeProviderModels().getSupportedModels();
      await fake.waitForStart();

      mock.timers.tick(30_000);

      // The line the CLI printed before it was killed is not taken for a listing: no provider is
      // readable in this home, so the whole static catalog stands in.
      assert.deepEqual(await pending, OPENCODE_PREDEFINED_MODELS);
      // On Windows kill() ends the .cmd shim's cmd.exe, which does not signal the node behind it,
      // and that node still holds the listing file.
      if (process.platform !== 'win32') {
        await fake.waitForKill();
        assert.deepEqual(await fake.leftoverTempEntries(), []);
      }
    } finally {
      mock.timers.reset();
    }
  }));
});

test('OpenCode reads the whole listing of a CLI that exits as soon as it has written it', async () => {
  const listing = Array.from({ length: 5_000 }, (_, index) => `openrouter/vendor/model-${index}`);
  // A line that is not a model reference, and no newline after the last one.
  const output = ['Listing models', ...listing].join('\n');
  await withOpenCodeHome(async () => {}, () => withFakeOpenCodeCli(output, { cutUnlessFile: true }, async (fake) => {
    const values = (await new OpenCodeProviderModels().getSupportedModels()).OPTIONS.map((option) => option.value);

    assert.equal(values.length, listing.length);
    assert.deepEqual(values, listing);
    assert.deepEqual(await fake.leftoverTempEntries(), []);
  }));
});

test('OpenCode ignores the output of an `opencode models` that fails, and copes with none on PATH', async () => {
  const listing = 'openrouter/qwen/qwen3-coder-flash\n';
  for (const config of [{ exitCode: 1 }, { missing: true }]) {
    await withOpenCodeHome(async () => {}, () => withFakeOpenCodeCli(listing, config, async (fake) => {
      // A failed run may have printed only part of its listing.
      assert.deepEqual(await new OpenCodeProviderModels().getSupportedModels(), OPENCODE_PREDEFINED_MODELS);
      assert.deepEqual(await fake.leftoverTempEntries(), []);
    }));
  }
});

const writeOpenCodeSessionDatabase = async (homeDir: string, rows: Array<Record<string, unknown>>) => {
  const dbPath = path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db');
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE session (
        id text PRIMARY KEY,
        model text,
        agent text,
        directory text,
        time_created integer NOT NULL,
        time_updated integer NOT NULL
      );
    `);
    const insert = db.prepare(
      'INSERT INTO session (id, model, agent, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const [index, row] of rows.entries()) {
      insert.run(
        row.id,
        row.model,
        row.agent ?? null,
        row.directory ?? '/tmp/project',
        row.timeCreated ?? 1700000000000,
        row.timeUpdated ?? 1700000001000 + index,
      );
    }
  } finally {
    db.close();
  }
};

test('OpenCode composes the provider prefix into session model ids', async () => {
  // The lookup translates the app session id through the sessions database,
  // so point it at a throwaway file rather than the developer's real one.
  const tempSessionsDirectory = await mkdtemp(path.join(os.tmpdir(), 'opencode-session-model-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  try {
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempSessionsDirectory, 'auth.db');
    await initializeDatabase();
    // OpenCode stores the provider and model id in separate fields of the
    // session row ({"id":"z-ai/glm-5.3-flash","providerID":"openrouter"}), but
    // the CLI's `--model` flag only resolves the composed
    // `<providerID>/<modelID>` form. Resuming such a session without the prefix
    // fails with an unknown-model server error, which hits OpenRouter users
    // hardest because their model ids carry a slash themselves.
    await withOpenCodeHome(
      (homeDir) => writeOpenCodeSessionDatabase(homeDir, [
        {
          id: 'ses_openrouter',
          model: JSON.stringify({
            id: 'z-ai/glm-5.3-flash',
            providerID: 'openrouter',
            variant: 'default',
          }),
        },
        {
          id: 'ses_qualified',
          // An id that already carries the provider prefix must survive as-is.
          model: JSON.stringify({
            id: 'openrouter/z-ai/glm-5.3-flash',
            providerID: 'openrouter',
          }),
        },
        {
          id: 'ses_plain_string',
          model: 'opencode/gpt-5.6-terra',
        },
        {
          id: 'ses_github_copilot',
          model: JSON.stringify({
            id: 'gpt-5.6-terra',
            providerID: 'github-copilot',
          }),
        },
      ]),
      async (adapter) => {
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_openrouter')).model,
          'openrouter/z-ai/glm-5.3-flash',
        );
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_qualified')).model,
          'openrouter/z-ai/glm-5.3-flash',
        );
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_plain_string')).model,
          'opencode/gpt-5.6-terra',
        );
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_github_copilot')).model,
          'github-copilot/gpt-5.6-terra',
        );
      },
    );
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempSessionsDirectory, { recursive: true, force: true });
  }
});
