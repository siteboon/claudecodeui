import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import { parseFrontMatter } from '@/shared/frontmatter.js';
import type {
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderSkillSource,
} from '@/shared/types.js';
import {
  findProviderSkillMarkdownFiles,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readProviderSkillMarkdownDefinition,
} from '@/shared/utils.js';

const getClaudeHomePath = (): string => path.join(os.homedir(), '.claude');

const getClaudePluginName = (pluginId: string): string | null => {
  const normalizedPluginId = pluginId.trim();
  if (!normalizedPluginId || normalizedPluginId === '@') {
    return null;
  }

  const [pluginName] = normalizedPluginId.split('@');
  return readOptionalString(pluginName) ?? null;
};

const stripMarkdownExtension = (filename: string): string =>
  filename.replace(/\.md$/i, '');

const pathExistsAsDirectory = async (directoryPath: string): Promise<boolean> => {
  try {
    const directoryStats = await stat(directoryPath);
    return directoryStats.isDirectory();
  } catch {
    return false;
  }
};

const listChildDirectories = async (directoryPath: string): Promise<string[]> => {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directoryPath, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
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

export class ClaudeSkillsProvider extends SkillsProvider {
  constructor() {
    super('claude');
  }

  async listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    return [
      ...(await super.listSkills(options)),
      ...(await this.listPluginSkills(getClaudeHomePath())),
    ];
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const claudeHomePath = getClaudeHomePath();

    return [
      {
        scope: 'user',
        rootDir: path.join(claudeHomePath, 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.claude', 'skills'),
        commandPrefix: '/',
      },
    ];
  }

  private async listPluginSkills(claudeHomePath: string): Promise<ProviderSkill[]> {
    const settings = await readJsonConfig(path.join(claudeHomePath, 'settings.json'));
    const enabledPlugins = readObjectRecord(settings.enabledPlugins);
    if (!enabledPlugins) {
      return [];
    }

    const installedConfig = await readJsonConfig(
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

        // Claude's installed path points at one version folder; the usable
        // plugin payloads live in the direct child folders beside it.
        const pluginFolders = await listChildDirectories(path.dirname(installPath));
        for (const pluginFolder of pluginFolders) {
          const pluginFolderKey = `${pluginId}:${path.resolve(pluginFolder)}`;
          if (visitedPluginFolders.has(pluginFolderKey)) {
            continue;
          }
          visitedPluginFolders.add(pluginFolderKey);

          const pluginName = await readClaudePluginName(pluginFolder, pluginId);
          if (!pluginName) {
            continue;
          }

          const commandsPath = path.join(pluginFolder, 'commands');
          if (await pathExistsAsDirectory(commandsPath)) {
            skills.push(
              ...(await this.listPluginCommandSkills(commandsPath, pluginId, pluginName)),
            );
            continue;
          }

          const skillsPath = path.join(pluginFolder, 'skills');
          if (!(await pathExistsAsDirectory(skillsPath))) {
            continue;
          }

          skills.push(
            ...(await this.listPluginSkillMarkdowns(pluginFolder, pluginId, pluginName)),
          );
        }
      }
    }

    return skills;
  }

  private async listPluginCommandSkills(
    commandsPath: string,
    pluginId: string,
    pluginName: string,
  ): Promise<ProviderSkill[]> {
    const skills: ProviderSkill[] = [];

    try {
      const entries = await readdir(commandsPath, { withFileTypes: true });
      const commandFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .sort((left, right) => left.name.localeCompare(right.name));

      for (const commandFile of commandFiles) {
        const sourcePath = path.join(commandsPath, commandFile.name);
        try {
          const definition = await this.readPluginCommandDefinition(sourcePath);
          skills.push({
            provider: this.provider,
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
  }

  private async readPluginCommandDefinition(
    commandPath: string,
  ): Promise<{ name: string; description: string }> {
    const content = await readFile(commandPath, 'utf8');
    const parsed = parseFrontMatter(content);
    const data = readObjectRecord(parsed.data) ?? {};

    return {
      name: stripMarkdownExtension(path.basename(commandPath)),
      description: readOptionalString(data.description) ?? '',
    };
  }

  private async listPluginSkillMarkdowns(
    installPath: string,
    pluginId: string,
    pluginName: string,
  ): Promise<ProviderSkill[]> {
    const skillFiles = await findProviderSkillMarkdownFiles(path.join(installPath, 'skills'), {
      recursive: true,
    });
    const skills: ProviderSkill[] = [];

    for (const skillPath of skillFiles) {
      try {
        const definition = await readProviderSkillMarkdownDefinition(skillPath);
        skills.push({
          provider: this.provider,
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
  }
}
