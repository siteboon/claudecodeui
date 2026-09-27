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

    return {
      id,
      name,
      provider: record.provider,
      ...(description?.trim() ? { description: description.trim() } : {}),
      isDefault: false,
      ...(typeof executable === 'string' ? { executable: executable.trim() } : {}),
      env: parseEnvironment(record.env, index),
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
 * views from the same validated configuration.
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

    validateSelection(provider: LLMProvider, profileId: string | null | undefined): string | null {
      const profile = resolve(provider, profileId);
      return profile.isDefault ? null : profile.id;
    },
  };
}

export const providerRuntimeProfilesService = createProviderRuntimeProfilesService();
