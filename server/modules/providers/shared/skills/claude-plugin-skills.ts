import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { parseFrontMatter } from '@/shared/frontmatter.js';
import type { LLMProvider, ProviderSkill } from '@/shared/types.js';
import {
  findProviderSkillMarkdownFiles,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readProviderSkillMarkdownDefinition,
} from '@/shared/utils.js';

/**
 * Claude Code marketplace plugins ship skills outside any `skills` root, so they
 * are discovered through the plugin registry instead of a directory scan. Shared
 * because omp reads the same installed plugins as one of its own skill tiers.
 */

const getClaudePluginName = (pluginId: string): string | null => {
  const normalizedPluginId = pluginId.trim();
  if (!normalizedPluginId || normalizedPluginId === '@') {
    return null;
  }

  const [pluginName] = normalizedPluginId.split('@');
  return readOptionalString(pluginName) ?? null;
};

const pathExistsAsDirectory = async (directoryPath: string): Promise<boolean> => {
  try {
    const directoryStats = await stat(directoryPath);
    return directoryStats.isDirectory();
  } catch {
    return false;
  }
};

const readClaudePluginName = async (
  installPath: string,
  pluginId: string,
): Promise<string | null> => {
  try {
    const pluginConfig = await readJsonConfig(
      path.join(installPath, '.claude-plugin', 'plugin.json'),
    );

    // Older or partial plugin installs may not have plugin.json yet. Falling
    // back keeps discovery useful without inventing a separate namespace.
    return readOptionalString(pluginConfig.name) ?? getClaudePluginName(pluginId);
  } catch {
    return getClaudePluginName(pluginId);
  }
};

const readPluginCommandDefinition = async (
  commandPath: string,
): Promise<{ name: string; description: string }> => {
  const content = await readFile(commandPath, 'utf8');
  const parsed = parseFrontMatter(content);
  const data = readObjectRecord(parsed.data) ?? {};

  return {
    name: path.basename(commandPath).replace(/\.md$/i, ''),
    description: readOptionalString(data.description) ?? '',
  };
};

const listPluginCommandSkills = async (
  provider: LLMProvider,
  commandsPath: string,
  pluginId: string,
  pluginName: string,
): Promise<ProviderSkill[]> => {
  const skills: ProviderSkill[] = [];

  try {
    const entries = await readdir(commandsPath, { withFileTypes: true });
    const commandFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const commandFile of commandFiles) {
      const sourcePath = path.join(commandsPath, commandFile.name);
      try {
        const definition = await readPluginCommandDefinition(sourcePath);
        skills.push({
          provider,
          name: definition.name,
          description: definition.description,
          command: `/${pluginName}:${definition.name}`,
          scope: 'plugin',
          sourcePath,
          pluginName,
          pluginId,
        });
      } catch {
        // Malformed command markdown should not block sibling plugin commands.
      }
    }
  } catch {
    // Missing or unreadable command folders are treated as empty plugin command sets.
  }

  return skills;
};

const listPluginSkillMarkdowns = async (
  provider: LLMProvider,
  installPath: string,
  pluginId: string,
  pluginName: string,
): Promise<ProviderSkill[]> => {
  const skillFiles = await findProviderSkillMarkdownFiles(path.join(installPath, 'skills'), {
    recursive: true,
  });
  const skills: ProviderSkill[] = [];

  for (const skillPath of skillFiles) {
    try {
      const definition = await readProviderSkillMarkdownDefinition(skillPath);
      skills.push({
        provider,
        name: definition.name,
        description: definition.description,
        command: `/${pluginName}:${definition.name}`,
        scope: 'plugin',
        sourcePath: skillPath,
        pluginName,
        pluginId,
      });
    } catch {
      // A bad plugin skill file should not block other installed plugin skills.
    }
  }

  return skills;
};

/**
 * Reads one of Claude's JSON configs, treating malformed content as absent.
 *
 * `readJsonConfig` maps a missing file to `{}` but rethrows a parse error. This
 * reader is now shared by every provider that surfaces Claude plugin skills, so
 * a single unparseable `settings.json` would empty all of their skill lists at
 * once. Warn and degrade to "no plugins" so the other skill tiers survive.
 */
const readClaudeJsonConfig = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    return await readJsonConfig(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Skills] Ignoring unreadable Claude config ${filePath}: ${message}`);
    return {};
  }
};

/**
 * Lists the skills of every enabled Claude Code plugin, attributed to `provider`.
 */
export async function listClaudePluginSkills(
  provider: LLMProvider,
  claudeHomePath: string,
): Promise<ProviderSkill[]> {
  const settings = await readClaudeJsonConfig(path.join(claudeHomePath, 'settings.json'));
  const enabledPlugins = readObjectRecord(settings.enabledPlugins);
  if (!enabledPlugins) {
    return [];
  }

  const installedConfig = await readClaudeJsonConfig(
    path.join(claudeHomePath, 'plugins', 'installed_plugins.json'),
  );
  const installedPlugins = readObjectRecord(installedConfig.plugins);
  if (!installedPlugins) {
    return [];
  }

  const skills: ProviderSkill[] = [];
  const visitedPluginFolders = new Set<string>();
  const pluginEntries = Object.entries(enabledPlugins)
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [pluginId, enabled] of pluginEntries) {
    if (enabled !== true) {
      continue;
    }

    const installs = installedPlugins[pluginId];
    if (!Array.isArray(installs)) {
      continue;
    }

    for (const install of installs) {
      const installRecord = readObjectRecord(install);
      const installPath = readOptionalString(installRecord?.installPath);
      if (!installPath) {
        continue;
      }

      if (!(await pathExistsAsDirectory(installPath))) {
        continue;
      }

      const pluginFolderKey = `${pluginId}:${path.resolve(installPath)}`;
      if (visitedPluginFolders.has(pluginFolderKey)) {
        continue;
      }
      visitedPluginFolders.add(pluginFolderKey);

      const pluginName = await readClaudePluginName(installPath, pluginId);
      if (!pluginName) {
        continue;
      }

      const commandsPath = path.join(installPath, 'commands');
      const commandSkills = (await pathExistsAsDirectory(commandsPath))
        ? await listPluginCommandSkills(provider, commandsPath, pluginId, pluginName)
        : [];

      // A plugin that ships commands wraps its own skills in them, so the
      // commands are the user-facing surface and the skill files are noise.
      // A commands folder holding nothing this agent can read is not: several
      // plugins keep `.toml` command files there for other harnesses and put
      // the real payload in `skills/`.
      if (commandSkills.length > 0) {
        skills.push(...commandSkills);
        continue;
      }

      if (!(await pathExistsAsDirectory(path.join(installPath, 'skills')))) {
        continue;
      }

      skills.push(
        ...(await listPluginSkillMarkdowns(provider, installPath, pluginId, pluginName)),
      );
    }
  }

  return skills;
}
