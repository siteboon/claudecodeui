/**
 * Antigravity Skills Provider
 *
 * Implements skill discovery for the Antigravity CLI (agy).
 * Discovers skills in `<workspace>/.agents/skills` and `~/.gemini/config/skills`.
 *
 * @module antigravity-skills.provider
 */

import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

export class AntigravitySkillsProvider extends SkillsProvider {
  constructor() {
    super('antigravity');
  }

  /**
   * Returns Antigravity skill sources for project and user scopes.
   *
   * agy reads user-level skills from `~/.gemini/config/skills/<name>/SKILL.md`;
   * `~/.agents/skills` is kept as a secondary source for cross-tool setups.
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
        rootDir: path.join(os.homedir(), '.gemini', 'config', 'skills'),
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
      rootDir: path.join(os.homedir(), '.gemini', 'config', 'skills'),
      commandPrefix: '/',
    };
  }
}
