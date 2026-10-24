import os from 'node:os';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';

/** One plan rate-limit window: percent used (0-100) and when it resets (ISO 8601). */
export type PlanUsageWindow = {
  utilization: number | null;
  resetsAt: string | null;
};

/** The claude.ai plan limits the CLI's /usage command shows. */
export type ClaudePlanUsage = {
  /** False for API key, Bedrock, Vertex and other logins without plan limits. */
  available: boolean;
  subscriptionType: string | null;
  fiveHour: PlanUsageWindow | null;
  sevenDay: PlanUsageWindow | null;
  fetchedAt: string;
};

type RawWindow = { utilization?: number | null; resets_at?: string | null } | null | undefined;

type RawUsage = {
  subscription_type?: string | null;
  rate_limits_available?: boolean;
  rate_limits?: { five_hour?: RawWindow; seven_day?: RawWindow } | null;
};

type UsageQuery = AsyncIterable<unknown> & {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (opts?: { skipBehaviors?: boolean }) => Promise<RawUsage>;
};

type ClaudePlanUsageServiceDependencies = {
  createQuery: (params: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => UsageQuery;
  now: () => number;
};

// The numbers come from claude.ai and move slowly; one read serves every tab
// for a minute, and each read costs a short-lived CLI process.
const CACHE_MS = 60_000;
const REFRESH_MIN_AGE_MS = 10_000;

const toWindow = (raw: RawWindow): PlanUsageWindow | null => (
  raw ? { utilization: raw.utilization ?? null, resetsAt: raw.resets_at ?? null } : null
);

export function createClaudePlanUsageService(dependencies: ClaudePlanUsageServiceDependencies = {
  createQuery: (params) => query(params as never) as unknown as UsageQuery,
  now: () => Date.now(),
}) {
  let cached: { usage: ClaudePlanUsage; at: number } | null = null;
  let inFlight: Promise<ClaudePlanUsage> | null = null;

  // Starts the CLI with an input stream that sends nothing — no prompt, so no
  // model request — asks for the /usage data, then closes stdin so it exits.
  const read = async (): Promise<ClaudePlanUsage> => {
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const prompt: AsyncIterable<never> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await held;
          return { done: true, value: undefined as never };
        },
      }),
    };

    const options: Record<string, unknown> = { cwd: os.homedir(), settingSources: [] };
    const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
    if (executable) {
      options.pathToClaudeCodeExecutable = executable;
    }

    const instance = dependencies.createQuery({ prompt, options });
    try {
      const readUsage = instance.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (typeof readUsage !== 'function') {
        // The SDK renamed or dropped the experimental call.
        return { available: false, subscriptionType: null, fiveHour: null, sevenDay: null, fetchedAt: new Date(dependencies.now()).toISOString() };
      }
      const raw = await readUsage.call(instance, { skipBehaviors: true });
      return {
        available: raw.rate_limits_available === true && Boolean(raw.rate_limits),
        subscriptionType: raw.subscription_type ?? null,
        fiveHour: toWindow(raw.rate_limits?.five_hour),
        sevenDay: toWindow(raw.rate_limits?.seven_day),
        fetchedAt: new Date(dependencies.now()).toISOString(),
      };
    } finally {
      release();
      // Drain so the process winds down instead of lingering.
      void (async () => {
        try {
          for await (const _message of instance) { /* discard */ }
        } catch {
          // A process that exits on closed stdin may end its stream with an error.
        }
      })();
    }
  };

  return {
    async getPlanUsage(options: { refresh?: boolean } = {}): Promise<ClaudePlanUsage> {
      // A refresh still reuses a read from the last few seconds, so repeated
      // clicks cannot start a process each.
      const maxAge = options.refresh ? REFRESH_MIN_AGE_MS : CACHE_MS;
      if (cached && dependencies.now() - cached.at < maxAge) {
        return cached.usage;
      }
      if (!inFlight) {
        inFlight = read()
          .then((usage) => {
            cached = { usage, at: dependencies.now() };
            return usage;
          })
          .finally(() => { inFlight = null; });
      }
      return inFlight;
    },
  };
}

export const claudePlanUsageService = createClaudePlanUsageService();
