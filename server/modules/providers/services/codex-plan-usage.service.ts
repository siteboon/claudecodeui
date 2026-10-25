import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { CodexRateLimitSnapshot, CodexRateLimitWindow } from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { ProviderPlanUsage, ProviderPlanUsageWindow } from '@/shared/index.js';

type CodexPlanUsageDependencies = {
  readRateLimits: () => Promise<CodexRateLimitSnapshot>;
  now: () => number;
};

const CACHE_MS = 60_000;
const REFRESH_MIN_AGE_MS = 10_000;

const toWindow = (window: CodexRateLimitWindow | null): ProviderPlanUsageWindow | null => {
  if (!window) return null;
  return {
    utilization: Number.isFinite(window.usedPercent) ? window.usedPercent : null,
    resetsAt: window.resetsAt == null ? null : new Date(window.resetsAt * 1000).toISOString(),
  };
};

/** Creates the Codex plan usage reader used by the Providers route. */
export function createCodexPlanUsageService(dependencies: CodexPlanUsageDependencies = {
  readRateLimits: () => codexAppServer.readRateLimits(),
  now: () => Date.now(),
}) {
  let cached: { usage: ProviderPlanUsage; at: number } | null = null;
  let inFlight: Promise<ProviderPlanUsage> | null = null;

  return {
    async getPlanUsage(options: { refresh?: boolean } = {}): Promise<ProviderPlanUsage> {
      const maxAge = options.refresh ? REFRESH_MIN_AGE_MS : CACHE_MS;
      if (cached && dependencies.now() - cached.at < maxAge) return cached.usage;
      if (!inFlight) {
        inFlight = dependencies.readRateLimits()
          .then((raw) => {
            const windows = [raw.primary, raw.secondary];
            const fiveHour = windows.find((window) => window?.windowDurationMins === 300)
              ?? (raw.primary?.windowDurationMins == null ? raw.primary : null);
            const sevenDay = windows.find((window) => window?.windowDurationMins === 10_080)
              ?? (raw.secondary?.windowDurationMins == null ? raw.secondary : null);
            const usage: ProviderPlanUsage = {
              available: Boolean(fiveHour || sevenDay),
              subscriptionType: null,
              fiveHour: toWindow(fiveHour),
              sevenDay: toWindow(sevenDay),
              fetchedAt: new Date(dependencies.now()).toISOString(),
            };
            cached = { usage, at: dependencies.now() };
            return usage;
          })
          .finally(() => { inFlight = null; });
      }
      return inFlight;
    },
  };
}

/** Used by the Providers route to fetch Codex plan windows. */
export const codexPlanUsageService = createCodexPlanUsageService();
