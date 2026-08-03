import { readFileSync } from 'node:fs';

import { AppError } from '@/shared/utils.js';

/**
 * Current Pi session schema version. Sessions with a different (or missing)
 * version are treated as unsupported.
 */
const CURRENT_SESSION_VERSION = 3;

/** Header line of a Pi session JSONL file. */
export interface PiSessionHeader {
  type: 'session';
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

/** Common shape shared by every session entry (message, model_change, ...). */
export interface PiSessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

/** Token usage as reported by Pi (subset of the fields we depend on). */
export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  [key: string]: unknown;
}

/** Normalized message on the active branch. */
export interface PiSessionMessage {
  entryId: string;
  role: string;
  message: Record<string, unknown>;
}

/** Immutable snapshot produced by a single parse of a session file. */
export interface PiSessionSnapshot {
  readonly header: PiSessionHeader;
  readonly entries: ReadonlyArray<PiSessionEntry>;
  readonly messages: ReadonlyArray<PiSessionMessage>;
  readonly currentModel: { provider: string; modelId: string } | null;
  readonly lastUsage: PiUsage | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses a Pi session JSONL file into an immutable snapshot.
 *
 * Parsing rules:
 * - The first line is the header; an unsupported/missing version throws
 *   `PI_SESSION_VERSION_UNSUPPORTED`.
 * - A trailing partial line (no terminating newline and invalid JSON) is
 *   ignored.
 * - Any other invalid line throws `PI_SESSION_CORRUPT` with a 1-indexed line
 *   number.
 * - The active branch is reconstructed by walking parentId links from the
 *   most-recently appended leaf back to the root, detecting cycles, duplicate
 *   ids, and missing parents.
 */
export const PiSessionStore = {
  load(filePath: string): PiSessionSnapshot {
    const raw = readFileSync(filePath, 'utf8');
    const endsWithNewline = raw.endsWith('\n');
    const lines = raw.split('\n');

    // split on '\n' leaves a trailing empty string when the file ends with a
    // newline; drop it so it is not mistaken for a data line.
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (lines.length === 0) {
      throw new AppError('Pi session 文件为空', { code: 'PI_SESSION_CORRUPT' });
    }

    const header = parseHeader(lines[0]);

    const entries: PiSessionEntry[] = [];
    for (let i = 1; i < lines.length; i++) {
      const isLastLine = i === lines.length - 1;
      const lineNumber = i + 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch {
        // A trailing half-written line (no terminating newline) is ignored.
        if (isLastLine && !endsWithNewline) {
          continue;
        }
        throw new AppError(`Pi session 文件损坏（行号 ${lineNumber}）`, {
          code: 'PI_SESSION_CORRUPT',
          details: { line: lineNumber },
        });
      }
      if (!isValidEntry(parsed)) {
        if (isLastLine && !endsWithNewline) {
          continue;
        }
        throw new AppError(`Pi session 文件损坏（行号 ${lineNumber}）`, {
          code: 'PI_SESSION_CORRUPT',
          details: { line: lineNumber },
        });
      }
      entries.push(parsed);
    }

    const branch = resolveActiveBranch(entries);
    const messages = normalizeMessages(branch);
    const currentModel = findLastModelChange(branch);
    const lastUsage = findLastValidUsage(branch);

    return Object.freeze({
      header: Object.freeze(header),
      entries: Object.freeze(branch),
      messages: Object.freeze(messages),
      currentModel: currentModel ? Object.freeze(currentModel) : null,
      lastUsage: lastUsage ? Object.freeze(lastUsage) : null,
    }) as PiSessionSnapshot;
  },
};

function parseHeader(line: string): PiSessionHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new AppError('Pi session 文件损坏（行号 1）', {
      code: 'PI_SESSION_CORRUPT',
      details: { line: 1 },
    });
  }
  if (!isRecord(parsed) || parsed.type !== 'session') {
    throw new AppError('Pi session 文件损坏（行号 1）', {
      code: 'PI_SESSION_CORRUPT',
      details: { line: 1 },
    });
  }
  if (parsed.version !== CURRENT_SESSION_VERSION) {
    throw new AppError('不支持的 Pi session 版本', {
      code: 'PI_SESSION_VERSION_UNSUPPORTED',
      details: { version: parsed.version ?? null },
    });
  }
  return parsed as unknown as PiSessionHeader;
}

function isValidEntry(value: unknown): value is PiSessionEntry {
  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string') return false;
  if (typeof value.id !== 'string') return false;
  if (!('parentId' in value)) return false;
  const parentId = value.parentId;
  return parentId === null || typeof parentId === 'string';
}

/**
 * Reconstructs the active branch as an ordered root->leaf list.
 *
 * The active leaf is the last appended entry. Walking parentId links back to
 * the root detects cycles, duplicate ids, and missing parents (any of which
 * corrupts the branch).
 */
function resolveActiveBranch(entries: PiSessionEntry[]): PiSessionEntry[] {
  if (entries.length === 0) return [];

  const byId = new Map<string, PiSessionEntry>();
  for (const entry of entries) {
    if (byId.has(entry.id)) {
      throw new AppError('Pi session 文件损坏（重复 entry id）', {
        code: 'PI_SESSION_CORRUPT',
        details: { duplicateId: entry.id },
      });
    }
    byId.set(entry.id, entry);
  }

  const leaf = entries[entries.length - 1];
  const chain: PiSessionEntry[] = [];
  const seen = new Set<string>();
  let current: PiSessionEntry | undefined = leaf;

  while (current) {
    if (seen.has(current.id)) {
      throw new AppError('Pi session 文件损坏（active branch 存在环）', {
        code: 'PI_SESSION_CORRUPT',
        details: { cycleAt: current.id },
      });
    }
    seen.add(current.id);
    chain.push(current);

    if (current.parentId === null) break;

    const parent = byId.get(current.parentId);
    if (!parent) {
      throw new AppError('Pi session 文件损坏（丢失 parent entry）', {
        code: 'PI_SESSION_CORRUPT',
        details: { missingParent: current.parentId },
      });
    }
    current = parent;
  }

  return chain.reverse();
}

function normalizeMessages(branch: PiSessionEntry[]): PiSessionMessage[] {
  const messages: PiSessionMessage[] = [];
  for (const entry of branch) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (!isRecord(message)) continue;
    messages.push({
      entryId: entry.id,
      role: typeof message.role === 'string' ? message.role : 'unknown',
      message,
    });
  }
  return messages;
}

function findLastModelChange(
  branch: PiSessionEntry[],
): { provider: string; modelId: string } | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== 'model_change') continue;
    if (typeof entry.provider === 'string' && typeof entry.modelId === 'string') {
      return { provider: entry.provider, modelId: entry.modelId };
    }
  }
  return null;
}

/**
 * Returns the usage of the last assistant message on the active branch that
 * did not error, was not aborted, and carries a complete usage payload. When
 * no entry qualifies, returns null (Pi does not fall back to another
 * provider's default usage).
 */
function findLastValidUsage(branch: PiSessionEntry[]): PiUsage | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (!isRecord(message) || message.role !== 'assistant') continue;
    if (message.stopReason === 'error' || message.stopReason === 'aborted') continue;
    if (isCompleteUsage(message.usage)) {
      return message.usage;
    }
  }
  return null;
}

function isCompleteUsage(value: unknown): value is PiUsage {
  if (!isRecord(value)) return false;
  const numericFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'];
  for (const field of numericFields) {
    if (typeof value[field] !== 'number') return false;
  }
  return isRecord(value.cost) && typeof value.cost.total === 'number';
}
