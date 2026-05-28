import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { providerSkillsService } from '@/modules/providers/services/skills.service.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const writeSkill = async (
  skillsRoot: string,
  directoryName: string,
  name: string,
  description: string,
): Promise<string> => {
  const skillDir = path.join(skillsRoot, directoryName);
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  await fs.writeFile(
    skillPath,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n`,
    'utf8',
  );
  return skillPath;
};

const writeClaudePluginManifest = async (
  installPath: string,
  name: string,
): Promise<void> => {
  const pluginConfigDir = path.join(installPath, '.claude-plugin');
  await fs.mkdir(pluginConfigDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginConfigDir, 'plugin.json'),
    JSON.stringify(
      {
        name,
        version: '0.1.0',
        description: `${name} test plugin`,
      },
      null,
      2,
    ),
    'utf8',
  );
};

const writeClaudePluginCommand = async (
  commandsRoot: string,
  commandName: string,
  description: string,
): Promise<string> => {
  await fs.mkdir(commandsRoot, { recursive: true });
  const commandPath = path.join(commandsRoot, `${commandName}.md`);
  await fs.writeFile(
    commandPath,
    `---\ndescription: ${description}\nargument-hint: 'test args'\n---\n\nCommand body.\n`,
    'utf8',
  );
  return commandPath;
};

/**
 * This test covers Claude user/project skill folders plus plugin discovery from
 * installed plugin command files and fallback plugin skill files.
 */
test('providerSkillsService lists claude user, project, and enabled plugin skills', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-claude-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const commandPluginInstallPath = path.join(
    tempRoot,
    '.claude',
    'plugins',
    'cache',
    'notion-plugin',
    'notion',
    'abc123',
  );
  const skillPluginInstallPath = path.join(
    tempRoot,
    '.claude',
    'plugins',
    'cache',
    'anthropic-agent-skills',
    'example-skills',
    'def456',
  );
  const disabledPluginInstallPath = path.join(
    tempRoot,
    '.claude',
    'plugins',
    'cache',
    'disabled-marketplace',
    'disabled-skills',
    'ghi789',
  );
  const emptyIdPluginInstallPath = path.join(
    tempRoot,
    '.claude',
    'plugins',
    'cache',
    'invalid-empty-plugin',
    'empty',
    '000',
  );
  const atIdPluginInstallPath = path.join(
    tempRoot,
    '.claude',
    'plugins',
    'cache',
    'invalid-at-plugin',
    'at',
    '000',
  );
  const siblingSkillPluginPath = path.join(path.dirname(skillPluginInstallPath), 'legacy777');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await writeSkill(
      path.join(tempRoot, '.claude', 'skills'),
      'claude-user-dir',
      'claude-user',
      'Claude user skill',
    );
    await writeSkill(
      path.join(workspacePath, '.claude', 'skills'),
      'claude-project-dir',
      'claude-project',
      'Claude project skill',
    );
    await writeClaudePluginManifest(commandPluginInstallPath, 'Notion');
    await writeClaudePluginCommand(
      path.join(commandPluginInstallPath, 'commands'),
      'insert-row',
      'Insert a Notion database row',
    );
    await writeSkill(
      path.join(commandPluginInstallPath, 'skills'),
      'ignored-command-plugin-skill-dir',
      'ignored-command-plugin-skill',
      'Command plugin fallback skill should be ignored',
    );
    await writeClaudePluginManifest(skillPluginInstallPath, 'ExampleSkills');
    await writeSkill(
      path.join(skillPluginInstallPath, 'skills'),
      'claude-plugin-dir',
      'claude-plugin',
      'Claude plugin skill',
    );
    await writeSkill(
      path.join(skillPluginInstallPath, 'skills'),
      'claude-plugin-second-dir',
      'claude-plugin-second',
      'Second Claude plugin skill',
    );
    await writeSkill(
      path.join(skillPluginInstallPath, 'skills', 'nested', 'collection'),
      'claude-plugin-nested-dir',
      'claude-plugin-nested',
      'Nested Claude plugin skill',
    );
    await writeSkill(
      path.join(siblingSkillPluginPath, 'skills'),
      'claude-plugin-sibling-dir',
      'claude-plugin-sibling',
      'Sibling Claude plugin skill',
    );
    await writeClaudePluginManifest(disabledPluginInstallPath, 'DisabledSkills');
    await writeClaudePluginCommand(
      path.join(disabledPluginInstallPath, 'commands'),
      'disabled-command',
      'Disabled plugin command',
    );
    await writeClaudePluginCommand(
      path.join(emptyIdPluginInstallPath, 'commands'),
      'invalid-empty-command',
      'Invalid empty id command',
    );
    await writeClaudePluginCommand(
      path.join(atIdPluginInstallPath, 'commands'),
      'invalid-at-command',
      'Invalid at id command',
    );
    await writeSkill(
      path.join(
        disabledPluginInstallPath,
        'skills',
      ),
      'disabled-plugin-dir',
      'disabled-plugin',
      'Disabled plugin skill',
    );

    await fs.writeFile(
      path.join(tempRoot, '.claude', 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            '': true,
            '@': true,
            'notion@notion-marketplace': true,
            'example-skills@anthropic-agent-skills': true,
            'disabled-skills@disabled-marketplace': false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(tempRoot, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify(
        {
          version: 2,
          plugins: {
            '': [
              {
                scope: 'user',
                installPath: emptyIdPluginInstallPath,
                version: '000',
              },
            ],
            '@': [
              {
                scope: 'user',
                installPath: atIdPluginInstallPath,
                version: '000',
              },
            ],
            'notion@notion-marketplace': [
              {
                scope: 'user',
                installPath: commandPluginInstallPath,
                version: 'abc123',
              },
            ],
            'example-skills@anthropic-agent-skills': [
              {
                scope: 'user',
                installPath: skillPluginInstallPath,
                version: 'def456',
              },
            ],
            'disabled-skills@disabled-marketplace': [
              {
                scope: 'user',
                installPath: disabledPluginInstallPath,
                version: 'ghi789',
              },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const skills = await providerSkillsService.listProviderSkills('claude', { workspacePath });
    const byName = new Map(skills.map((skill) => [skill.name, skill]));

    assert.equal(byName.get('claude-user')?.scope, 'user');
    assert.equal(byName.get('claude-user')?.command, '/claude-user');
    assert.equal(byName.get('claude-project')?.scope, 'project');
    assert.equal(byName.get('claude-project')?.command, '/claude-project');

    const pluginCommand = byName.get('insert-row');
    assert.equal(pluginCommand?.scope, 'plugin');
    assert.equal(pluginCommand?.pluginName, 'Notion');
    assert.equal(pluginCommand?.pluginId, 'notion@notion-marketplace');
    assert.equal(pluginCommand?.command, '/Notion:insert-row');
    assert.equal(pluginCommand?.description, 'Insert a Notion database row');
    assert.match(pluginCommand?.sourcePath ?? '', /commands[\\/]insert-row\.md$/);
    assert.equal(byName.has('ignored-command-plugin-skill'), false);

    const pluginSkill = byName.get('claude-plugin');
    assert.equal(pluginSkill?.scope, 'plugin');
    assert.equal(pluginSkill?.pluginName, 'ExampleSkills');
    assert.equal(pluginSkill?.pluginId, 'example-skills@anthropic-agent-skills');
    assert.equal(pluginSkill?.command, '/ExampleSkills:claude-plugin');
    assert.equal(pluginSkill?.description, 'Claude plugin skill');
    assert.match(
      pluginSkill?.sourcePath ?? '',
      /cache[\\/]anthropic-agent-skills[\\/]example-skills[\\/]def456[\\/]skills[\\/]/,
    );

    const secondPluginSkill = byName.get('claude-plugin-second');
    assert.equal(secondPluginSkill?.scope, 'plugin');
    assert.equal(secondPluginSkill?.command, '/ExampleSkills:claude-plugin-second');

    const nestedPluginSkill = byName.get('claude-plugin-nested');
    assert.equal(nestedPluginSkill?.scope, 'plugin');
    assert.equal(nestedPluginSkill?.command, '/ExampleSkills:claude-plugin-nested');
    assert.equal(nestedPluginSkill?.description, 'Nested Claude plugin skill');

    const siblingPluginSkill = byName.get('claude-plugin-sibling');
    assert.equal(siblingPluginSkill?.scope, 'plugin');
    assert.equal(siblingPluginSkill?.pluginName, 'example-skills');
    assert.equal(siblingPluginSkill?.command, '/example-skills:claude-plugin-sibling');
    assert.equal(siblingPluginSkill?.description, 'Sibling Claude plugin skill');
    assert.equal(byName.has('disabled-command'), false);
    assert.equal(byName.has('disabled-plugin'), false);
    assert.equal(byName.has('invalid-empty-command'), false);
    assert.equal(byName.has('invalid-at-command'), false);
    assert.equal(skills.some((skill) => skill.command.startsWith('/:')), false);
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers Codex repository/user/system skill folders and verifies that
 * repository lookup includes cwd, parent, and git root skill locations.
 */
test('providerSkillsService lists codex repository, user, and system skills', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-codex-'));
  const repoRoot = path.join(tempRoot, 'repo');
  const workspacePath = path.join(repoRoot, 'packages', 'app');
  await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await writeSkill(
      path.join(workspacePath, '.agents', 'skills'),
      'codex-cwd-dir',
      'codex-cwd',
      'Codex cwd skill',
    );
    await writeSkill(
      path.join(repoRoot, 'packages', '.agents', 'skills'),
      'codex-parent-dir',
      'codex-parent',
      'Codex parent skill',
    );
    await writeSkill(
      path.join(repoRoot, '.agents', 'skills'),
      'codex-root-dir',
      'codex-root',
      'Codex root skill',
    );
    await writeSkill(
      path.join(tempRoot, '.agents', 'skills'),
      'codex-user-dir',
      'codex-user',
      'Codex user skill',
    );
    await writeSkill(
      path.join(tempRoot, '.codex', 'skills', '.system'),
      'codex-system-dir',
      'codex-system',
      'Codex system skill',
    );

    const skills = await providerSkillsService.listProviderSkills('codex', { workspacePath });
    const byName = new Map(skills.map((skill) => [skill.name, skill]));

    assert.equal(byName.get('codex-cwd')?.scope, 'repo');
    assert.equal(byName.get('codex-parent')?.scope, 'repo');
    assert.equal(byName.get('codex-root')?.scope, 'repo');
    assert.equal(byName.get('codex-user')?.scope, 'user');
    assert.equal(byName.get('codex-system')?.scope, 'system');
    assert.equal(byName.get('codex-root')?.command, '$codex-root');
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers Gemini and Cursor skill directory rules, including shared
 * `.agents/skills` project support.
 */
test('providerSkillsService lists gemini and cursor skills from their configured directories', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-gc-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await writeSkill(
      path.join(tempRoot, '.gemini', 'skills'),
      'gemini-user-dir',
      'gemini-user',
      'Gemini user skill',
    );
    await writeSkill(
      path.join(tempRoot, '.agents', 'skills'),
      'agents-user-dir',
      'agents-user',
      'Agents user skill',
    );
    await writeSkill(
      path.join(workspacePath, '.gemini', 'skills'),
      'gemini-project-dir',
      'gemini-project',
      'Gemini project skill',
    );
    await writeSkill(
      path.join(workspacePath, '.agents', 'skills'),
      'agents-project-dir',
      'agents-project',
      'Agents project skill',
    );
    await writeSkill(
      path.join(workspacePath, '.cursor', 'skills'),
      'cursor-project-dir',
      'cursor-project',
      'Cursor project skill',
    );
    await writeSkill(
      path.join(tempRoot, '.cursor', 'skills'),
      'cursor-user-dir',
      'cursor-user',
      'Cursor user skill',
    );

    const geminiSkills = await providerSkillsService.listProviderSkills('gemini', { workspacePath });
    const geminiByName = new Map(geminiSkills.map((skill) => [skill.name, skill]));
    assert.equal(geminiByName.get('gemini-user')?.scope, 'user');
    assert.equal(geminiByName.get('agents-user')?.scope, 'user');
    assert.equal(geminiByName.get('gemini-project')?.scope, 'project');
    assert.equal(geminiByName.get('agents-project')?.scope, 'project');
    assert.equal(geminiByName.get('gemini-project')?.command, '/gemini-project');

    const cursorSkills = await providerSkillsService.listProviderSkills('cursor', { workspacePath });
    const cursorByName = new Map(cursorSkills.map((skill) => [skill.name, skill]));
    assert.equal(cursorByName.get('agents-project')?.scope, 'project');
    assert.equal(cursorByName.get('cursor-project')?.scope, 'project');
    assert.equal(cursorByName.get('cursor-user')?.scope, 'user');
    assert.equal(cursorByName.get('cursor-user')?.command, '/cursor-user');
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
