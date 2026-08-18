import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findTopmostGitRoot,
  getProjectSkillSearchRoots,
} from '@/shared/utils.js';

const OPENCODE_PROJECT_SKILL_DIRS = [
  ['.opencode', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

const OPENCODE_USER_SKILL_DIRS = [
  ['.config', 'opencode', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

export class OpenCodeSkillsProvider extends SkillsProvider {
  constructor() {
    super('opencode');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();
    const repoRoot = await findTopmostGitRoot(workspacePath);

    for (const projectRoot of getProjectSkillSearchRoots(workspacePath, repoRoot)) {
      for (const skillDir of OPENCODE_PROJECT_SKILL_DIRS) {
        // OpenCode intentionally reads Claude and Agents skill folders so users
        // can reuse the same skill libraries across compatible coding agents.
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'project',
          rootDir: path.join(projectRoot, ...skillDir),
          commandPrefix: '/',
        });
      }
    }

    for (const skillDir of OPENCODE_USER_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir: path.join(os.homedir(), ...skillDir),
        commandPrefix: '/',
      });
    }

    return sources;
  }
}
