import type { ChildProcess } from 'node:child_process';

import spawn from 'cross-spawn';

import type {
  ProviderQuotaBucket,
  ProviderQuotaData,
  ProviderQuotaGroup,
} from '@/shared/types.js';
import {
  createProviderQuotaCache,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

type CodexQuotaDependencies = {
  startAppServer: () => ChildProcess;
  now: () => number;
};

type CodexRateLimitWindow = {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
};

type CodexRateLimitSnapshot = {
  limitId?: unknown;
  limitName?: unknown;
  planType?: unknown;
  primary?: unknown;
  secondary?: unknown;
};

const CACHE_TTL_MS = 120_000;
const APP_SERVER_TIMEOUT_MS = 10_000;
const quotaCache = createProviderQuotaCache<ProviderQuotaData>(CACHE_TTL_MS);

const defaultDependencies: CodexQuotaDependencies = {
  startAppServer: () => spawn('codex', ['app-server', '--stdio'], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  }),
  now: () => Date.now(),
};

function readFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readRateLimitWindow(value: unknown): CodexRateLimitWindow | null {
  const record = readObjectRecord(value);
  return record ? record as CodexRateLimitWindow : null;
}

function resolveWindow(durationMinutes: number | null, fallback: '5h' | 'weekly'): string {
  if (durationMinutes === 300) return '5h';
  if (durationMinutes === 10_080) return 'weekly';
  return durationMinutes && durationMinutes > 0 ? `${durationMinutes}m` : fallback;
}

function createQuotaBucket(
  limitId: string,
  position: 'primary' | 'secondary',
  value: unknown,
): ProviderQuotaBucket | null {
  const windowData = readRateLimitWindow(value);
  const usedPercent = readFiniteNumber(windowData?.usedPercent);
  if (!windowData || usedPercent === null) {
    return null;
  }

  const durationMinutes = readFiniteNumber(windowData.windowDurationMins);
  const window = resolveWindow(durationMinutes, position === 'primary' ? '5h' : 'weekly');
  const remainingFraction = Math.max(0, Math.min(1, (100 - usedPercent) / 100));
  const resetsAtSeconds = readFiniteNumber(windowData.resetsAt);
  const resetTime = resetsAtSeconds !== null && resetsAtSeconds > 0
    ? new Date(resetsAtSeconds * 1000).toISOString()
    : undefined;

  return {
    id: `${limitId}-${position}-${window}`,
    name: window === '5h'
      ? 'Five Hour Limit Remaining'
      : window === 'weekly'
        ? 'Weekly Limit Remaining'
        : `${durationMinutes ?? 'Unknown'} Minute Limit Remaining`,
    description: `${Math.max(0, Math.min(100, usedPercent))}% used`,
    window,
    remainingFraction,
    resetTime,
  };
}

function normalizeSnapshot(
  value: unknown,
  fallbackLimitId: string,
): ProviderQuotaGroup | null {
  const snapshot = readObjectRecord(value) as CodexRateLimitSnapshot | null;
  if (!snapshot) {
    return null;
  }

  const limitId = readOptionalString(snapshot.limitId) ?? fallbackLimitId;
  const buckets = [
    createQuotaBucket(limitId, 'primary', snapshot.primary),
    createQuotaBucket(limitId, 'secondary', snapshot.secondary),
  ].filter((bucket): bucket is ProviderQuotaBucket => bucket !== null);

  if (buckets.length === 0) {
    return null;
  }

  const limitName = readOptionalString(snapshot.limitName);
  const planType = readOptionalString(snapshot.planType);
  return {
    name: limitName ?? (limitId === 'codex' ? 'Codex' : limitId),
    description: planType ? `Codex ${planType} plan` : undefined,
    buckets,
  };
}

function normalizeQuotaResponse(value: unknown, nowTimestamp: number): ProviderQuotaData | null {
  const response = readObjectRecord(value);
  if (!response) {
    return null;
  }

  const snapshotsById = readObjectRecord(response.rateLimitsByLimitId);
  const groups = snapshotsById && Object.keys(snapshotsById).length > 0
    ? Object.entries(snapshotsById)
      .map(([limitId, snapshot]) => normalizeSnapshot(snapshot, limitId))
      .filter((group): group is ProviderQuotaGroup => group !== null)
    : [normalizeSnapshot(response.rateLimits, 'codex')]
      .filter((group): group is ProviderQuotaGroup => group !== null);

  return groups.length > 0
    ? { groups, updatedAt: new Date(nowTimestamp).toISOString() }
    : null;
}

function readCodexRateLimits(
  startAppServer: CodexQuotaDependencies['startAppServer'],
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = startAppServer();
    const { stdin, stdout } = child;
    if (!stdin || !stdout) {
      child.kill();
      reject(new Error('Codex app-server did not expose its protocol streams'));
      return;
    }

    let stdoutBuffer = '';
    let settled = false;
    let forceKillTimeout: NodeJS.Timeout | null = null;

    const hasChildExited = () => (
      (child.exitCode !== null && child.exitCode !== undefined)
      || (child.signalCode !== null && child.signalCode !== undefined)
    );

    const stopChild = () => {
      if (hasChildExited()) return;
      child.kill();
      forceKillTimeout = setTimeout(() => {
        if (!hasChildExited()) {
          child.kill('SIGKILL');
        }
      }, 1_000);
      forceKillTimeout.unref();
    };

    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopChild();
      if (error) reject(error);
      else resolve(result);
    };

    const timeout = setTimeout(() => {
      finish(new Error('Timed out while reading Codex account rate limits'));
    }, APP_SERVER_TIMEOUT_MS);

    const writeMessage = (message: Record<string, unknown>) => {
      stdin.write(`${JSON.stringify(message)}\n`);
    };

    child.once('error', (error) => finish(error));
    stdin.once('error', (error) => finish(error));
    child.stderr?.resume();
    child.once('exit', (code) => {
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      if (!settled) {
        finish(new Error(`Codex app-server exited before returning rate limits (${code ?? 'unknown'})`));
      }
    });

    stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf('\n');

      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf('\n');
        if (!line || settled) continue;

        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (message.id === 'cloudcli-quota-initialize') {
          const protocolError = readObjectRecord(message.error);
          if (protocolError) {
            finish(new Error(readOptionalString(protocolError.message) ?? 'Codex initialization failed'));
            continue;
          }

          writeMessage({ method: 'initialized' });
          writeMessage({
            id: 'cloudcli-quota-read',
            method: 'account/rateLimits/read',
            params: null,
          });
          continue;
        }

        if (message.id === 'cloudcli-quota-read') {
          const protocolError = readObjectRecord(message.error);
          if (protocolError) {
            finish(new Error(readOptionalString(protocolError.message) ?? 'Codex rate-limit read failed'));
          } else {
            finish(undefined, message.result);
          }
        }
      }
    });

    writeMessage({
      id: 'cloudcli-quota-initialize',
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'cloudcli',
          title: 'CloudCLI',
          version: '1.0.0',
        },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

/**
 * Reads the current Codex account rate limits through the supported app-server
 * protocol and maps its rolling windows into the provider-neutral quota model.
 * Consumer: CodexProviderAuth.getQuota().
 */
export async function fetchCodexQuota(
  options: { forceRefresh?: boolean } = {},
  dependencyOverrides: Partial<CodexQuotaDependencies> = {},
): Promise<ProviderQuotaData | null> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  return quotaCache.get(
    options,
    async () => normalizeQuotaResponse(
      await readCodexRateLimits(dependencies.startAppServer),
      dependencies.now(),
    ),
    dependencies.now,
  );
}

/** Resets the Codex quota cache for provider module tests. */
export function resetCodexQuotaCache(): void {
  quotaCache.reset();
}
