import os from 'node:os';
import path from 'node:path';

import type { IProviderSkillsRuntime, ProviderSkill, ProviderSkillScope } from '@/modules/ai-runtime/types/index.js';
import {
  deduplicateDirectories,
  deduplicateSkills,
  listSkillsFromDirectory,
} from '@/modules/ai-runtime/providers/shared/skills/skills-runtime.utils.js';

/**
 * Gemini skills runtime backed by user/project skill directories.
 */
export class GeminiSkillsRuntime implements IProviderSkillsRuntime {
  /**
   * Lists all available Gemini skills from documented directories.
   */
  async listSkills(options?: { workspacePath?: string }): Promise<ProviderSkill[]> {
    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    const home = os.homedir();
    const candidateDirectories: Array<{ scope: ProviderSkillScope; directory: string }> = [
      { scope: 'user', directory: path.join(home, '.gemini', 'skills') },
      { scope: 'user', directory: path.join(home, '.agents', 'skills') },
      { scope: 'project', directory: path.join(workspacePath, '.gemini', 'skills') },
      { scope: 'project', directory: path.join(workspacePath, '.agents', 'skills') },
    ];

    const skills: ProviderSkill[] = [];
    for (const candidate of deduplicateDirectories(candidateDirectories)) {
      const loadedSkills = await listSkillsFromDirectory({
        provider: 'gemini',
        scope: candidate.scope,
        skillsDirectory: candidate.directory,
        invocationPrefix: '/',
      });
      skills.push(...loadedSkills);
    }

    return deduplicateSkills(skills);
  }
}
