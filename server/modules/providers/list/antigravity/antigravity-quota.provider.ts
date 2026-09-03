/**
 * Antigravity Quota Provider
 *
 * Interacts with the `agy` CLI to fetch account-level quota status, including
 * 5-hour rolling limit buckets and weekly limit buckets across model groups.
 *
 * @module antigravity-quota.provider
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  ProviderQuotaBucket,
  ProviderQuotaData,
  ProviderQuotaGroup,
} from '@/shared/types.js';

import { tryResolveEnginePath } from './antigravity-engine-path.js';

const execFileAsync = promisify(execFile);

export type AntigravityQuotaBucket = ProviderQuotaBucket;
export type AntigravityQuotaGroup = ProviderQuotaGroup;
export type AntigravityQuotaData = ProviderQuotaData;

type RawAgyBucket = {
  id?: string;
  name?: string;
  description?: string;
  window?: string;
  remaining_fraction?: number;
  reset_time?: string;
};

type RawAgyGroup = {
  name?: string;
  description?: string;
  buckets?: RawAgyBucket[];
};

type RawAgyUsageResponse = {
  command?: {
    name?: string;
    data?: {
      description?: string;
      groups?: RawAgyGroup[];
    };
  };
};

type AntigravityQuotaDependencies = {
  resolveEnginePath: () => string | null;
  runCommand: (executablePath: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  now: () => number;
};

const defaultDependencies: AntigravityQuotaDependencies = {
  resolveEnginePath: tryResolveEnginePath,
  runCommand: async (executablePath, args) => {
    return execFileAsync(executablePath, args, {
      timeout: 10_000,
      encoding: 'utf8',
      env: { ...process.env },
    });
  },
  now: () => Date.now(),
};

const CACHE_TTL_MS = 60_000; // 60 seconds

let cachedQuotaData: AntigravityQuotaData | null = null;
let cachedTimestamp = 0;
let inFlightPromise: Promise<AntigravityQuotaData | null> | null = null;

function normalizeQuotaPayload(raw: RawAgyUsageResponse, nowTimestamp: number): AntigravityQuotaData | null {
  const groupsRaw = raw.command?.data?.groups;
  if (!Array.isArray(groupsRaw) || groupsRaw.length === 0) {
    return null;
  }

  const groups: AntigravityQuotaGroup[] = groupsRaw
    .map((group) => {
      const name = typeof group.name === 'string' ? group.name.trim() : 'Unknown Group';
      const description = typeof group.description === 'string' ? group.description : undefined;
      const rawBuckets = Array.isArray(group.buckets) ? group.buckets : [];

      const buckets: AntigravityQuotaBucket[] = rawBuckets
        .map((bucket) => {
          const rawFraction = Number(bucket.remaining_fraction);
          const remainingFraction = Number.isFinite(rawFraction)
            ? Math.max(0, Math.min(1, rawFraction))
            : 0;

          return {
            id: typeof bucket.id === 'string' ? bucket.id : 'unknown',
            name: typeof bucket.name === 'string' ? bucket.name : 'Limit',
            description: typeof bucket.description === 'string' ? bucket.description : undefined,
            window: typeof bucket.window === 'string' ? bucket.window : 'unknown',
            remainingFraction,
            resetTime: typeof bucket.reset_time === 'string' ? bucket.reset_time : undefined,
          };
        })
        .filter((bucket) => Boolean(bucket.id));

      return {
        name,
        description,
        buckets,
      };
    })
    .filter((group) => group.buckets.length > 0);

  if (groups.length === 0) {
    return null;
  }

  return {
    groups,
    updatedAt: new Date(nowTimestamp).toISOString(),
  };
}

/**
 * Fetches the current Antigravity quota and limit status by invoking the CLI.
 * Consumed by provider-token-usage.service.ts and commands.routes.ts to enrich
 * Token Usage presentations with 5-hour and weekly quota meters.
 */
export async function fetchAntigravityQuota(
  options: { forceRefresh?: boolean } = {},
  dependencyOverrides: Partial<AntigravityQuotaDependencies> = {},
): Promise<AntigravityQuotaData | null> {
  const deps: AntigravityQuotaDependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
  };

  const currentTime = deps.now();

  // 1. Return valid in-memory cache if not forced
  if (
    !options.forceRefresh &&
    cachedTimestamp > 0 &&
    currentTime - cachedTimestamp < CACHE_TTL_MS
  ) {
    return cachedQuotaData;
  }

  // 2. Reuse in-flight request to avoid duplicate subprocess execution (unless forced)
  if (!options.forceRefresh && inFlightPromise) {
    return inFlightPromise;
  }

  const executeQuery = async (): Promise<AntigravityQuotaData | null> => {
    try {
      const enginePath = deps.resolveEnginePath();
      if (!enginePath) {
        cachedQuotaData = null;
        cachedTimestamp = deps.now();
        return null;
      }

      const { stdout } = await deps.runCommand(enginePath, [
        '--output-format',
        'json',
        '--print',
        '/usage',
      ]);

      if (!stdout || !stdout.trim()) {
        cachedQuotaData = null;
        cachedTimestamp = deps.now();
        return null;
      }

      const parsed = JSON.parse(stdout) as RawAgyUsageResponse;
      const normalized = normalizeQuotaPayload(parsed, deps.now());
      cachedQuotaData = normalized;
      cachedTimestamp = deps.now();
      return normalized;
    } catch {
      // Record timestamp to avoid stampeding subprocess spawns on consecutive errors
      cachedQuotaData = null;
      cachedTimestamp = deps.now();
      return null;
    } finally {
      inFlightPromise = null;
    }
  };

  const queryPromise = executeQuery();
  if (!options.forceRefresh) {
    inFlightPromise = queryPromise;
  }

  return queryPromise;
}

/**
 * Resets the in-memory quota cache.
 * Consumed primarily in unit test suites.
 */
export function resetAntigravityQuotaCache(): void {
  cachedQuotaData = null;
  cachedTimestamp = 0;
  inFlightPromise = null;
}
