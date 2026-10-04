import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { isClaudeBypassRefusedAsRoot } from '@/shared/utils.js';

/**
 * Claude Code refuses bypass-permissions mode as root unless `IS_SANDBOX=1` or
 * a truthy `CLAUDE_CODE_BUBBLEWRAP` marks a sandbox (#641). It reads those
 * markers after copying the `env` blocks of its global config, user settings
 * and managed settings into its environment, so a marker set only in
 * `~/.claude/settings.json` counts, and a later file wins over an earlier one
 * and over the inherited environment. These pin that overlay, as measured on
 * the native CLI 2.1.280 run as fake root.
 */

const SANDBOX_ENV_KEYS = ['IS_SANDBOX', 'CLAUDE_CODE_BUBBLEWRAP'] as const;
const MANAGED_DIR = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code';

type GuardFixture = {
  uid?: number;
  processEnv?: Partial<Record<(typeof SANDBOX_ENV_KEYS)[number], string>>;
  /** Point `CLAUDE_CONFIG_DIR` at `<home>/config-dir`. */
  useConfigDir?: boolean;
  /** Files under the temporary HOME, by relative path; objects are written as JSON. */
  homeFiles?: Record<string, unknown>;
  /** Files under the managed settings directory, by relative path. */
  managedFiles?: Record<string, unknown>;
};

const enoent = () => Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });

/** Answers `isClaudeBypassRefusedAsRoot()` for a server with `fixture`'s uid, environment and settings files. */
function refusedWith(fixture: GuardFixture): boolean {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-root-guard-'));
  for (const [relativePath, content] of Object.entries(fixture.homeFiles ?? {})) {
    const filePath = path.join(home, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
  }

  const originalGetuid = process.getuid;
  const originalEnv = Object.fromEntries(
    [...SANDBOX_ENV_KEYS, 'HOME', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]),
  );
  process.getuid = () => fixture.uid ?? 0;
  process.env.HOME = home;
  if (fixture.useConfigDir) {
    process.env.CLAUDE_CONFIG_DIR = path.join(home, 'config-dir');
  } else {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
  for (const key of SANDBOX_ENV_KEYS) {
    const value = fixture.processEnv?.[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  // The managed directory is system-wide, so it is served from the fixture
  // instead of the disk (which also keeps a real one on this machine out).
  const managedFiles = fixture.managedFiles ?? {};
  const readFileSync = fs.readFileSync;
  const readdirSync = fs.readdirSync;
  mock.method(fs, 'readFileSync', ((file: fs.PathOrFileDescriptor, options?: unknown) => {
    const filePath = String(file);
    if (filePath.startsWith(`${MANAGED_DIR}${path.sep}`)) {
      const content = managedFiles[path.relative(MANAGED_DIR, filePath).split(path.sep).join('/')];
      if (content === undefined) {
        throw enoent();
      }
      return typeof content === 'string' ? content : JSON.stringify(content);
    }
    return readFileSync(file, options as never);
  }) as never);
  mock.method(fs, 'readdirSync', ((directory: fs.PathLike, options?: unknown) => {
    if (String(directory) === path.join(MANAGED_DIR, 'managed-settings.d')) {
      const names = Object.keys(managedFiles)
        .filter((name) => name.startsWith('managed-settings.d/'))
        .map((name) => name.slice('managed-settings.d/'.length));
      if (names.length === 0) {
        throw enoent();
      }
      // Deliberately unsorted: the CLI applies drop-ins in name order.
      return names.reverse();
    }
    return readdirSync(directory, options as never);
  }) as never);

  try {
    return isClaudeBypassRefusedAsRoot();
  } finally {
    mock.restoreAll();
    process.getuid = originalGetuid;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const userSettings = (env: Record<string, unknown>) => ({ '.claude/settings.json': { env } });

test('only root is refused', { skip: process.platform === 'win32' }, () => {
  assert.equal(refusedWith({ uid: 1000 }), false);
  assert.equal(refusedWith({ uid: 0 }), true);
});

test('the inherited environment marks a sandbox with the exact values the CLI honours', { skip: process.platform === 'win32' }, () => {
  assert.equal(refusedWith({ processEnv: { IS_SANDBOX: '1' } }), false);
  assert.equal(refusedWith({ processEnv: { IS_SANDBOX: 'true' } }), true);

  for (const value of ['1', 'true', 'yes', 'on', ' On ']) {
    assert.equal(refusedWith({ processEnv: { CLAUDE_CODE_BUBBLEWRAP: value } }), false, value);
  }
  for (const value of ['0', 'false', '']) {
    assert.equal(refusedWith({ processEnv: { CLAUDE_CODE_BUBBLEWRAP: value } }), true, value);
  }
});

test('a sandbox marked only in ~/.claude/settings.json counts', { skip: process.platform === 'win32' }, () => {
  assert.equal(refusedWith({ homeFiles: userSettings({ IS_SANDBOX: '1' }) }), false);
  // The CLI stringifies numbers and booleans.
  assert.equal(refusedWith({ homeFiles: userSettings({ IS_SANDBOX: 1 }) }), false);
  assert.equal(refusedWith({ homeFiles: userSettings({ CLAUDE_CODE_BUBBLEWRAP: true }) }), false);
  assert.equal(refusedWith({ homeFiles: userSettings({ IS_SANDBOX: 'true' }) }), true);
});

test('a settings value replaces the inherited one, even when it is empty', { skip: process.platform === 'win32' }, () => {
  assert.equal(refusedWith({ processEnv: { IS_SANDBOX: '1' }, homeFiles: userSettings({ IS_SANDBOX: '0' }) }), true);
  assert.equal(refusedWith({ processEnv: { IS_SANDBOX: '1' }, homeFiles: userSettings({ IS_SANDBOX: '' }) }), true);
  assert.equal(
    refusedWith({ processEnv: { CLAUDE_CODE_BUBBLEWRAP: '1' }, homeFiles: userSettings({ CLAUDE_CODE_BUBBLEWRAP: 'false' }) }),
    true,
  );
  // Values that are not strings, numbers or booleans are dropped.
  assert.equal(refusedWith({ processEnv: { IS_SANDBOX: '1' }, homeFiles: userSettings({ IS_SANDBOX: null }) }), false);
});

test('the global config ~/.claude.json counts, below the user settings', { skip: process.platform === 'win32' }, () => {
  assert.equal(refusedWith({ homeFiles: { '.claude.json': { env: { IS_SANDBOX: '1' } } } }), false);
  assert.equal(
    refusedWith({
      homeFiles: { '.claude.json': { env: { IS_SANDBOX: '1' } }, ...userSettings({ IS_SANDBOX: '0' }) },
    }),
    true,
  );
  assert.equal(
    refusedWith({
      homeFiles: { '.claude.json': { env: { IS_SANDBOX: '0' } }, ...userSettings({ IS_SANDBOX: '1' }) },
    }),
    false,
  );
});

test('CLAUDE_CONFIG_DIR moves both files and the home copies stop counting', { skip: process.platform === 'win32' }, () => {
  assert.equal(refusedWith({ useConfigDir: true, homeFiles: { 'config-dir/settings.json': { env: { IS_SANDBOX: '1' } } } }), false);
  assert.equal(refusedWith({ useConfigDir: true, homeFiles: { 'config-dir/.claude.json': { env: { IS_SANDBOX: '1' } } } }), false);
  assert.equal(refusedWith({ useConfigDir: true, homeFiles: userSettings({ IS_SANDBOX: '1' }) }), true);
  assert.equal(refusedWith({ useConfigDir: true, homeFiles: { '.claude.json': { env: { IS_SANDBOX: '1' } } } }), true);
});

test('a legacy .config.json replaces ~/.claude.json', { skip: process.platform === 'win32' }, () => {
  assert.equal(
    refusedWith({
      homeFiles: {
        '.claude.json': { env: { IS_SANDBOX: '1' } },
        '.claude/.config.json': { env: {} },
      },
    }),
    true,
  );
  assert.equal(refusedWith({ homeFiles: { '.claude/.config.json': { env: { IS_SANDBOX: '1' } } } }), false);
});

test('managed settings and their drop-ins apply last, drop-ins in name order', { skip: process.platform === 'win32' }, () => {
  assert.equal(refusedWith({ managedFiles: { 'managed-settings.json': { env: { IS_SANDBOX: '1' } } } }), false);
  assert.equal(
    refusedWith({
      homeFiles: userSettings({ IS_SANDBOX: '1' }),
      managedFiles: { 'managed-settings.json': { env: { IS_SANDBOX: '0' } } },
    }),
    true,
  );
  assert.equal(
    refusedWith({
      managedFiles: {
        'managed-settings.json': { env: { IS_SANDBOX: '1' } },
        'managed-settings.d/10-sandbox.json': { env: { IS_SANDBOX: '1' } },
        'managed-settings.d/20-lockdown.json': { env: { IS_SANDBOX: '0' } },
      },
    }),
    true,
  );
  assert.equal(
    refusedWith({
      managedFiles: {
        'managed-settings.d/10-lockdown.json': { env: { IS_SANDBOX: '0' } },
        'managed-settings.d/20-sandbox.json': { env: { IS_SANDBOX: '1' } },
      },
    }),
    false,
  );
  // Only visible `.json` drop-ins are read.
  assert.equal(
    refusedWith({
      managedFiles: {
        'managed-settings.d/.hidden.json': { env: { IS_SANDBOX: '1' } },
        'managed-settings.d/notes.txt': { env: { IS_SANDBOX: '1' } },
      },
    }),
    true,
  );
});

test('unreadable settings files are skipped', { skip: process.platform === 'win32' }, () => {
  assert.equal(refusedWith({ processEnv: { IS_SANDBOX: '1' }, homeFiles: { '.claude/settings.json': '{ not json' } }), false);
  assert.equal(refusedWith({ homeFiles: { '.claude/settings.json': { env: ['IS_SANDBOX=1'] } } }), true);
  assert.equal(refusedWith({ homeFiles: { '.claude/settings.json': 'null' } }), true);
});
