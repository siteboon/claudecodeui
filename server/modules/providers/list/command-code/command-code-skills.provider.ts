import os from 'node:os';
import path from 'node:path';

import { getCommandCodeHomePath } from '@/modules/providers/list/command-code/command-code-auth.provider.js';
import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findTopmostGitRoot,
} from '@/shared/utils.js';

const COMMAND_CODE_PROJECT_SKILL_DIRS = [
  ['.commandcode', 'skills'],
  ['.agents', 'skills'],
] as const;

const COMMAND_CODE_USER_SKILL_DIRS = [
  ['.commandcode', 'skills'],
  ['.agents', 'skills'],
] as const;

/**
 * Skills discovery for Command Code.
 *
 * Command Code implements the Agent Skills open standard and also reads the
 * `.agents/skills` compatibility locations, so project skills are discovered
 * from `.commandcode/skills` and `.agents/skills` walking up to the git root,
 * and user skills from `~/.commandcode/skills` and `~/.agents/skills`.
 * `.commandcode/skills` wins name conflicts over `.agents/skills`, which the
 * shared scanner resolves by root precedence (project before user) plus the
 * physical dedupe of identical roots.
 */
export class CommandCodeSkillsProvider extends SkillsProvider {
  constructor() {
    super('command-code');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();
    const repoRoot = await findTopmostGitRoot(workspacePath);

    for (const projectRoot of this.getProjectSearchRoots(workspacePath, repoRoot)) {
      for (const skillDir of COMMAND_CODE_PROJECT_SKILL_DIRS) {
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'project',
          rootDir: path.join(projectRoot, ...skillDir),
          commandPrefix: '/',
        });
      }
    }

    for (const skillDir of COMMAND_CODE_USER_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir: path.join(os.homedir(), ...skillDir),
        commandPrefix: '/',
      });
    }

    return sources;
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(getCommandCodeHomePath(), 'skills'),
      commandPrefix: '/',
    };
  }

  private getProjectSearchRoots(workspacePath: string, repoRoot: string | null): string[] {
    const roots: string[] = [];
    const normalizedWorkspacePath = path.resolve(workspacePath);
    const normalizedRepoRoot = repoRoot ? path.resolve(repoRoot) : null;
    let currentPath = normalizedWorkspacePath;

    while (true) {
      roots.push(currentPath);
      if (!normalizedRepoRoot || currentPath === normalizedRepoRoot) {
        break;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }

      currentPath = parentPath;
    }

    return roots;
  }
}
