import os from 'node:os';
import path from 'node:path';

import type { IProviderSkillsRuntime, ProviderSkill, ProviderSkillScope } from '@/modules/ai-runtime/types/index.js';
import {
  deduplicateDirectories,
  deduplicateSkills,
  findGitRepoRoot,
  listSkillsFromDirectory,
} from '@/modules/ai-runtime/providers/shared/skills/skills-runtime.utils.js';

/**
 * Codex skills runtime backed by repo/user/admin/system skill directories.
 */
export class CodexSkillsRuntime implements IProviderSkillsRuntime {
  /**
   * Lists all available Codex skills from documented directories.
   */
  async listSkills(options?: { workspacePath?: string }): Promise<ProviderSkill[]> {
    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    const home = os.homedir();
    const repoRoot = await findGitRepoRoot(workspacePath);
    const candidateDirectories: Array<{ scope: ProviderSkillScope; directory: string }> = [
      { scope: 'repo', directory: path.join(workspacePath, '.agents', 'skills') },
      { scope: 'repo', directory: path.join(workspacePath, '..', '.agents', 'skills') },
      { scope: 'user', directory: path.join(home, '.agents', 'skills') },
      { scope: 'admin', directory: path.join(path.sep, 'etc', 'codex', 'skills') },
      { scope: 'system', directory: path.join(home, '.codex', 'skills', '.system') },
    ];
    if (repoRoot) {
      candidateDirectories.push({ scope: 'repo', directory: path.join(repoRoot, '.agents', 'skills') });
    }

    const skills: ProviderSkill[] = [];
    for (const candidate of deduplicateDirectories(candidateDirectories)) {
      const loadedSkills = await listSkillsFromDirectory({
        provider: 'codex',
        scope: candidate.scope,
        skillsDirectory: candidate.directory,
        invocationPrefix: '$',
      });
      skills.push(...loadedSkills);
    }

    return deduplicateSkills(skills);
  }
}
