import os from 'node:os';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Query } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCodeExecutablePath } from '@/shared/index.js';
import type { ProviderPlanUsage, ProviderPlanUsageWindow } from '@/shared/index.js';

type RawWindow = { utilization?: number | null; resets_at?: string | null } | null | undefined;

// Refer to the SDK contract so a dependency without this API fails typecheck.
// Keep the runtime guard for incompatible installations of the experimental API.
type UsageQuery = AsyncIterable<unknown> & Partial<Pick<Query,
  'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
>>;

type ClaudePlanUsageServiceDependencies = {
  createQuery: (params: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => UsageQuery;
  now: () => number;
};

// The numbers come from claude.ai and move slowly; one read serves every tab
// for a minute, and each read costs a short-lived CLI process.
const CACHE_MS = 60_000;
const REFRESH_MIN_AGE_MS = 10_000;

const toWindow = (raw: RawWindow): ProviderPlanUsageWindow | null => (
  raw ? { utilization: raw.utilization ?? null, resetsAt: raw.resets_at ?? null } : null
);

/** Creates the Claude usage reader used by the Providers route and its tests. */
export function createClaudePlanUsageService(dependencies: ClaudePlanUsageServiceDependencies = {
  createQuery: (params) => query(params as never) as unknown as UsageQuery,
  now: () => Date.now(),
}) {
  let cached: { usage: ProviderPlanUsage; at: number } | null = null;
  let inFlight: Promise<ProviderPlanUsage> | null = null;

  // Starts the CLI with an input stream that sends nothing — no prompt, so no
  // model request — asks for the /usage data, then closes stdin so it exits.
  const read = async (): Promise<ProviderPlanUsage> => {
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
        throw new Error('The installed Claude SDK cannot read plan usage. Update CloudCLI dependencies and restart.');
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
    async getPlanUsage(options: { refresh?: boolean } = {}): Promise<ProviderPlanUsage> {
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

/** Used by the Providers route to fetch Claude plan windows. */
export const claudePlanUsageService = createClaudePlanUsageService();
