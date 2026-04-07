import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

import spawn from 'cross-spawn';

import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { AppError } from '@/shared/utils/app-error.js';

type SearchResult = {
  sessionId: string;
  provider: string;
  filePath: string;
  lineNumber: number;
  lineText: string;
};

type SearchInput = {
  query: string;
  provider?: string;
  caseSensitive?: boolean;
  limit?: number;
  signal?: AbortSignal;
};

/**
 * Normalizes file paths so DB session paths match ripgrep paths across platforms.
 */
const normalizePathForLookup = (filePath: string): string =>
  process.platform === 'win32' ? path.normalize(filePath).toLowerCase() : path.normalize(filePath);

/**
 * Searches all indexed session transcript files for a text query.
 */
export const conversationSearchService = {
  /**
   * Uses ripgrep first for speed, then falls back to direct file scanning.
   */
  async search(input: SearchInput): Promise<SearchResult[]> {
    const query = input.query.trim();
    if (!query) {
      throw new AppError('query is required.', {
        code: 'SEARCH_QUERY_REQUIRED',
        statusCode: 400,
      });
    }
    if (input.signal?.aborted) {
      return [];
    }

    const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
    const allSessions = sessionsDb
      .getAllSessions()
      .filter((session) => Boolean(session.jsonl_path))
      .filter((session) => (input.provider ? session.provider === input.provider : true));

    if (allSessions.length === 0) {
      return [];
    }

    const sessionByFile = new Map(
      allSessions
        .filter((session): session is typeof session & { jsonl_path: string } => Boolean(session.jsonl_path))
        .map((session) => [normalizePathForLookup(session.jsonl_path), session]),
    );

    const uniqueDirectories = [...new Set(allSessions.map((session) => path.dirname(session.jsonl_path as string)))];
    const rgResults = await runRipgrepSearch(query, uniqueDirectories, {
      caseSensitive: input.caseSensitive ?? false,
      limit,
      signal: input.signal,
    });

    if (rgResults.length > 0) {
      const mappedResults: SearchResult[] = [];

      for (const match of rgResults) {
        const session = sessionByFile.get(normalizePathForLookup(match.filePath));
        if (!session) {
          continue;
        }

        mappedResults.push({
          sessionId: session.session_id,
          provider: session.provider,
          filePath: match.filePath,
          lineNumber: match.lineNumber,
          lineText: match.lineText,
        });

        if (mappedResults.length >= limit) {
          break;
        }
      }

      return mappedResults;
    }

    return fallbackFileSearch(query, sessionByFile, {
      caseSensitive: input.caseSensitive ?? false,
      limit,
      signal: input.signal,
    });
  },
};

/**
 * Runs ripgrep in JSON mode and maps each match to a minimal search shape.
 */
async function runRipgrepSearch(
  query: string,
  directories: string[],
  options: {
    caseSensitive: boolean;
    limit: number;
    signal?: AbortSignal;
  },
): Promise<Array<{ filePath: string; lineNumber: number; lineText: string }>> {
  if (options.signal?.aborted) {
    return [];
  }

  const args = ['--json', '--line-number', '--no-heading'];

  if (!options.caseSensitive) {
    args.push('-i');
  }

  args.push('--max-count', String(options.limit), '--', query, ...directories);

  const child = spawn('rg', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: process.env,
  });
  const abortListener = () => {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
    }
  };
  options.signal?.addEventListener('abort', abortListener, { once: true });

  let stdout = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  try {
    const closePromise = once(child, 'close');
    const errorPromise = once(child, 'error').then(([error]) => {
      throw error;
    });
    await Promise.race([closePromise, errorPromise]);
  } catch {
    options.signal?.removeEventListener('abort', abortListener);
    return [];
  }
  options.signal?.removeEventListener('abort', abortListener);

  if (child.exitCode !== 0 && child.exitCode !== 1) {
    return [];
  }
  if (options.signal?.aborted) {
    return [];
  }

  const matches: Array<{ filePath: string; lineNumber: number; lineText: string }> = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed?.type !== 'match') {
      continue;
    }

    const filePath = parsed?.data?.path?.text;
    const lineNumber = parsed?.data?.line_number;
    const lineText = parsed?.data?.lines?.text;

    if (
      typeof filePath !== 'string' ||
      typeof lineNumber !== 'number' ||
      typeof lineText !== 'string'
    ) {
      continue;
    }

    matches.push({
      filePath,
      lineNumber,
      lineText: lineText.trimEnd(),
    });

    if (matches.length >= options.limit) {
      break;
    }
  }

  return matches;
}

/**
 * Fallback search path when ripgrep is unavailable or returns no structured matches.
 */
async function fallbackFileSearch(
  query: string,
  sessionByFile: Map<string, { session_id: string; provider: string; jsonl_path: string | null }>,
  options: {
    caseSensitive: boolean;
    limit: number;
    signal?: AbortSignal;
  },
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryForMatch = options.caseSensitive ? query : query.toLowerCase();

  for (const [, session] of sessionByFile) {
    if (options.signal?.aborted) {
      return results;
    }

    if (!session.jsonl_path) {
      continue;
    }

    const content = await readFile(session.jsonl_path, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (options.signal?.aborted) {
        return results;
      }

      const line = lines[index];
      const source = options.caseSensitive ? line : line.toLowerCase();

      if (!source.includes(queryForMatch)) {
        continue;
      }

      results.push({
        sessionId: session.session_id,
        provider: session.provider,
        filePath: session.jsonl_path,
        lineNumber: index + 1,
        lineText: line,
      });

      if (results.length >= options.limit) {
        return results;
      }
    }
  }

  return results;
}
