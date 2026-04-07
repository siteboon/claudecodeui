import os from 'node:os';
import path from 'node:path';

import type { IProviderSkillsRuntime, ProviderSkill, ProviderSkillScope } from '@/modules/llm/providers/provider.interface.js';
import {
  deduplicateDirectories,
  deduplicateSkills,
  listSkillsFromDirectory,
} from '@/modules/llm/providers/runtimes/skills-runtime.utils.js';

/**
 * Cursor skills runtime backed by user/project skill directories.
 */
export class CursorSkillsRuntime implements IProviderSkillsRuntime {
  /**
   * Lists all available Cursor skills from documented directories.
   */
  async listSkills(options?: { workspacePath?: string }): Promise<ProviderSkill[]> {
    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    const home = os.homedir();
    const candidateDirectories: Array<{ scope: ProviderSkillScope; directory: string }> = [
      { scope: 'project', directory: path.join(workspacePath, '.agents', 'skills') },
      { scope: 'project', directory: path.join(workspacePath, '.cursor', 'skills') },
      { scope: 'user', directory: path.join(home, '.cursor', 'skills') },
    ];

    const skills: ProviderSkill[] = [];
    for (const candidate of deduplicateDirectories(candidateDirectories)) {
      const loadedSkills = await listSkillsFromDirectory({
        provider: 'cursor',
        scope: candidate.scope,
        skillsDirectory: candidate.directory,
        invocationPrefix: '/',
      });
      skills.push(...loadedSkills);
    }

    return deduplicateSkills(skills);
  }
}
