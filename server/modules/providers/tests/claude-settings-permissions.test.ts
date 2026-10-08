import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import providerRouter from '@/modules/providers/provider.routes.js';
import { claudeSettingsPermissionsService } from '@/modules/providers/services/claude-settings-permissions.service.js';

// Issue #109: the Claude CLI applies the permission rules in its own settings
// files on top of the lists CloudCLI passes it, but the Settings panel never
// showed them. These tests pin the read-only reader behind that view.

type Source = Awaited<ReturnType<typeof claudeSettingsPermissionsService.listRuleSources>>[number];

const withHome = async (run: (homeDir: string) => Promise<void>) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'claude-settings-permissions-'));
  // os.homedir() reads HOME on POSIX and USERPROFILE on Windows.
  const overridden = { HOME: homeDir, USERPROFILE: homeDir, CLAUDE_CONFIG_DIR: undefined };
  const original = Object.fromEntries(Object.keys(overridden).map((key) => [key, process.env[key]]));
  const setEnv = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
  setEnv(overridden);
  try {
    await run(homeDir);
  } finally {
    setEnv(original);
    await rm(homeDir, { recursive: true, force: true });
  }
};

const writeSettings = async (filePath: string, content: unknown) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content),
  );
};

const bySource = (sources: Source[], scope: Source['scope']): Source => {
  const source = sources.find((entry) => entry.scope === scope);
  assert.ok(source, `expected a ${scope} source`);
  return source;
};

test('lists the allow, deny and ask rules of ~/.claude/settings.json and the managed file', async () => {
  await withHome(async (homeDir) => {
    const userFile = path.join(homeDir, '.claude', 'settings.json');
    const managedFile = path.join(homeDir, 'managed', 'managed-settings.json');
    await writeSettings(userFile, {
      env: { ANTHROPIC_API_KEY: 'sk-secret' },
      permissions: {
        allow: ['Bash(npm run test:*)', 'Read', 'Read', '  ', 42],
        deny: ['Bash(rm:*)'],
        ask: ['WebFetch'],
        defaultMode: 'acceptEdits',
      },
    });
    await writeSettings(managedFile, { permissions: { deny: ['WebSearch'] } });

    const sources = await claudeSettingsPermissionsService.listRuleSources(managedFile);

    assert.deepEqual(bySource(sources, 'user'), {
      scope: 'user',
      path: userFile,
      status: 'ok',
      // Duplicates, blanks and non-strings are dropped; order is kept.
      allow: ['Bash(npm run test:*)', 'Read'],
      deny: ['Bash(rm:*)'],
      ask: ['WebFetch'],
    });
    assert.deepEqual(bySource(sources, 'managed'), {
      scope: 'managed',
      path: managedFile,
      status: 'ok',
      allow: [],
      deny: ['WebSearch'],
      ask: [],
    });
    // Nothing but the rule lists leaves the server (the env block holds secrets).
    assert.doesNotMatch(JSON.stringify(sources), /sk-secret|acceptEdits/);
  });
});

test('reports missing files as empty instead of failing', async () => {
  await withHome(async (homeDir) => {
    const sources = await claudeSettingsPermissionsService.listRuleSources(
      path.join(homeDir, 'nowhere', 'managed-settings.json'),
    );

    for (const source of sources) {
      assert.equal(source.status, 'missing');
      assert.deepEqual([source.allow, source.deny, source.ask], [[], [], []]);
    }
  });
});

test('reports invalid JSON, non-object JSON and unreadable paths as invalid without throwing', async () => {
  await withHome(async (homeDir) => {
    const userFile = path.join(homeDir, '.claude', 'settings.json');
    const managedFile = path.join(homeDir, 'managed', 'managed-settings.json');
    await writeSettings(userFile, '{ "permissions": { "allow": ["Read"], }');
    await writeSettings(managedFile, '["Read"]');

    let sources = await claudeSettingsPermissionsService.listRuleSources(managedFile);
    assert.equal(bySource(sources, 'user').status, 'invalid');
    assert.deepEqual(bySource(sources, 'user').allow, []);
    assert.equal(bySource(sources, 'managed').status, 'invalid');

    // A directory where the file should be cannot be read either.
    await rm(userFile);
    await mkdir(userFile);
    sources = await claudeSettingsPermissionsService.listRuleSources(managedFile);
    assert.equal(bySource(sources, 'user').status, 'invalid');
  });
});

test('reports a file under a path that is not a directory as missing', async () => {
  await withHome(async (homeDir) => {
    // ~/.claude is a plain file, so ~/.claude/settings.json cannot exist (ENOTDIR).
    await writeFile(path.join(homeDir, '.claude'), 'not a directory');

    const sources = await claudeSettingsPermissionsService.listRuleSources(path.join(homeDir, 'none.json'));

    assert.equal(bySource(sources, 'user').status, 'missing');
  });
});

test('reads files saved with a byte order mark, as the CLI does', async () => {
  await withHome(async (homeDir) => {
    const userFile = path.join(homeDir, '.claude', 'settings.json');
    const managedFile = path.join(homeDir, 'managed', 'managed-settings.json');
    const settings = JSON.stringify({ permissions: { allow: ['Bash(git status)'], deny: ['Bash(rm:*)'] } });
    // UTF-8 with BOM (older Notepad) and UTF-16LE with BOM (Windows PowerShell 5.1 Out-File).
    await writeSettings(userFile, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(settings, 'utf8')]));
    await writeSettings(managedFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(settings, 'utf16le')]));

    const sources = await claudeSettingsPermissionsService.listRuleSources(managedFile);

    for (const scope of ['user', 'managed'] as const) {
      const source = bySource(sources, scope);
      assert.equal(source.status, 'ok', `${scope} file`);
      assert.deepEqual(source.allow, ['Bash(git status)']);
      assert.deepEqual(source.deny, ['Bash(rm:*)']);
    }
  });
});

test('treats an empty or whitespace-only file as valid with no rules, as the CLI does', async () => {
  await withHome(async (homeDir) => {
    const userFile = path.join(homeDir, '.claude', 'settings.json');
    const managedFile = path.join(homeDir, 'managed', 'managed-settings.json');
    await writeSettings(userFile, '');
    await writeSettings(managedFile, ' \n\t\r\n');

    const sources = await claudeSettingsPermissionsService.listRuleSources(managedFile);

    for (const source of sources) {
      assert.equal(source.status, 'ok', `${source.scope} file`);
      assert.deepEqual([source.allow, source.deny, source.ask], [[], [], []]);
    }
  });
});

test('reports a file over the CLI 2 MB limit as invalid, since the CLI skips it', async () => {
  await withHome(async (homeDir) => {
    const userFile = path.join(homeDir, '.claude', 'settings.json');
    await writeSettings(userFile, { permissions: { allow: ['Read'] }, padding: 'x'.repeat(2 * 1024 * 1024) });

    const sources = await claudeSettingsPermissionsService.listRuleSources(path.join(homeDir, 'none.json'));

    assert.equal(bySource(sources, 'user').status, 'invalid');
    assert.deepEqual(bySource(sources, 'user').allow, []);
  });
});

test('a settings file without a permissions block is valid and adds no rules', async () => {
  await withHome(async (homeDir) => {
    const userFile = path.join(homeDir, '.claude', 'settings.json');
    await writeSettings(userFile, { model: 'opus' });

    let sources = await claudeSettingsPermissionsService.listRuleSources(path.join(homeDir, 'none.json'));
    assert.equal(bySource(sources, 'user').status, 'ok');
    assert.deepEqual(bySource(sources, 'user').allow, []);

    // A rule list that is not an array adds no rules either.
    await writeSettings(userFile, { permissions: { allow: 'Read' } });
    sources = await claudeSettingsPermissionsService.listRuleSources(path.join(homeDir, 'none.json'));
    assert.equal(bySource(sources, 'user').status, 'ok');
    assert.deepEqual(bySource(sources, 'user').allow, []);
  });
});

test('reads the managed file from the fixed path the CLI uses on each OS', async () => {
  const expected = {
    darwin: '/Library/Application Support/ClaudeCode/managed-settings.json',
    win32: 'C:\\Program Files\\ClaudeCode\\managed-settings.json',
    linux: '/etc/claude-code/managed-settings.json',
  };
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  assert.ok(originalPlatform);
  await withHome(async () => {
    try {
      for (const [platform, managedPath] of Object.entries(expected)) {
        Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
        const sources = await claudeSettingsPermissionsService.listRuleSources();
        assert.equal(bySource(sources, 'managed').path, managedPath, platform);
      }
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });
});

test('follows CLAUDE_CONFIG_DIR like the CLI does', async () => {
  await withHome(async (homeDir) => {
    const configDir = path.join(homeDir, 'custom-claude');
    await writeSettings(path.join(configDir, 'settings.json'), { permissions: { allow: ['Edit'] } });
    process.env.CLAUDE_CONFIG_DIR = configDir;

    const sources = await claudeSettingsPermissionsService.listRuleSources(path.join(homeDir, 'none.json'));

    assert.equal(bySource(sources, 'user').path, path.join(configDir, 'settings.json'));
    assert.deepEqual(bySource(sources, 'user').allow, ['Edit']);

    // A relative value would resolve against the server's cwd, not the CLI's
    // project folder, so the reader keeps the default location instead.
    process.env.CLAUDE_CONFIG_DIR = 'custom-claude';
    const fallback = await claudeSettingsPermissionsService.listRuleSources(path.join(homeDir, 'none.json'));
    assert.equal(bySource(fallback, 'user').path, path.join(homeDir, '.claude', 'settings.json'));
  });
});

test('GET /api/providers/claude/settings-permissions serves the sources and never writes the files', async () => {
  await withHome(async (homeDir) => {
    const userFile = path.join(homeDir, '.claude', 'settings.json');
    const original = JSON.stringify({ permissions: { allow: ['Bash(git status)'] } });
    await writeSettings(userFile, original);

    const app = express().use('/api/providers', providerRouter);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/api/providers/claude/settings-permissions`);
      const payload = await response.json() as { success: boolean; data: { sources: Source[] } };

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      const user = bySource(payload.data.sources, 'user');
      assert.equal(user.path, userFile);
      assert.deepEqual(user.allow, ['Bash(git status)']);
      assert.equal(await readFile(userFile, 'utf8'), original);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
