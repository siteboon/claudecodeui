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
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = homeDir;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    await run(homeDir);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    }
    await rm(homeDir, { recursive: true, force: true });
  }
};

const writeSettings = async (filePath: string, content: unknown) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, typeof content === 'string' ? content : JSON.stringify(content));
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

test('a settings file without a permissions block is valid and adds no rules', async () => {
  await withHome(async (homeDir) => {
    const userFile = path.join(homeDir, '.claude', 'settings.json');
    await writeSettings(userFile, { model: 'opus', permissions: { allow: 'Read' } });

    const sources = await claudeSettingsPermissionsService.listRuleSources(path.join(homeDir, 'none.json'));

    assert.equal(bySource(sources, 'user').status, 'ok');
    assert.deepEqual(bySource(sources, 'user').allow, []);
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
