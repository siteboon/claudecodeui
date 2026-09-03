import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ClaudeSkillsProvider } from '@/modules/providers/list/claude/claude-skills.provider.js';
import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type {
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderSkillSource,
} from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findTopmostGitRoot,
  getProjectSkillSearchRoots,
} from '@/shared/utils.js';

// omp reads several agents' skill libraries and resolves name collisions by
// provider priority, first match wins. These groups are ordered accordingly:
// native `.omp` (100) > Claude `.claude` (80) > Claude marketplace plugins,
// `.agent`/`.agents` and `.codex` (70) > OpenCode (55) > `.github` (30) >
// auto-learn managed skills (5). omp's own plugins (90) register their skills
// programmatically rather than from a skills directory, so no root exists to
// scan for them.
const OMP_NATIVE_PROJECT_SKILL_DIRS = [['.omp', 'skills']];
const OMP_CLAUDE_PROJECT_SKILL_DIRS = [['.claude', 'skills']];

const OMP_NATIVE_USER_SKILL_DIRS = [['.omp', 'agent', 'skills']];
const OMP_CLAUDE_USER_SKILL_DIRS = [['.claude', 'skills']];

// One entry per omp discovery provider below the plugin tier, highest priority
// first. Within a tier omp reads the project roots before the user one, so the
// pair has to stay together: flattening every project root ahead of every user
// root inverted the ranking, letting `<repo>/.github/skills` (30) shadow a name
// in `~/.codex/skills` (70).
const OMP_COMPATIBILITY_SKILL_TIERS: { project: string[][]; user: string[][] }[] = [
  { project: [['.agent', 'skills'], ['.agents', 'skills']], user: [['.agent', 'skills'], ['.agents', 'skills']] },
  { project: [['.codex', 'skills']], user: [['.codex', 'skills']] },
  { project: [['.opencode', 'skills']], user: [['.config', 'opencode', 'skills']] },
  { project: [['.github', 'skills']], user: [] },
  { project: [], user: [['.omp', 'agent', 'managed-skills']] },
];

/**
 * Reads the skill names omp suppresses, from `skills.ignoredSkills` in its config.
 *
 * omp hides skills by name across every source it reads, so a listing that
 * ignored this would advertise commands the agent itself refuses to load. The
 * config is YAML and this is the only key the adapter needs, so the one block
 * is read directly instead of taking on a YAML parser.
 */
const readIgnoredSkillNames = async (ompAgentHome: string): Promise<Set<string>> => {
  const ignoredSkillNames = new Set<string>();

  let content: string;
  try {
    content = await readFile(path.join(ompAgentHome, 'config.yml'), 'utf8');
  } catch {
    return ignoredSkillNames;
  }

  let inSkills = false;
  let inIgnoredSkills = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // A key at column zero ends the `skills:` mapping and any list inside it.
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      inSkills = trimmed.startsWith('skills:');
      inIgnoredSkills = false;
      continue;
    }

    if (!inSkills) {
      continue;
    }

    if (!trimmed.startsWith('- ')) {
      inIgnoredSkills = trimmed.startsWith('ignoredSkills:');
      continue;
    }

    if (inIgnoredSkills) {
      ignoredSkillNames.add(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''));
    }
  }

  return ignoredSkillNames;
};

export class OmpSkillsProvider extends SkillsProvider {
  constructor() {
    super('omp');
  }

  async listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    const repoRoot = await findTopmostGitRoot(workspacePath);
    const { rankedAbovePlugins, rankedBelowPlugins } = this.buildSkillSourceGroups(
      workspacePath,
      repoRoot,
    );

    const [skillsAbovePlugins, pluginSkills, skillsBelowPlugins, ignoredSkillNames] =
      await Promise.all([
        this.scanSkillSources(rankedAbovePlugins),
        new ClaudeSkillsProvider().listSkills(options).then((skills) =>
          skills
            .filter((skill) => skill.scope === 'plugin')
            .map((skill) => ({ ...skill, provider: this.provider })),
        ),
        this.scanSkillSources(rankedBelowPlugins),
        readIgnoredSkillNames(path.join(os.homedir(), '.omp', 'agent')),
      ]);

    // First match wins, exactly like omp's own shadowing: the same skill name
    // reached through two roots (`~/.agents/skills` is commonly a symlink to
    // `~/.claude/skills`) must appear once, owned by the higher tier.
    const skills: ProviderSkill[] = [];
    const claimedSkillNames = new Set<string>();
    for (const skill of [...skillsAbovePlugins, ...pluginSkills, ...skillsBelowPlugins]) {
      if (ignoredSkillNames.has(skill.name) || claimedSkillNames.has(skill.name)) {
        continue;
      }

      claimedSkillNames.add(skill.name);
      skills.push(skill);
    }

    return skills;
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const repoRoot = await findTopmostGitRoot(workspacePath);
    const groups = this.buildSkillSourceGroups(workspacePath, repoRoot);

    return [...groups.rankedAbovePlugins, ...groups.rankedBelowPlugins];
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(os.homedir(), ...OMP_NATIVE_USER_SKILL_DIRS[0]),
      commandPrefix: '/',
    };
  }

  /**
   * Builds omp's skill roots, split where Claude plugin skills rank.
   *
   * Plugin skills come from a registry rather than a root, so they cannot ride
   * along in one source list; the caller scans each group and concatenates them
   * with the plugin skills in between.
   */
  private buildSkillSourceGroups(
    workspacePath: string,
    repoRoot: string | null,
  ): { rankedAbovePlugins: ProviderSkillSource[]; rankedBelowPlugins: ProviderSkillSource[] } {
    const projectRoots = getProjectSkillSearchRoots(workspacePath, repoRoot);
    const seenRootDirs = new Set<string>();

    const addSources = (
      target: ProviderSkillSource[],
      scope: 'project' | 'user',
      baseDirs: string[],
      skillDirs: string[][],
    ): void => {
      for (const baseDir of baseDirs) {
        for (const skillDir of skillDirs) {
          addUniqueProviderSkillSource(target, seenRootDirs, {
            scope,
            rootDir: path.join(baseDir, ...skillDir),
            commandPrefix: '/',
          });
        }
      }
    };

    const rankedAbovePlugins: ProviderSkillSource[] = [];
    addSources(rankedAbovePlugins, 'project', projectRoots, OMP_NATIVE_PROJECT_SKILL_DIRS);
    addSources(rankedAbovePlugins, 'user', [os.homedir()], OMP_NATIVE_USER_SKILL_DIRS);
    addSources(rankedAbovePlugins, 'project', projectRoots, OMP_CLAUDE_PROJECT_SKILL_DIRS);
    addSources(rankedAbovePlugins, 'user', [os.homedir()], OMP_CLAUDE_USER_SKILL_DIRS);

    const rankedBelowPlugins: ProviderSkillSource[] = [];
    for (const tier of OMP_COMPATIBILITY_SKILL_TIERS) {
      addSources(rankedBelowPlugins, 'project', projectRoots, tier.project);
      addSources(rankedBelowPlugins, 'user', [os.homedir()], tier.user);
    }

    return { rankedAbovePlugins, rankedBelowPlugins };
  }
}
