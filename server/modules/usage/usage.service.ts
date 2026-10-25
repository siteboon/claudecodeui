import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Daily token usage from the CLIs' local session logs (read-only, no network, no credentials).
 * Claude: assistant rows carrying `message.usage`, repeated while streaming and again when a
 * session is resumed, so rows are de-duplicated by message id + request id.
 * Codex: `event_msg` / `token_count` rows with a cumulative `total_token_usage`; usage is the
 * increase between consecutive rows.
 */
export type TokenBucket = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  /** All four parts, the same convention ccusage uses. */
  total: number;
};

export type DayUsage = {
  date: string;
  claude: TokenBucket;
  codex: TokenBucket;
  total: TokenBucket;
};

export type UsageReport = {
  days: DayUsage[];
  totals: { claude: TokenBucket; codex: TokenBucket; total: TokenBucket };
  filesScanned: number;
  generatedAt: string;
};

type Agent = 'claude' | 'codex';

type ClaudeEntry = { key: string; ts: number; input: number; output: number; cacheRead: number; cacheCreation: number };
type CodexDelta = { ts: number; input: number; output: number; cacheRead: number };
type FileEntries = { claude: ClaudeEntry[]; codex: CodexDelta[] };

export function emptyBucket(): TokenBucket {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
}

function addTo(bucket: TokenBucket, part: Partial<Omit<TokenBucket, 'total'>>): void {
  bucket.input += part.input ?? 0;
  bucket.output += part.output ?? 0;
  bucket.cacheRead += part.cacheRead ?? 0;
  bucket.cacheCreation += part.cacheCreation ?? 0;
  bucket.total = bucket.input + bucket.output + bucket.cacheRead + bucket.cacheCreation;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Local calendar date (the heatmap is a daily view in the user's own time zone). */
export function localDateKey(ts: number): string {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Tolerant parser: unknown fields and malformed lines (a log being written) are ignored. */
export function parseLogFile(content: string): FileEntries {
  const claude: ClaudeEntry[] = [];
  const codex: CodexDelta[] = [];
  let previousCodexTotal: { input: number; output: number; cached: number } | null = null;

  for (const line of content.split('\n')) {
    if (!line.includes('usage') && !line.includes('token_count')) continue;
    let row: Record<string, any>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) continue;

    const usage = row.type === 'assistant' ? row.message?.usage : null;
    if (usage && typeof usage === 'object') {
      const entry: ClaudeEntry = {
        key: `${row.message?.id ?? row.uuid ?? ''}:${row.requestId ?? ''}`,
        ts,
        input: num(usage.input_tokens),
        output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheCreation: num(usage.cache_creation_input_tokens),
      };
      if (entry.input + entry.output + entry.cacheRead + entry.cacheCreation > 0) claude.push(entry);
      continue;
    }

    if (row.type === 'event_msg' && row.payload?.type === 'token_count') {
      const total = row.payload.info?.total_token_usage;
      if (!total || typeof total !== 'object') continue;
      const current = {
        input: num(total.input_tokens),
        output: num(total.output_tokens),
        cached: num(total.cached_input_tokens),
      };
      // A decrease means the counter restarted; treat the new value as the baseline.
      const base = previousCodexTotal && current.input >= previousCodexTotal.input && current.output >= previousCodexTotal.output
        ? previousCodexTotal
        : { input: 0, output: 0, cached: 0 };
      const dInput = current.input - base.input;
      const dCached = Math.min(Math.max(0, current.cached - base.cached), dInput);
      const dOutput = current.output - base.output;
      previousCodexTotal = current;
      if (dInput + dOutput > 0) {
        // Codex counts cached tokens inside input_tokens; report them separately like Claude.
        codex.push({ ts, input: dInput - dCached, output: dOutput, cacheRead: dCached });
      }
    }
  }
  return { claude, codex };
}

async function listJsonl(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.jsonl')) found.push(full);
    }
  };
  await walk(root);
  return found;
}

/** Aggregates parsed files into per-day buckets (pure; exported for tests). */
export function aggregate(files: FileEntries[]): Omit<UsageReport, 'generatedAt' | 'filesScanned'> {
  // De-duplicate Claude rows across files: keep the row with the most output (the final stream state).
  const claudeByKey = new Map<string, ClaudeEntry>();
  const claudeNoKey: ClaudeEntry[] = [];
  for (const file of files) {
    for (const entry of file.claude) {
      if (entry.key === ':') {
        claudeNoKey.push(entry);
        continue;
      }
      const existing = claudeByKey.get(entry.key);
      if (!existing || entry.output >= existing.output) claudeByKey.set(entry.key, entry);
    }
  }

  const days = new Map<string, DayUsage>();
  const day = (ts: number): DayUsage => {
    const key = localDateKey(ts);
    let value = days.get(key);
    if (!value) {
      value = { date: key, claude: emptyBucket(), codex: emptyBucket(), total: emptyBucket() };
      days.set(key, value);
    }
    return value;
  };
  const totals = { claude: emptyBucket(), codex: emptyBucket(), total: emptyBucket() };
  const record = (agent: Agent, ts: number, part: Partial<Omit<TokenBucket, 'total'>>) => {
    const target = day(ts);
    addTo(target[agent], part);
    addTo(target.total, part);
    addTo(totals[agent], part);
    addTo(totals.total, part);
  };

  for (const entry of [...claudeByKey.values(), ...claudeNoKey]) record('claude', entry.ts, entry);
  for (const file of files) for (const delta of file.codex) record('codex', delta.ts, delta);

  return { days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), totals };
}

const fileCache = new Map<string, { mtimeMs: number; size: number; entries: FileEntries }>();

export function usageRoots(): { claude: string; codex: string } {
  return {
    claude: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects'),
    codex: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'),
  };
}

export async function buildUsageReport(): Promise<UsageReport> {
  const roots = usageRoots();
  const paths = [...(await listJsonl(roots.claude)), ...(await listJsonl(roots.codex))];
  const parsed: FileEntries[] = [];
  const seen = new Set<string>();

  for (const file of paths) {
    seen.add(file);
    let info;
    try {
      info = await stat(file);
    } catch {
      continue;
    }
    const cached = fileCache.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      parsed.push(cached.entries);
      continue;
    }
    try {
      const entries = parseLogFile(await readFile(file, 'utf8'));
      fileCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, entries });
      parsed.push(entries);
    } catch {
      // Unreadable or vanished mid-scan: skip.
    }
  }
  for (const key of fileCache.keys()) if (!seen.has(key)) fileCache.delete(key);

  return { ...aggregate(parsed), filesScanned: paths.length, generatedAt: new Date().toISOString() };
}

export function resetUsageCacheForTests(): void {
  fileCache.clear();
}
