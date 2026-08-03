import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PiPaths } from '@/modules/providers/list/pi/pi-paths.provider.js';

const PI_ENV_KEYS = [
  'PI_CLI_PATH',
  'PI_CODING_AGENT_DIR',
  'PI_CODING_AGENT_SESSION_DIR',
] as const;

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const key of PI_ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-paths-'));
}

test('getCliPath defaults to "pi" when PI_CLI_PATH is unset', () => {
  withEnv({}, () => {
    assert.equal(new PiPaths().getCliPath(), 'pi');
  });
});

test('getCliPath resolves PI_CLI_PATH', () => {
  withEnv({ PI_CLI_PATH: '/opt/tools/../tools/pi' }, () => {
    assert.equal(new PiPaths().getCliPath(), path.resolve('/opt/tools/pi'));
  });
});

test('getAgentDir defaults to ~/.pi/agent', () => {
  withEnv({}, () => {
    assert.equal(
      new PiPaths().getAgentDir(),
      path.resolve(path.join(os.homedir(), '.pi', 'agent')),
    );
  });
});

test('getAgentDir honours PI_CODING_AGENT_DIR', () => {
  const dir = makeTempDir();
  try {
    withEnv({ PI_CODING_AGENT_DIR: path.join(dir, 'sub', '..', 'sub') }, () => {
      assert.equal(new PiPaths().getAgentDir(), path.resolve(path.join(dir, 'sub')));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getSessionRoots defaults to <agentDir>/sessions', () => {
  const dir = makeTempDir();
  try {
    withEnv({ PI_CODING_AGENT_DIR: dir }, () => {
      assert.deepEqual(new PiPaths().getSessionRoots(), [
        path.resolve(path.join(dir, 'sessions')),
      ]);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getSessionRoots uses settings.json sessionDir over the default', () => {
  const dir = makeTempDir();
  try {
    const sessionDir = path.join(dir, 'custom-sessions');
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ sessionDir }),
    );
    withEnv({ PI_CODING_AGENT_DIR: dir }, () => {
      assert.deepEqual(new PiPaths().getSessionRoots(), [path.resolve(sessionDir)]);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getSessionRoots prefers PI_CODING_AGENT_SESSION_DIR over settings.json', () => {
  const dir = makeTempDir();
  try {
    const settingsDir = path.join(dir, 'from-settings');
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ sessionDir: settingsDir }),
    );
    const envDir = path.join(dir, 'from-env');
    withEnv(
      { PI_CODING_AGENT_DIR: dir, PI_CODING_AGENT_SESSION_DIR: envDir },
      () => {
        assert.deepEqual(new PiPaths().getSessionRoots(), [path.resolve(envDir)]);
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getSessionRoots ignores malformed settings.json and falls back to default', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
    withEnv({ PI_CODING_AGENT_DIR: dir }, () => {
      assert.deepEqual(new PiPaths().getSessionRoots(), [
        path.resolve(path.join(dir, 'sessions')),
      ]);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
