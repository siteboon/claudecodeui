import crossSpawn from 'cross-spawn';

import { resolveAgyBinary } from '@/modules/providers/list/antigravity/antigravity-runtime.provider.js';
import { listTranscriptFiles, readTranscript } from '@/modules/providers/list/antigravity/antigravity-store.js';

/**
 * Usage data for the Antigravity provider, in the two halves the usage panel
 * shows.
 *
 * `plan` comes from `agy -p "/usage"`, which answers with the same groups and
 * buckets its own TUI draws (weekly and five-hour windows per model group).
 * `local` is aggregated from the usage lines the runtime writes into each
 * transcript, because agy keeps no queryable per-turn record of its own.
 */

const PLAN_TIMEOUT_MS = 60_000;
const DAILY_WINDOW_DAYS = 30;

/** One limit window as agy reports it: how much is left and when it resets. */
type AntigravityPlanBucket = {
  id: string;
  name: string;
  window: string;
  remainingFraction: number;
  resetTime: string | null;
  description: string | null;
};

/** One group of models that shares a set of limit windows. */
type AntigravityPlanGroup = {
  name: string;
  description: string | null;
  buckets: AntigravityPlanBucket[];
};

type AntigravityPlanUsage = {
  groups: AntigravityPlanGroup[];
  error: string | null;
};

type AntigravityUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  turns: number;
};

type AntigravityUsageSlice = {
  label: string;
  totalTokens: number;
  turns: number;
};

type AntigravityLocalUsage = {
  totals: AntigravityUsageTotals;
  daily: Array<{ date: string; totalTokens: number }>;
  byModel: AntigravityUsageSlice[];
  byProject: AntigravityUsageSlice[];
  sessions: number;
};

const emptyTotals = (): AntigravityUsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  turns: 0,
});

const readNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Reads the plan limits agy reports for the signed-in account.
 *
 * The command runs in print mode with the slash command agy expands itself;
 * `--output-format json` wraps the answer in `{ command: { data: … } }`. Errors
 * are returned as data — the panel shows them inline rather than failing the
 * request, because a logged-out CLI is an expected state.
 */
export function readAntigravityPlanUsage(): Promise<AntigravityPlanUsage> {
  return new Promise((resolve) => {
    let settled = false;
    let child: ReturnType<typeof crossSpawn> | undefined;
    let stdout = '';
    let stderr = '';

    const finish = (result: AntigravityPlanUsage) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child?.kill();
      finish({ groups: [], error: 'agy /usage timed out' });
    }, PLAN_TIMEOUT_MS);

    try {
      child = crossSpawn(
        resolveAgyBinary(),
        ['-p', '/usage', '--output-format', 'json', '--print-timeout', '45s', '--dangerously-skip-permissions'],
        { windowsHide: true },
      );
    } catch (error) {
      clearTimeout(timer);
      settled = true;
      resolve({ groups: [], error: (error as Error).message });
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 512_000) {
        stdout = stdout.slice(-256_000);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error: Error) => finish({ groups: [], error: error.message }));
    child.on('close', () => {
      // agy prints progress lines before the JSON document; the payload is the
      // last line that parses as an object with a `command` field.
      const lines = stdout.split(/\r?\n/).filter((line) => line.trim().startsWith('{'));
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const parsed = JSON.parse(lines[index]) as { command?: { data?: { groups?: unknown } } };
          const groups = parsed.command?.data?.groups;
          if (Array.isArray(groups)) {
            finish({ groups: groups.map(normalizePlanGroup).filter(isPlanGroup), error: null });
            return;
          }
        } catch {
          // Keep scanning backwards.
        }
      }
      finish({
        groups: [],
        error: (stderr || stdout).trim().slice(-400) || 'agy /usage returned no quota data',
      });
    });
  });
}

const normalizePlanGroup = (raw: unknown): AntigravityPlanGroup | null => {
  const group = raw as Record<string, unknown> | null;
  if (!group || typeof group.name !== 'string') {
    return null;
  }
  const buckets = Array.isArray(group.buckets) ? group.buckets : [];
  return {
    name: group.name,
    description: typeof group.description === 'string' ? group.description : null,
    buckets: buckets.map(normalizePlanBucket).filter(isPlanBucket),
  };
};

const normalizePlanBucket = (raw: unknown): AntigravityPlanBucket | null => {
  const bucket = raw as Record<string, unknown> | null;
  if (!bucket || typeof bucket.id !== 'string') {
    return null;
  }
  return {
    id: bucket.id,
    name: typeof bucket.name === 'string' ? bucket.name : bucket.id,
    window: typeof bucket.window === 'string' ? bucket.window : '',
    remainingFraction: Math.min(1, Math.max(0, readNumber(bucket.remaining_fraction))),
    resetTime: typeof bucket.reset_time === 'string' ? bucket.reset_time : null,
    description: typeof bucket.description === 'string' ? bucket.description : null,
  };
};

const isPlanGroup = (value: AntigravityPlanGroup | null): value is AntigravityPlanGroup => value !== null;
const isPlanBucket = (value: AntigravityPlanBucket | null): value is AntigravityPlanBucket => value !== null;

/**
 * Aggregates the usage lines every transcript carries.
 *
 * Daily buckets cover the last {@link DAILY_WINDOW_DAYS} days and are keyed by
 * the transcript's own timestamps, so they reflect turns taken in CloudCLI
 * rather than agy's quota accounting.
 */
export async function readAntigravityLocalUsage(): Promise<AntigravityLocalUsage> {
  const files = await listTranscriptFiles();
  const totals = emptyTotals();
  const daily = new Map<string, number>();
  const byModel = new Map<string, AntigravityUsageSlice>();
  const byProject = new Map<string, AntigravityUsageSlice>();
  const windowStart = Date.now() - DAILY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let sessions = 0;

  for (const file of files) {
    const { meta, usage } = await readTranscript(file.sessionId);
    if (usage.length === 0) {
      continue;
    }
    sessions += 1;
    const projectLabel = meta?.projectPath || 'unknown';
    for (const record of usage) {
      const totalTokens = record.usage.totalTokens
        || record.usage.inputTokens + record.usage.outputTokens;
      totals.inputTokens += record.usage.inputTokens;
      totals.outputTokens += record.usage.outputTokens;
      totals.thinkingTokens += record.usage.thinkingTokens;
      totals.cacheReadTokens += record.usage.cacheReadTokens;
      totals.totalTokens += totalTokens;
      totals.turns += 1;

      const stamp = Date.parse(record.timestamp);
      if (Number.isFinite(stamp) && stamp >= windowStart) {
        const day = new Date(stamp).toISOString().slice(0, 10);
        daily.set(day, (daily.get(day) ?? 0) + totalTokens);
      }

      const modelKey = record.model || 'default';
      const modelEntry = byModel.get(modelKey) ?? { label: modelKey, totalTokens: 0, turns: 0 };
      modelEntry.totalTokens += totalTokens;
      modelEntry.turns += 1;
      byModel.set(modelKey, modelEntry);

      const projectEntry = byProject.get(projectLabel) ?? { label: projectLabel, totalTokens: 0, turns: 0 };
      projectEntry.totalTokens += totalTokens;
      projectEntry.turns += 1;
      byProject.set(projectLabel, projectEntry);
    }
  }

  const byTokens = (a: AntigravityUsageSlice, b: AntigravityUsageSlice) => b.totalTokens - a.totalTokens;
  return {
    totals,
    daily: [...daily.entries()]
      .map(([date, totalTokens]) => ({ date, totalTokens }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byModel: [...byModel.values()].sort(byTokens).slice(0, 8),
    byProject: [...byProject.values()].sort(byTokens).slice(0, 8),
    sessions,
  };
}

/** Everything the usage panel renders, in one call. */
export async function readAntigravityUsage(): Promise<{ plan: AntigravityPlanUsage; local: AntigravityLocalUsage }> {
  const [plan, local] = await Promise.all([readAntigravityPlanUsage(), readAntigravityLocalUsage()]);
  return { plan, local };
}
