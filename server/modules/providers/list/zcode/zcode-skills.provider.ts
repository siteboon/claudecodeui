import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

/**
 * ZCode skills provider implementing ZCode-native skill discovery.
 *
 * Per integration plan §3.2.7, ZCode reads the same `.agents/skills`
 * SKILL.md ecosystem as the other CLI providers for project and user
 * scopes. Plugin skills under the ZCode plugin cache are a deliberate
 * second-phase enhancement and are not listed in v1.
 */
export class ZCodeSkillsProvider extends SkillsProvider {
  constructor() {
    super('zcode');
  }

  /**
   * Returns ZCode skill sources for project and user scopes.
   * Based on integration plan §3.2.7 with .agents/skills structure.
   */
  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    return [
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.agents', 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'user',
        rootDir: path.join(os.homedir(), '.agents', 'skills'),
        commandPrefix: '/',
      },
    ];
  }

  /**
   * Returns the global user skill source for write operations.
   */
  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.agents', 'skills'),
      commandPrefix: '/',
    };
  }
}
