import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { llmSkillsService } from '@/modules/llm/services/skills.service.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const createSkill = async (
  rootSkillsDirectory: string,
  directoryName: string,
  metadata: {
    name: string;
    description: string;
  },
) => {
  const skillDirectory = path.join(rootSkillsDirectory, directoryName);
  await fs.mkdir(skillDirectory, { recursive: true });
  await fs.writeFile(
    path.join(skillDirectory, 'SKILL.md'),
    `---\nname: ${metadata.name}\ndescription: ${metadata.description}\n---\n\n# ${metadata.name}\n`,
    'utf8',
  );
};

/**
 * This test covers Claude skills fetching from user/project/plugin locations and plugin namespace invocation.
 */
test('llmSkillsService lists claude user/project/plugin skills with proper invocation names', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-claude-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const pluginInstallPath = path.join(tempRoot, 'plugin-install');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await createSkill(path.join(tempRoot, '.claude', 'skills'), 'user-helper', {
      name: 'user-helper',
      description: 'User skill description',
    });
    await createSkill(path.join(workspacePath, '.claude', 'skills'), 'project-helper', {
      name: 'project-helper',
      description: 'Project skill description',
    });
    await createSkill(path.join(pluginInstallPath, 'skills'), 'plugin-helper', {
      name: 'plugin-helper',
      description: 'Plugin skill description',
    });

    await fs.mkdir(path.join(tempRoot, '.claude', 'plugins'), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, '.claude', 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'example-skills@anthropic-agent-skills': true,
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(tempRoot, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'example-skills@anthropic-agent-skills': [
            {
              installPath: pluginInstallPath,
            },
          ],
        },
      }),
      'utf8',
    );

    const skills = await llmSkillsService.listProviderSkills('claude', { workspacePath });
    assert.ok(skills.some((skill) => skill.scope === 'user' && skill.invocation === '/user-helper'));
    assert.ok(skills.some((skill) => skill.scope === 'project' && skill.invocation === '/project-helper'));
    assert.ok(skills.some((skill) => skill.scope === 'plugin' && skill.invocation === '/example-skills:plugin-helper'));
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers Codex skills discovery across repo/user/system locations and `$` invocation prefix.
 */
test('llmSkillsService lists codex skills from repo/user/system locations with dollar invocation', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-codex-'));
  const repoRoot = path.join(tempRoot, 'repo');
  const workspacePath = path.join(repoRoot, 'packages', 'app');
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await createSkill(path.join(workspacePath, '.agents', 'skills'), 'cwd-skill', {
      name: 'cwd-skill',
      description: 'cwd skill',
    });
    await createSkill(path.join(workspacePath, '..', '.agents', 'skills'), 'parent-skill', {
      name: 'parent-skill',
      description: 'parent skill',
    });
    await createSkill(path.join(repoRoot, '.agents', 'skills'), 'repo-root-skill', {
      name: 'repo-root-skill',
      description: 'repo root skill',
    });
    await createSkill(path.join(tempRoot, '.agents', 'skills'), 'user-skill', {
      name: 'user-skill',
      description: 'user skill',
    });
    await createSkill(path.join(tempRoot, '.codex', 'skills', '.system'), 'system-skill', {
      name: 'system-skill',
      description: 'system skill',
    });

    const skills = await llmSkillsService.listProviderSkills('codex', { workspacePath });
    assert.ok(skills.some((skill) => skill.name === 'cwd-skill' && skill.invocation === '$cwd-skill'));
    assert.ok(skills.some((skill) => skill.name === 'parent-skill' && skill.invocation === '$parent-skill'));
    assert.ok(skills.some((skill) => skill.name === 'repo-root-skill' && skill.invocation === '$repo-root-skill'));
    assert.ok(skills.some((skill) => skill.name === 'user-skill' && skill.invocation === '$user-skill'));
    assert.ok(skills.some((skill) => skill.name === 'system-skill' && skill.invocation === '$system-skill'));
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers Gemini skill fetch locations and slash-based invocation format.
 */
test('llmSkillsService lists gemini skills from documented directories', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-gemini-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await createSkill(path.join(tempRoot, '.gemini', 'skills'), 'home-gemini', {
      name: 'home-gemini',
      description: 'home gemini skill',
    });
    await createSkill(path.join(tempRoot, '.agents', 'skills'), 'home-agents', {
      name: 'home-agents',
      description: 'home agents skill',
    });
    await createSkill(path.join(workspacePath, '.gemini', 'skills'), 'project-gemini', {
      name: 'project-gemini',
      description: 'project gemini skill',
    });
    await createSkill(path.join(workspacePath, '.agents', 'skills'), 'project-agents', {
      name: 'project-agents',
      description: 'project agents skill',
    });

    const skills = await llmSkillsService.listProviderSkills('gemini', { workspacePath });
    assert.ok(skills.some((skill) => skill.invocation === '/home-gemini'));
    assert.ok(skills.some((skill) => skill.invocation === '/home-agents'));
    assert.ok(skills.some((skill) => skill.invocation === '/project-gemini'));
    assert.ok(skills.some((skill) => skill.invocation === '/project-agents'));
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers Cursor skill fetch locations and slash-based invocation format.
 */
test('llmSkillsService lists cursor skills from documented directories', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-cursor-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await createSkill(path.join(workspacePath, '.agents', 'skills'), 'project-agents', {
      name: 'project-agents',
      description: 'project agents skill',
    });
    await createSkill(path.join(workspacePath, '.cursor', 'skills'), 'project-cursor', {
      name: 'project-cursor',
      description: 'project cursor skill',
    });
    await createSkill(path.join(tempRoot, '.cursor', 'skills'), 'user-cursor', {
      name: 'user-cursor',
      description: 'user cursor skill',
    });

    const skills = await llmSkillsService.listProviderSkills('cursor', { workspacePath });
    assert.ok(skills.some((skill) => skill.invocation === '/project-agents'));
    assert.ok(skills.some((skill) => skill.invocation === '/project-cursor'));
    assert.ok(skills.some((skill) => skill.invocation === '/user-cursor'));
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
