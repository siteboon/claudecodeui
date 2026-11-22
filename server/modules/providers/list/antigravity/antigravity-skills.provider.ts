import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

/**
 * Skill discovery for Antigravity.
 *
 * agy ships built-in skills under `<app-data>/builtin/skills` and reads
 * user-managed ones from the same app-data directory; project skills follow
 * the shared `.agents/skills` convention agy-staff also uses. Skills are
 * invoked with a slash command in agy, so every source uses the `/` prefix.
 */
function antigravityAppDataDir(): string {
  return process.env.ANTIGRAVITY_APP_DATA_DIR?.trim()
    || path.join(os.homedir(), '.gemini', 'antigravity-cli');
}

export class AntigravitySkillsProvider extends SkillsProvider {
  constructor() {
    super('antigravity');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    return [
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.agents', 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.antigravity', 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'user',
        rootDir: path.join(antigravityAppDataDir(), 'skills'),
        commandPrefix: '/',
      },
    ];
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(antigravityAppDataDir(), 'skills'),
      commandPrefix: '/',
    };
  }
}
