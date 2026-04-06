import { access, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { LLMProvider } from '@/shared/types/app.js';

export type SkillScope = 'user' | 'project' | 'plugin' | 'repo' | 'admin' | 'system';

export type UnifiedSkill = {
  provider: LLMProvider;
  scope: SkillScope;
  name: string;
  description?: string;
  invocation: string;
  filePath: string;
  pluginName?: string;
};

/**
 * Unified provider skills loader used by the refactor LLM module.
 */
export const llmSkillsService = {
  /**
   * Lists all available skills for one provider from provider-specific skill directories.
   */
  async listProviderSkills(
    provider: LLMProvider,
    options?: { workspacePath?: string },
  ): Promise<UnifiedSkill[]> {
    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    switch (provider) {
      case 'claude':
        return listClaudeSkills(workspacePath);
      case 'codex':
        return listCodexSkills(workspacePath);
      case 'cursor':
        return listCursorSkills(workspacePath);
      case 'gemini':
        return listGeminiSkills(workspacePath);
      default:
        return [];
    }
  },
};

/**
 * Reads Claude user/project skills and plugin skills with plugin namespace commands.
 */
async function listClaudeSkills(workspacePath: string): Promise<UnifiedSkill[]> {
  const home = os.homedir();
  const skills: UnifiedSkill[] = [];

  skills.push(
    ...(await listSkillsFromDirectory({
      provider: 'claude',
      scope: 'user',
      skillsDirectory: path.join(home, '.claude', 'skills'),
      invocationPrefix: '/',
    })),
  );

  skills.push(
    ...(await listSkillsFromDirectory({
      provider: 'claude',
      scope: 'project',
      skillsDirectory: path.join(workspacePath, '.claude', 'skills'),
      invocationPrefix: '/',
    })),
  );

  const enabledPlugins = await readClaudeEnabledPlugins();
  if (!enabledPlugins.length) {
    return skills;
  }

  const installedPluginIndex = await readClaudeInstalledPluginIndex();
  for (const pluginId of enabledPlugins) {
    const pluginInstalls = installedPluginIndex[pluginId];
    if (!Array.isArray(pluginInstalls)) {
      continue;
    }

    const pluginNamespace = pluginId.split('@')[0] ?? pluginId;
    for (const install of pluginInstalls) {
      if (!install || typeof install !== 'object') {
        continue;
      }
      const installPath = typeof (install as Record<string, unknown>).installPath === 'string'
        ? (install as Record<string, unknown>).installPath as string
        : '';
      if (!installPath) {
        continue;
      }

      const pluginSkills = await listSkillsFromDirectory({
        provider: 'claude',
        scope: 'plugin',
        skillsDirectory: path.join(installPath, 'skills'),
        invocationPrefix: '/',
        pluginName: pluginNamespace,
      });

      for (const skill of pluginSkills) {
        skill.invocation = `/${pluginNamespace}:${skill.name}`;
        skill.pluginName = pluginNamespace;
      }

      skills.push(...pluginSkills);
    }
  }

  return deduplicateSkills(skills);
}

/**
 * Reads Codex skills from repo/user/admin/system locations.
 */
async function listCodexSkills(workspacePath: string): Promise<UnifiedSkill[]> {
  const home = os.homedir();
  const repoRoot = await findGitRepoRoot(workspacePath);
  const candidateDirectories: Array<{ scope: SkillScope; directory: string }> = [
    { scope: 'repo', directory: path.join(workspacePath, '.agents', 'skills') },
    { scope: 'repo', directory: path.join(workspacePath, '..', '.agents', 'skills') },
    { scope: 'user', directory: path.join(home, '.agents', 'skills') },
    { scope: 'admin', directory: path.join(path.sep, 'etc', 'codex', 'skills') },
    { scope: 'system', directory: path.join(home, '.codex', 'skills', '.system') },
  ];
  if (repoRoot) {
    candidateDirectories.push({ scope: 'repo', directory: path.join(repoRoot, '.agents', 'skills') });
  }

  const skills: UnifiedSkill[] = [];
  for (const candidate of deduplicateDirectories(candidateDirectories)) {
    const loadedSkills = await listSkillsFromDirectory({
      provider: 'codex',
      scope: candidate.scope,
      skillsDirectory: candidate.directory,
      invocationPrefix: '$',
    });
    skills.push(...loadedSkills);
  }

  return deduplicateSkills(skills);
}

/**
 * Reads Gemini user/project skill directories.
 */
async function listGeminiSkills(workspacePath: string): Promise<UnifiedSkill[]> {
  const home = os.homedir();
  const candidateDirectories: Array<{ scope: SkillScope; directory: string }> = [
    { scope: 'user', directory: path.join(home, '.gemini', 'skills') },
    { scope: 'user', directory: path.join(home, '.agents', 'skills') },
    { scope: 'project', directory: path.join(workspacePath, '.gemini', 'skills') },
    { scope: 'project', directory: path.join(workspacePath, '.agents', 'skills') },
  ];

  const skills: UnifiedSkill[] = [];
  for (const candidate of deduplicateDirectories(candidateDirectories)) {
    const loadedSkills = await listSkillsFromDirectory({
      provider: 'gemini',
      scope: candidate.scope,
      skillsDirectory: candidate.directory,
      invocationPrefix: '/',
    });
    skills.push(...loadedSkills);
  }

  return deduplicateSkills(skills);
}

/**
 * Reads Cursor user/project skill directories.
 */
async function listCursorSkills(workspacePath: string): Promise<UnifiedSkill[]> {
  const home = os.homedir();
  const candidateDirectories: Array<{ scope: SkillScope; directory: string }> = [
    { scope: 'project', directory: path.join(workspacePath, '.agents', 'skills') },
    { scope: 'project', directory: path.join(workspacePath, '.cursor', 'skills') },
    { scope: 'user', directory: path.join(home, '.cursor', 'skills') },
  ];

  const skills: UnifiedSkill[] = [];
  for (const candidate of deduplicateDirectories(candidateDirectories)) {
    const loadedSkills = await listSkillsFromDirectory({
      provider: 'cursor',
      scope: candidate.scope,
      skillsDirectory: candidate.directory,
      invocationPrefix: '/',
    });
    skills.push(...loadedSkills);
  }

  return deduplicateSkills(skills);
}

/**
 * Reads SKILL.md files from a `<skills-dir>/<skill-name>/SKILL.md` directory layout.
 */
async function listSkillsFromDirectory(input: {
  provider: LLMProvider;
  scope: SkillScope;
  skillsDirectory: string;
  invocationPrefix: '/' | '$';
  pluginName?: string;
}): Promise<UnifiedSkill[]> {
  if (!(await pathExists(input.skillsDirectory))) {
    return [];
  }

  const entries = await readdir(input.skillsDirectory, { withFileTypes: true });
  const skills: UnifiedSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillDirectory = path.join(input.skillsDirectory, entry.name);
    const skillFilePath = path.join(skillDirectory, 'SKILL.md');
    if (!(await pathExists(skillFilePath))) {
      continue;
    }

    const skillMarkdown = await readFile(skillFilePath, 'utf8');
    const metadata = parseSkillFrontmatter(skillMarkdown);
    const skillName = metadata.name ?? entry.name;
    const invocation = `${input.invocationPrefix}${skillName}`;
    skills.push({
      provider: input.provider,
      scope: input.scope,
      name: skillName,
      description: metadata.description,
      invocation,
      filePath: skillFilePath,
      pluginName: input.pluginName,
    });
  }

  return skills;
}

/**
 * Parses frontmatter metadata from SKILL.md files.
 */
function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith('---')) {
    return {};
  }

  const closingDelimiterIndex = content.indexOf('\n---', 3);
  if (closingDelimiterIndex < 0) {
    return {};
  }

  const frontmatter = content.slice(3, closingDelimiterIndex).trim();
  const metadata: { name?: string; description?: string } = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (key === 'name') {
      metadata.name = value;
    } else if (key === 'description') {
      metadata.description = value;
    }
  }

  return metadata;
}

/**
 * Reads Claude enabled plugin map from ~/.claude/settings.json.
 */
async function readClaudeEnabledPlugins(): Promise<string[]> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const settingsContent = await readFile(settingsPath, 'utf8');
    const settings = JSON.parse(settingsContent) as Record<string, unknown>;
    const enabledPlugins = settings.enabledPlugins;
    if (!enabledPlugins || typeof enabledPlugins !== 'object' || Array.isArray(enabledPlugins)) {
      return [];
    }

    const enabledRecords = enabledPlugins as Record<string, unknown>;
    return Object.entries(enabledRecords)
      .filter(([, enabled]) => enabled === true)
      .map(([pluginId]) => pluginId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Reads Claude installed plugin index from ~/.claude/plugins/installed_plugins.json.
 */
async function readClaudeInstalledPluginIndex(): Promise<Record<string, unknown[]>> {
  const pluginIndexPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  try {
    const indexContent = await readFile(pluginIndexPath, 'utf8');
    const index = JSON.parse(indexContent) as Record<string, unknown>;
    const plugins = index.plugins;
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
      return {};
    }

    const normalized: Record<string, unknown[]> = {};
    for (const [pluginId, entries] of Object.entries(plugins as Record<string, unknown>)) {
      normalized[pluginId] = Array.isArray(entries) ? entries : [];
    }

    return normalized;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/**
 * Finds the closest git root by walking up from the current workspace path.
 */
async function findGitRepoRoot(startPath: string): Promise<string | null> {
  let currentPath = path.resolve(startPath);
  while (true) {
    const gitPath = path.join(currentPath, '.git');
    if (await pathExists(gitPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

/**
 * Deduplicates directory candidates by absolute path.
 */
function deduplicateDirectories(
  entries: Array<{ scope: SkillScope; directory: string }>,
): Array<{ scope: SkillScope; directory: string }> {
  const seen = new Set<string>();
  const deduplicated: Array<{ scope: SkillScope; directory: string }> = [];
  for (const entry of entries) {
    const normalizedDirectory = path.resolve(entry.directory);
    if (seen.has(normalizedDirectory)) {
      continue;
    }
    seen.add(normalizedDirectory);
    deduplicated.push({ scope: entry.scope, directory: normalizedDirectory });
  }

  return deduplicated;
}

/**
 * Deduplicates skills by provider + invocation command.
 */
function deduplicateSkills(skills: UnifiedSkill[]): UnifiedSkill[] {
  const seen = new Set<string>();
  const deduplicated: UnifiedSkill[] = [];
  for (const skill of skills) {
    const key = `${skill.provider}:${skill.invocation}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduplicated.push(skill);
  }

  return deduplicated;
}

/**
 * Tests whether a path exists.
 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
