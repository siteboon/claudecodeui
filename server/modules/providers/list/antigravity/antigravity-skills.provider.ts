import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

/** Antigravity skill filesystem adapter used by shared skill routes. */
export class AntigravitySkillsProvider extends SkillsProvider {
  /** Initializes the shared skill adapter with the Antigravity provider id. */
  constructor() {
    super('antigravity');
  }

  /** Returns workspace and user AGY skill discovery roots. */
  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    return [
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.agents', 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'user',
        rootDir: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills'),
        commandPrefix: '/',
      },
    ];
  }

  /** Returns the user-level root used by global skill installation. */
  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills'),
      commandPrefix: '/',
    };
  }
}
