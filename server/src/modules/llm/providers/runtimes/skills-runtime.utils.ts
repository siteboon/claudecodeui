import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { LLMProvider } from '@/shared/types/app.js';
import type { ProviderSkill, ProviderSkillScope } from '@/modules/llm/providers/provider.interface.js';

/**
 * Tests whether a path exists.
 */
export const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Parses frontmatter metadata from SKILL.md files.
 */
export const parseSkillFrontmatter = (content: string): { name?: string; description?: string } => {
  if (!content.startsWith('---')) {
    return {};
  }

  const closingDelimiterIndex = content.indexOf('\n---', 3);
  if (closingDelimiterIndex < 0) {
    return {};
  }

  const frontmatter = content.slice(3, closingDelimiterIndex).trim();
  const metadata: { name?: string; description?: string } = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (key === 'name') {
      metadata.name = value;
    } else if (key === 'description') {
      metadata.description = value;
    }
  }

  return metadata;
};

/**
 * Reads SKILL.md files from a `<skills-dir>/<skill-name>/SKILL.md` directory layout.
 */
export const listSkillsFromDirectory = async (input: {
  provider: LLMProvider;
  scope: ProviderSkillScope;
  skillsDirectory: string;
  invocationPrefix: '/' | '$';
  pluginName?: string;
}): Promise<ProviderSkill[]> => {
  if (!(await pathExists(input.skillsDirectory))) {
    return [];
  }

  const entries = await readdir(input.skillsDirectory, { withFileTypes: true });
  const skills: ProviderSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillDirectory = path.join(input.skillsDirectory, entry.name);
    const skillFilePath = path.join(skillDirectory, 'SKILL.md');
    if (!(await pathExists(skillFilePath))) {
      continue;
    }

    const skillMarkdown = await readFile(skillFilePath, 'utf8');
    const metadata = parseSkillFrontmatter(skillMarkdown);
    const skillName = metadata.name ?? entry.name;
    const invocation = `${input.invocationPrefix}${skillName}`;
    skills.push({
      provider: input.provider,
      scope: input.scope,
      name: skillName,
      description: metadata.description,
      invocation,
      filePath: skillFilePath,
      pluginName: input.pluginName,
    });
  }

  return skills;
};

/**
 * Finds the closest git root by walking up from the current workspace path.
 */
export const findGitRepoRoot = async (startPath: string): Promise<string | null> => {
  let currentPath = path.resolve(startPath);
  while (true) {
    const gitPath = path.join(currentPath, '.git');
    if (await pathExists(gitPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
};

/**
 * Deduplicates directory candidates by absolute path.
 */
export const deduplicateDirectories = (
  entries: Array<{ scope: ProviderSkillScope; directory: string }>,
): Array<{ scope: ProviderSkillScope; directory: string }> => {
  const seen = new Set<string>();
  const deduplicated: Array<{ scope: ProviderSkillScope; directory: string }> = [];
  for (const entry of entries) {
    const normalizedDirectory = path.resolve(entry.directory);
    if (seen.has(normalizedDirectory)) {
      continue;
    }
    seen.add(normalizedDirectory);
    deduplicated.push({ scope: entry.scope, directory: normalizedDirectory });
  }

  return deduplicated;
};

/**
 * Deduplicates skills by provider + invocation command.
 */
export const deduplicateSkills = (skills: ProviderSkill[]): ProviderSkill[] => {
  const seen = new Set<string>();
  const deduplicated: ProviderSkill[] = [];
  for (const skill of skills) {
    const key = `${skill.provider}:${skill.invocation}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduplicated.push(skill);
  }

  return deduplicated;
};
