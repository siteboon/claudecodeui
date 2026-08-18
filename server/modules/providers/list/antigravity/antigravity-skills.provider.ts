/**
 * Antigravity Skills Provider
 *
 * Implements skill discovery for the Antigravity CLI (agy).
 * Discovers skills in `.agents/skills` and `~/.gemini/antigravity/skills`.
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
        rootDir: path.join(os.homedir(), '.gemini', 'antigravity', 'skills'),
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
