import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type {
  ProviderSkillRegistryActionResult,
  ProviderSkillRegistryInstallInput,
  ProviderSkillRegistrySearchOptions,
  ProviderSkillRegistrySearchResult,
  ProviderSkillSource,
} from '@/shared/types.js';
import { AppError, addUniqueProviderSkillSource, readObjectRecord, readOptionalString } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);
const HERMES_COMMAND =
  (process.env.HERMES_COMMAND_PATH || process.env.HERMES_CLI_PATH || 'hermes').trim().split(/\s+/)[0] || 'hermes';
const HERMES_SKILLS_TIMEOUT_MS = 45_000;
const HERMES_SKILLS_MAX_BUFFER = 1024 * 1024 * 8;

function normalizeSearchResult(value: unknown): ProviderSkillRegistrySearchResult | null {
  const record = readObjectRecord(value);
  if (!record) {
    return null;
  }

  const name = readOptionalString(record.name);
  const identifier = readOptionalString(record.identifier);
  if (!name || !identifier) {
    return null;
  }

  return {
    name,
    identifier,
    source: readOptionalString(record.source) ?? undefined,
    trustLevel: readOptionalString(record.trust_level) ?? readOptionalString(record.trustLevel) ?? undefined,
    description: readOptionalString(record.description) ?? undefined,
  };
}

export class HermesSkillsProvider extends SkillsProvider {
  constructor() {
    super('hermes');
  }

  async searchRegistry(
    query: string,
    options: ProviderSkillRegistrySearchOptions = {},
  ): Promise<ProviderSkillRegistrySearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const args = ['skills', 'search', normalizedQuery, '--json'];
    const source = options.source?.trim();
    if (source) {
      args.push('--source', source);
    }
    if (options.limit && Number.isFinite(options.limit)) {
      args.push('--limit', String(Math.max(1, Math.min(Math.floor(options.limit), 50))));
    }

    const result = await this.runHermes(args);
    try {
      const parsed = JSON.parse(result.stdout);
      return Array.isArray(parsed)
        ? parsed.map(normalizeSearchResult).filter((entry): entry is ProviderSkillRegistrySearchResult => Boolean(entry))
        : [];
    } catch (error) {
      throw new AppError('Hermes returned invalid skill search JSON.', {
        code: 'HERMES_SKILL_SEARCH_PARSE_FAILED',
        statusCode: 502,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async installRegistrySkill(input: ProviderSkillRegistryInstallInput): Promise<ProviderSkillRegistryActionResult> {
    const identifier = input.identifier.trim();
    if (!identifier) {
      throw new AppError('identifier is required.', {
        code: 'HERMES_SKILL_IDENTIFIER_REQUIRED',
        statusCode: 400,
      });
    }

    const args = ['skills', 'install', identifier, '--yes'];
    if (input.category?.trim()) {
      args.push('--category', input.category.trim());
    }
    if (input.name?.trim()) {
      args.push('--name', input.name.trim());
    }
    if (input.force) {
      args.push('--force');
    }

    return this.runHermes(args);
  }

  async uninstallRegistrySkill(name: string): Promise<ProviderSkillRegistryActionResult> {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new AppError('name is required.', {
        code: 'HERMES_SKILL_NAME_REQUIRED',
        statusCode: 400,
      });
    }
    return this.runHermes(['skills', 'uninstall', normalizedName]);
  }

  async checkRegistryUpdates(): Promise<ProviderSkillRegistryActionResult> {
    return this.runHermes(['skills', 'check']);
  }

  async updateRegistrySkills(): Promise<ProviderSkillRegistryActionResult> {
    return this.runHermes(['skills', 'update']);
  }

  async auditRegistrySkills(): Promise<ProviderSkillRegistryActionResult> {
    return this.runHermes(['skills', 'audit']);
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'repo',
      rootDir: path.join(workspacePath, '.hermes', 'skills'),
      commandPrefix: '/',
      recursive: true,
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.hermes', 'skills'),
      commandPrefix: '/',
      recursive: true,
    });

    return sources;
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.hermes', 'skills'),
      commandPrefix: '/',
      recursive: true,
    };
  }

  private async runHermes(args: string[]): Promise<ProviderSkillRegistryActionResult> {
    try {
      const { stdout, stderr } = await execFileAsync(HERMES_COMMAND, args, {
        timeout: HERMES_SKILLS_TIMEOUT_MS,
        maxBuffer: HERMES_SKILLS_MAX_BUFFER,
        env: process.env,
      });
      return { ok: true, stdout, stderr };
    } catch (error) {
      const maybeError = error as Error & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };
      throw new AppError(maybeError.stderr || maybeError.message || 'Hermes skill command failed.', {
        code: 'HERMES_SKILL_COMMAND_FAILED',
        statusCode: 502,
        details: {
          exitCode: maybeError.code,
          stdout: maybeError.stdout,
          stderr: maybeError.stderr,
        },
      });
    }
  }
}
