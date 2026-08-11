import os from 'node:os';
import path from 'node:path';

import { listClaudePluginSkills } from '@/modules/providers/shared/skills/claude-plugin-skills.js';
import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type {
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderSkillSource,
} from '@/shared/types.js';

const getClaudeHomePath = (): string => path.join(os.homedir(), '.claude');

export class ClaudeSkillsProvider extends SkillsProvider {
  constructor() {
    super('claude');
  }

  async listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    return [
      ...(await super.listSkills(options)),
      ...(await listClaudePluginSkills(this.provider, getClaudeHomePath())),
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

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(getClaudeHomePath(), 'skills'),
      commandPrefix: '/',
    };
  }
}
