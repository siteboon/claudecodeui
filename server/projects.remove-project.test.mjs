import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const PROJECTS_MODULE_URL = new URL('./projects.js', import.meta.url);

async function withTempHome(fn) {
  const originalHome = process.env.HOME;
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'claudecodeui-home-'));

  process.env.HOME = tempHome;

  try {
    return await fn(tempHome);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempHome, { recursive: true, force: true });
  }
}

async function writeProjectConfig(homeDir, config) {
  const claudeDir = path.join(homeDir, '.claude');
  await mkdir(claudeDir, { recursive: true });
  await writeFile(path.join(claudeDir, 'project-config.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readProjectConfig(homeDir) {
  const configPath = path.join(homeDir, '.claude', 'project-config.json');
  const content = await readFile(configPath, 'utf8');
  return JSON.parse(content);
}

async function loadProjectsModule() {
  return import(`${PROJECTS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`);
}

test('removeProjectFromList only removes eligible manually added projects', async (t) => {
  await t.test('removes a manually added project without deleting local files', async () => {
    await withTempHome(async (homeDir) => {
      const { removeProjectFromList } = await loadProjectsModule();
      const projectName = 'manual-project';

      await writeProjectConfig(homeDir, {
        [projectName]: {
          manuallyAdded: true,
          originalPath: '/tmp/manual-project',
        },
      });

      await removeProjectFromList(projectName);

      const config = await readProjectConfig(homeDir);
      assert.deepEqual(config, {});
    });
  });

  await t.test('rejects projects that were not manually added', async () => {
    await withTempHome(async (homeDir) => {
      const { removeProjectFromList } = await loadProjectsModule();
      const projectName = 'tracked-project';

      await writeProjectConfig(homeDir, {
        [projectName]: {
          displayName: 'Tracked Project',
        },
      });

      await assert.rejects(
        () => removeProjectFromList(projectName),
        /Only manually added projects can be removed from the project list/,
      );
    });
  });

  await t.test('rejects manually added projects that already have local Claude history', async () => {
    await withTempHome(async (homeDir) => {
      const { removeProjectFromList } = await loadProjectsModule();
      const projectName = 'manual-with-history';

      await writeProjectConfig(homeDir, {
        [projectName]: {
          manuallyAdded: true,
          originalPath: '/tmp/manual-with-history',
        },
      });

      await mkdir(path.join(homeDir, '.claude', 'projects', projectName), { recursive: true });

      await assert.rejects(
        () => removeProjectFromList(projectName),
        /Projects with local Claude history cannot be removed from the project list/,
      );
    });
  });
});
