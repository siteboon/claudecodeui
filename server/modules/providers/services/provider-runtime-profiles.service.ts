import os from 'node:os';
import path from 'node:path';

import type {
  LLMProvider,
  ProviderRuntimeProfile,
  ProviderRuntimeProfileSummary,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const RUNTIME_PROFILES_ENV = 'CLOUDCLI_RUNTIME_PROFILES';
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PROVIDERS: readonly LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];

type RuntimeProfilesServiceDependencies = {
  readConfiguration(): string | undefined;
};

const defaultDependencies: RuntimeProfilesServiceDependencies = {
  readConfiguration: () => process.env[RUNTIME_PROFILES_ENV],
};

const isProvider = (value: unknown): value is LLMProvider => (
  typeof value === 'string' && PROVIDERS.includes(value as LLMProvider)
);

const defaultProfile = (provider: LLMProvider): ProviderRuntimeProfile => ({
  id: 'default',
  name: 'Default environment',
  provider,
  description: 'Uses the server process environment and the provider’s default CLI.',
  isDefault: true,
  env: {},
});

const invalidConfiguration = (message: string): AppError => new AppError(
  `${RUNTIME_PROFILES_ENV}: ${message}`,
  { code: 'INVALID_RUNTIME_PROFILES_CONFIGURATION', statusCode: 500 },
);

const readRequiredString = (
  record: Record<string, unknown>,
  field: 'id' | 'name',
  index: number,
): string => {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidConfiguration(`profile ${index + 1} must have a non-empty ${field}.`);
  }
  return value.trim();
};

const parseEnvironment = (value: unknown, index: number): Record<string, string> => {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidConfiguration(`profile ${index + 1} env must be an object of string values.`);
  }

  const environment: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || typeof entry !== 'string') {
      throw invalidConfiguration(`profile ${index + 1} env must contain only string values.`);
    }
    environment[key] = entry;
  }
  return environment;
};

const parseProfiles = (rawConfiguration: string | undefined): ProviderRuntimeProfile[] => {
  if (!rawConfiguration?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfiguration);
  } catch {
    throw invalidConfiguration('must be valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw invalidConfiguration('must be a JSON array.');
  }

  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalidConfiguration(`profile ${index + 1} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const id = readRequiredString(record, 'id', index);
    const name = readRequiredString(record, 'name', index);
    if (id === 'default' || !PROFILE_ID_PATTERN.test(id)) {
      throw invalidConfiguration(
        `profile ${index + 1} id must match ${PROFILE_ID_PATTERN} and cannot be "default".`,
      );
    }
    if (!isProvider(record.provider)) {
      throw invalidConfiguration(`profile ${index + 1} has an unsupported provider.`);
    }

    const key = `${record.provider}:${id}`;
    if (seen.has(key)) {
      throw invalidConfiguration(`profile id "${id}" is duplicated for ${record.provider}.`);
    }
    seen.add(key);

    const executable = record.executable;
    if (executable !== undefined && (typeof executable !== 'string' || !executable.trim())) {
      throw invalidConfiguration(`profile ${index + 1} executable must be a non-empty string.`);
    }
    const description = record.description;
    if (description !== undefined && typeof description !== 'string') {
      throw invalidConfiguration(`profile ${index + 1} description must be a string.`);
    }
    const env = parseEnvironment(record.env, index);
    if (record.provider === 'opencode' && Object.keys(env).some((name) => (
      ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'XDG_DATA_HOME'].includes(name.toUpperCase())
    ))) {
      // History, usage, models and watchers currently share the server's OpenCode DB.
      throw invalidConfiguration(`profile ${index + 1} OpenCode env cannot override HOME, USERPROFILE, HOMEDRIVE, HOMEPATH or XDG_DATA_HOME; profiles must share the server's history storage.`);
    }

    return {
      id,
      name,
      provider: record.provider,
      ...(description?.trim() ? { description: description.trim() } : {}),
      isDefault: false,
      ...(typeof executable === 'string' ? { executable: executable.trim() } : {}),
      env,
    };
  });
};

const toSummary = (profile: ProviderRuntimeProfile): ProviderRuntimeProfileSummary => ({
  id: profile.id,
  name: profile.name,
  provider: profile.provider,
  ...(profile.description ? { description: profile.description } : {}),
  isDefault: profile.isDefault,
});

/**
 * Parses operator-owned runtime profiles and resolves safe/public and private
 * views for the providers module's routes, runtimes, and transcript indexers.
 */
export function createProviderRuntimeProfilesService(
  dependencyOverrides: Partial<RuntimeProfilesServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  const listConfiguredProfiles = (): ProviderRuntimeProfile[] => (
    parseProfiles(dependencies.readConfiguration())
  );

  const resolve = (
    provider: LLMProvider,
    profileId: string | null | undefined,
  ): ProviderRuntimeProfile => {
    if (!profileId || profileId === 'default') {
      return defaultProfile(provider);
    }
    const profile = listConfiguredProfiles().find(
      (candidate) => candidate.provider === provider && candidate.id === profileId,
    );
    if (!profile) {
      throw new AppError(`Runtime profile "${profileId}" is not configured for ${provider}.`, {
        code: 'RUNTIME_PROFILE_NOT_FOUND',
        statusCode: 400,
      });
    }
    return profile;
  };

  return {
    list(): ProviderRuntimeProfileSummary[] {
      return PROVIDERS.flatMap((provider) => [
        toSummary(defaultProfile(provider)),
        ...listConfiguredProfiles()
          .filter((profile) => profile.provider === provider)
          .map(toSummary),
      ]);
    },

    resolve,

    /** Used by the Claude synchronizer and session watcher to share transcript roots. */
    listClaudeHomes(): Array<{ claudeHome: string; profileId: string | null }> {
      const profiles = [
        defaultProfile('claude'),
        ...listConfiguredProfiles().filter((profile) => profile.provider === 'claude'),
      ];
      const seen = new Set<string>();
      return profiles.flatMap((profile) => {
        const homeOverride = process.platform === 'win32' ? profile.env.USERPROFILE : profile.env.HOME;
        const claudeHome = path.resolve(
          (profile.env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR)
            || path.join(homeOverride || os.homedir(), '.claude'),
        );
        if (seen.has(claudeHome)) {
          return [];
        }
        seen.add(claudeHome);
        return [{ claudeHome, profileId: profile.isDefault ? null : profile.id }];
      });
    },

    /** Used by the Codex synchronizer and session watcher to share transcript roots. */
    listCodexHomes(): Array<{ codexHome: string; profileId: string | null }> {
      const profiles = [
        defaultProfile('codex'),
        ...listConfiguredProfiles().filter((profile) => profile.provider === 'codex'),
      ];
      const seen = new Set<string>();
      return profiles.flatMap((profile) => {
        const homeOverride = process.platform === 'win32' ? profile.env.USERPROFILE : profile.env.HOME;
        const codexHome = path.resolve(
          (profile.env.CODEX_HOME ?? process.env.CODEX_HOME)
            || path.join(homeOverride || os.homedir(), '.codex'),
        );
        if (seen.has(codexHome)) {
          return [];
        }
        seen.add(codexHome);
        return [{ codexHome, profileId: profile.isDefault ? null : profile.id }];
      });
    },

    validateSelection(provider: LLMProvider, profileId: string | null | undefined): string | null {
      const profile = resolve(provider, profileId);
      return profile.isDefault ? null : profile.id;
    },
  };
}

/** Used by server startup to validate configuration and by providers for runtime settings and transcript roots. */
export const providerRuntimeProfilesService = createProviderRuntimeProfilesService();
