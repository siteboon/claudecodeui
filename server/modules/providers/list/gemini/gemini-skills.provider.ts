import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

export class GeminiSkillsProvider extends SkillsProvider {
  constructor() {
    super('gemini');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    return [
      {
        scope: 'user',
        rootDir: path.join(os.homedir(), '.gemini', 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'user',
        rootDir: path.join(os.homedir(), '.agents', 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.gemini', 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.agents', 'skills'),
        commandPrefix: '/',
      },
    ];
  }
}
