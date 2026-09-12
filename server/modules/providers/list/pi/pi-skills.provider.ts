import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

/**
 * Skills adapter for Pi.
 *
 * Phase 1 only exposes Pi's user-level skill folder for reading; the managed
 * global write source stays unset, so the inherited addSkills/removeSkill keep
 * rejecting writes until the skills facet lands.
 */
export class PiSkillsProvider extends SkillsProvider {
  constructor() {
    super('pi');
  }

  protected async getSkillSources(_workspacePath: string): Promise<ProviderSkillSource[]> {
    return [
      {
        scope: 'user',
        rootDir: path.join(os.homedir(), '.pi', 'agent', 'skills'),
        commandPrefix: '/',
      },
    ];
  }
}
