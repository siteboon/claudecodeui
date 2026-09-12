import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PiProviderAuth } from '@/modules/providers/list/pi/pi-auth.provider.js';
import { PiMcpProvider } from '@/modules/providers/list/pi/pi-mcp.provider.js';
import {
  PI_PREDEFINED_MODELS,
  PiProviderModels,
} from '@/modules/providers/list/pi/pi-models.provider.js';
import { PiSkillsProvider } from '@/modules/providers/list/pi/pi-skills.provider.js';
import { createProviderTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';
import { AppError } from '@/shared/utils.js';

// ---------------------------------------------------------------------------
// Shared isolation helpers
// ---------------------------------------------------------------------------

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

/**
 * Environment variables pi accepts as credentials. The list mirrors the auth
 * adapter's own probe set so "no credentials" tests stay honest even when the
 * developer machine running the suite has a real key exported.
 */
const PI_ENV_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'ZAI_CODING_CN_API_KEY',
];

const withEnvironmentCredentials = async (
  values: Record<string, string>,
  run: () => Promise<void>,
): Promise<void> => {
  const savedEntries = PI_ENV_CREDENTIAL_KEYS.map(
    (key) => [key, process.env[key]] as const,
  );
  try {
    for (const key of PI_ENV_CREDENTIAL_KEYS) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(values)) {
      process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of savedEntries) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

const withPath = async (nextPath: string, run: () => Promise<void>): Promise<void> => {
  const originalPath = process.env.PATH;
  process.env.PATH = nextPath;
  try {
    await run();
  } finally {
    process.env.PATH = originalPath;
  }
};

/** Writes a `pi` stub that exits 0 for `--version`, then hands back its dir. */
const writeFakePiCli = async (binDir: string): Promise<string> => {
  await mkdir(binDir, { recursive: true });
  // A shebang script resolves through the kernel on macOS/Linux; the CI and
  // developer suites for this repo never run the server tests on Windows.
  await writeFile(path.join(binDir, 'pi'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return binDir;
};

const withIsolatedPiHome = async (run: (homeDir: string) => Promise<void>): Promise<void> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-facets-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await run(tempRoot);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const writeSkill = async (skillDir: string, name: string, description: string): Promise<void> => {
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`,
    'utf8',
  );
};

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

test('auth reports an installed pi with no credentials as merely unauthenticated', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const binDir = await writeFakePiCli(path.join(homeDir, 'bin'));
    await withPath(binDir, async () => {
      await withEnvironmentCredentials({}, async () => {
        const status = await new PiProviderAuth().getStatus();

        assert.equal(status.provider, 'pi');
        assert.equal(status.installed, true);
        assert.equal(status.authenticated, false);
        assert.equal(status.method, null);
        // pi has no account identity, so there is no email to report.
        assert.equal(status.email, null);
        // An unauthenticated pi is a neutral state, not an error the UI should
        // render as a failure.
        assert.equal(status.error, undefined);
      });
    });
  });
});

test('auth reports pi as not installed when the CLI is missing from PATH', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const emptyDir = path.join(homeDir, 'empty-bin');
    await mkdir(emptyDir, { recursive: true });
    await withPath(emptyDir, async () => {
      await withEnvironmentCredentials({}, async () => {
        const status = await new PiProviderAuth().getStatus();

        assert.equal(status.installed, false);
        assert.equal(status.authenticated, false);
      });
    });
  });
});

test('auth accepts provider API keys exported into the environment', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const binDir = await writeFakePiCli(path.join(homeDir, 'bin'));
    await withPath(binDir, async () => {
      await withEnvironmentCredentials({ ANTHROPIC_API_KEY: 'test-key-placeholder' }, async () => {
        const status = await new PiProviderAuth().getStatus();

        assert.equal(status.authenticated, true);
        assert.equal(status.method, 'env');
        assert.equal(status.email, null);
      });
    });
  });
});

test('auth prefers the pi auth store over environment keys', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const binDir = await writeFakePiCli(path.join(homeDir, 'bin'));
    const agentDir = path.join(homeDir, '.pi', 'agent');
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, 'auth.json'), '{}\n', 'utf8');
    await withPath(binDir, async () => {
      await withEnvironmentCredentials({ OPENAI_API_KEY: 'test-key-placeholder' }, async () => {
        const status = await new PiProviderAuth().getStatus();

        assert.equal(status.authenticated, true);
        assert.equal(status.method, 'oauth');
      });
    });
  });
});

// ---------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------

test('the pi catalog keeps the frontend default and declares effort for every model', () => {
  assert.equal(PI_PREDEFINED_MODELS.DEFAULT, 'anthropic/claude-sonnet-4');

  const values = PI_PREDEFINED_MODELS.OPTIONS.map((option) => option.value);
  assert.ok(values.length > 0);
  assert.ok(values.includes(PI_PREDEFINED_MODELS.DEFAULT));

  for (const option of PI_PREDEFINED_MODELS.OPTIONS) {
    assert.ok(option.label.trim().length > 0, `${option.value} needs a label`);
    assert.ok(
      Array.isArray(option.effort?.values),
      `${option.value} must declare an effort list (empty until pi exposes one)`,
    );
  }

  for (const providerPrefix of ['anthropic/', 'zai-coding-cn/', 'openai/']) {
    assert.ok(
      values.some((value) => value.startsWith(providerPrefix)),
      `catalog is missing a ${providerPrefix}* model`,
    );
  }
});

test('the pi models facet serves the curated catalog and its default', async () => {
  const models = new PiProviderModels();

  assert.deepEqual(await models.getSupportedModels(), PI_PREDEFINED_MODELS);
  assert.deepEqual(await models.getCurrentActiveModel(), {
    model: PI_PREDEFINED_MODELS.DEFAULT,
  });
  // Phase 1 has no runtime model state to read back, so a session id resolves
  // to the same curated default.
  assert.deepEqual(await models.getCurrentActiveModel('session-1'), {
    model: PI_PREDEFINED_MODELS.DEFAULT,
  });
});

// ---------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------

test('listSkills reads pi user skills, settings.json sources and workspace skills', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const configuredDir = path.join(homeDir, 'configured-skills');
    await writeSkill(path.join(configuredDir, 'deploy-notes'), 'deploy-notes', 'Deploy checklist.');
    await writeSkill(
      path.join(homeDir, '.pi', 'agent', 'skills', 'release-check'),
      'release-check',
      'Release checklist.',
    );

    const workspacePath = path.join(homeDir, 'workspace');
    await writeSkill(
      path.join(workspacePath, '.pi', 'skills', 'repo-lint'),
      'repo-lint',
      'Repository lint.',
    );

    const agentDir = path.join(homeDir, '.pi', 'agent');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, 'settings.json'),
      `${JSON.stringify({ skills: [configuredDir] })}\n`,
      'utf8',
    );

    const skills = await new PiSkillsProvider().listSkills({ workspacePath });
    const byName = new Map(skills.map((skill) => [skill.name, skill]));

    assert.deepEqual([...byName.keys()].sort(), ['deploy-notes', 'release-check', 'repo-lint']);
    assert.equal(byName.get('deploy-notes')?.command, '/deploy-notes');
    assert.equal(byName.get('deploy-notes')?.scope, 'user');
    assert.equal(byName.get('deploy-notes')?.provider, 'pi');
    assert.equal(byName.get('deploy-notes')?.description, 'Deploy checklist.');
    assert.equal(byName.get('release-check')?.scope, 'user');
    assert.equal(byName.get('repo-lint')?.scope, 'project');
    assert.equal(byName.get('repo-lint')?.command, '/repo-lint');
  });
});

test('listSkills skips settings.json skill directories that no longer exist', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const configuredDir = path.join(homeDir, 'configured-skills');
    await writeSkill(path.join(configuredDir, 'deploy-notes'), 'deploy-notes', 'Deploy checklist.');

    const agentDir = path.join(homeDir, '.pi', 'agent');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, 'settings.json'),
      `${JSON.stringify({ skills: [configuredDir, path.join(homeDir, 'gone-skills')] })}\n`,
      'utf8',
    );

    const skills = await new PiSkillsProvider().listSkills({
      workspacePath: path.join(homeDir, 'workspace'),
    });

    assert.deepEqual(skills.map((skill) => skill.name), ['deploy-notes']);
  });
});

// ---------------------------------------------------------------------------
// mcp
// ---------------------------------------------------------------------------

test('pi reports no MCP servers in any scope', async () => {
  const servers = await new PiMcpProvider().listServers({
    workspacePath: path.join(os.tmpdir(), 'pi-facets-mcp'),
  });

  assert.deepEqual(servers, { user: [], local: [], project: [] });
});

test('pi rejects MCP server writes as unsupported', async () => {
  const mcp = new PiMcpProvider();

  await assert.rejects(
    () => mcp.upsertServer({
      name: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'docs-server'],
      scope: 'project',
      workspacePath: path.join(os.tmpdir(), 'pi-facets-mcp'),
    }),
    (error: unknown) => (
      error instanceof AppError
      && error.code === 'NOT_SUPPORTED'
      && /Pi does not support MCP/.test(error.message)
    ),
  );
});

// ---------------------------------------------------------------------------
// token usage
// ---------------------------------------------------------------------------

test('pi token usage returns an explicit unsupported result', async () => {
  const service = createProviderTokenUsageService({
    getSessionById: () => ({
      session_id: 'app-session',
      provider: 'pi',
      provider_session_id: 'provider-session',
      project_path: null,
      jsonl_path: null,
      custom_name: null,
      model: null,
      effort: null,
      forked_from_session_id: null,
      isArchived: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
  });

  const result = await service.getSessionTokenUsage('app-session');

  assert.equal(result.unsupported, true);
  assert.equal(result.used, 0);
  assert.equal(result.total, 0);
  assert.deepEqual(result.breakdown, { input: 0, output: 0 });
});
