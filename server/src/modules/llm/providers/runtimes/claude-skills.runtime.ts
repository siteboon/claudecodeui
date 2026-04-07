import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { IProviderSkillsRuntime, ProviderSkill } from '@/modules/llm/providers/provider.interface.js';
import { deduplicateSkills, listSkillsFromDirectory } from '@/modules/llm/providers/runtimes/skills-runtime.utils.js';

/**
 * Claude skills runtime backed by user/project/plugin skill directories.
 */
export class ClaudeSkillsRuntime implements IProviderSkillsRuntime {
  /**
   * Lists all available Claude skills from user/project/plugin locations.
   */
  async listSkills(options?: { workspacePath?: string }): Promise<ProviderSkill[]> {
    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    const home = os.homedir();
    const skills: ProviderSkill[] = [];

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

    const enabledPlugins = await this.readClaudeEnabledPlugins();
    if (!enabledPlugins.length) {
      return skills;
    }

    const installedPluginIndex = await this.readClaudeInstalledPluginIndex();
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
   * Reads Claude enabled plugin map from `~/.claude/settings.json`.
   */
  private async readClaudeEnabledPlugins(): Promise<string[]> {
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
   * Reads Claude installed plugin index from `~/.claude/plugins/installed_plugins.json`.
   */
  private async readClaudeInstalledPluginIndex(): Promise<Record<string, unknown[]>> {
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
}
