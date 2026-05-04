import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { spawn } from 'cross-spawn';
import { rgPath } from '@vscode/ripgrep';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';

type AnyRecord = Record<string, any>;
type SearchableProvider = 'claude' | 'codex' | 'gemini';

type SearchSnippetHighlight = {
  start: number;
  end: number;
};

type SessionConversationMatch = {
  role: string;
  snippet: string;
  highlights: SearchSnippetHighlight[];
  timestamp: string | null;
  provider: SearchableProvider;
  messageUuid?: string | null;
};

type SessionConversationResult = {
  sessionId: string;
  provider: SearchableProvider;
  sessionSummary: string;
  matches: SessionConversationMatch[];
};

type ProjectConversationResult = {
  projectId: string | null;
  projectName: string;
  projectDisplayName: string;
  sessions: SessionConversationResult[];
};

export type SessionConversationSearchProgressUpdate = {
  projectResult: ProjectConversationResult | null;
  totalMatches: number;
  scannedProjects: number;
  totalProjects: number;
};

type SearchSessionConversationsInput = {
  query: string;
  limit: number;
  signal?: AbortSignal;
  onProgress?: (update: SessionConversationSearchProgressUpdate) => void;
};

type SessionRepositoryRow = ReturnType<typeof sessionsDb.getAllSessions>[number];
type SearchableSessionRow = SessionRepositoryRow & {
  provider: SearchableProvider;
  jsonl_path: string;
};

type SearchRuntime = {
  matchesQuery: (text: string) => boolean;
  buildSnippet: (text: string) => { snippet: string; highlights: SearchSnippetHighlight[] };
  limit: number;
  totalMatches: number;
  isAborted: () => boolean;
  matchedSessionKeys: Set<string>;
  claudeSessionsByFileKey: Map<string, SearchableSessionRow[]>;
  claudeFileResultsCache: Map<string, Map<string, SessionConversationResult>>;
};

type SearchablePathEntry = {
  normalizedPath: string;
  absolutePath: string;
};

type ProjectBucket = {
  key: string;
  projectId: string | null;
  projectName: string;
  projectDisplayName: string;
  sessions: SearchableSessionRow[];
};

const SUPPORTED_PROVIDERS = new Set<SearchableProvider>(['claude', 'codex', 'gemini']);
const MAX_MATCHES_PER_SESSION = 2;
const RIPGREP_FILE_CHUNK_SIZE = 40;
const RIPGREP_CHUNK_CONCURRENCY = 6;
const UNKNOWN_PROJECT_KEY = '__unknown_project__';

const INTERNAL_CONTENT_PREFIXES = [
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command-stdout>',
  '<system-reminder>',
  'Caveat:',
  'This session is being continued from a previous',
  'Invalid API key',
  '[Request interrupted',
] as const;

/**
 * Codex includes extra internal metadata tags that should not surface as
 * user-facing searchable conversation content.
 */
const CODEX_INTERNAL_CONTENT_PREFIXES = [
  '<environment_context>',
  '<cwd>',
] as const;

function normalizeComparablePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const withoutLongPathPrefix = inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
  const normalized = path.normalize(withoutLongPathPrefix.trim());
  if (!normalized) {
    return '';
  }

  const resolved = path.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function chunkArray<TItem>(items: TItem[], size: number): TItem[][] {
  if (size <= 0) {
    return [items];
  }

  const chunks: TItem[][] = [];
  for (let idx = 0; idx < items.length; idx += size) {
    chunks.push(items.slice(idx, idx + size));
  }
  return chunks;
}

function getSessionKey(session: Pick<SessionRepositoryRow, 'provider' | 'session_id'>): string {
  return `${session.provider}:${session.session_id}`;
}

function makeProjectKey(projectPath: string | null): string {
  const normalized = typeof projectPath === 'string' ? projectPath.trim() : '';
  return normalized.length > 0 ? normalized : UNKNOWN_PROJECT_KEY;
}

function toSummaryText(customName: string | null, fallback: string | null | undefined, emptyLabel: string): string {
  const trimmedCustomName = typeof customName === 'string' ? customName.trim() : '';
  if (trimmedCustomName) {
    return trimmedCustomName;
  }

  const trimmedFallback = typeof fallback === 'string' ? fallback.trim() : '';
  if (!trimmedFallback) {
    return emptyLabel;
  }

  return trimmedFallback.length > 50 ? `${trimmedFallback.slice(0, 50)}...` : trimmedFallback;
}

function isInternalContent(content: string): boolean {
  return INTERNAL_CONTENT_PREFIXES.some((prefix) => content.startsWith(prefix));
}

function isInternalCodexContent(content: string): boolean {
  const normalized = content.trimStart();
  return CODEX_INTERNAL_CONTENT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createWordMatcher(
  rawQuery: string,
  words: string[],
): Pick<SearchRuntime, 'matchesQuery' | 'buildSnippet'> {
  const normalizedQuery = rawQuery.trim().replace(/\s+/g, ' ');
  const requireExactPhrase = words.length > 1 && normalizedQuery.length > 0;
  const wordPatterns = words.map((word) => new RegExp(`(?<!\\p{L})${escapeRegex(word)}(?!\\p{L})`, 'u'));
  const phrasePattern = words.map((word) => escapeRegex(word)).join('\\s+');
  const phraseRegex = new RegExp(phrasePattern, 'iu');

  const allWordsMatch = (textLower: string): boolean =>
    wordPatterns.every((pattern) => pattern.test(textLower));

  const matchesQuery = (text: string): boolean => {
    if (typeof text !== 'string' || text.length === 0) {
      return false;
    }

    if (requireExactPhrase) {
      return phraseRegex.test(text);
    }

    if (phraseRegex.test(text)) {
      return true;
    }

    if (words.length === 1) {
      return allWordsMatch(text.toLowerCase());
    }

    return allWordsMatch(text.toLowerCase());
  };

  const buildSnippet = (
    text: string,
    snippetLen = 150,
  ): { snippet: string; highlights: SearchSnippetHighlight[] } => {
    const textLower = text.toLowerCase();
    let firstIndex = -1;
    let firstWordLen = 0;
    let phraseStart = -1;
    let phraseLength = 0;

    const phraseMatch = phraseRegex.exec(text);
    if (phraseMatch) {
      phraseStart = phraseMatch.index;
      phraseLength = phraseMatch[0].length;
      firstIndex = phraseStart;
      firstWordLen = phraseLength;
    }

    if (firstIndex === -1) {
      for (const word of words) {
        const regex = new RegExp(`(?<!\\p{L})${escapeRegex(word)}(?!\\p{L})`, 'u');
        const match = regex.exec(textLower);
        if (match && (firstIndex === -1 || match.index < firstIndex)) {
          firstIndex = match.index;
          firstWordLen = word.length;
        }
      }
    }

    if (firstIndex === -1) {
      firstIndex = 0;
    }

    const halfLen = Math.floor(snippetLen / 2);
    const start = Math.max(0, firstIndex - halfLen);
    const end = Math.min(text.length, firstIndex + halfLen + firstWordLen);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    const snippetBody = text.slice(start, end).replace(/\n/g, ' ');
    const snippet = `${prefix}${snippetBody}${suffix}`;

    const snippetLower = snippet.toLowerCase();
    const highlights: SearchSnippetHighlight[] = [];

    if (phraseStart >= start && phraseStart + phraseLength <= end) {
      const phraseOffset = prefix.length + (phraseStart - start);
      highlights.push({
        start: phraseOffset,
        end: phraseOffset + phraseLength,
      });
    }

    if (!requireExactPhrase) {
      for (const word of words) {
        const regex = new RegExp(`(?<!\\p{L})${escapeRegex(word)}(?!\\p{L})`, 'gu');
        let match = regex.exec(snippetLower);
        while (match) {
          highlights.push({ start: match.index, end: match.index + word.length });
          match = regex.exec(snippetLower);
        }
      }
    }

    highlights.sort((left, right) => left.start - right.start);
    const merged: SearchSnippetHighlight[] = [];
    for (const highlight of highlights) {
      const previous = merged[merged.length - 1];
      if (previous && highlight.start <= previous.end) {
        previous.end = Math.max(previous.end, highlight.end);
      } else {
        merged.push({ ...highlight });
      }
    }

    return { snippet, highlights: merged };
  };

  return { matchesQuery, buildSnippet };
}

function extractClaudeText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((part: AnyRecord) => part?.type === 'text' && typeof part?.text === 'string')
    .map((part: AnyRecord) => String(part.text))
    .join(' ');
}

function extractCodexText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const record = item as AnyRecord;
      if (
        (record.type === 'input_text' || record.type === 'output_text' || record.type === 'text')
        && typeof record.text === 'string'
      ) {
        return record.text;
      }

      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function extractGeminiText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((part: AnyRecord) => typeof part?.text === 'string')
    .map((part: AnyRecord) => String(part.text))
    .join(' ');
}

function normalizeSearchableSessions(rows: SessionRepositoryRow[]): SearchableSessionRow[] {
  const normalizedRows: SearchableSessionRow[] = [];

  for (const row of rows) {
    const provider = row.provider as SearchableProvider;
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      continue;
    }

    const rawJsonlPath = typeof row.jsonl_path === 'string' ? row.jsonl_path.trim() : '';
    if (!rawJsonlPath) {
      continue;
    }

    const absoluteJsonlPath = path.resolve(rawJsonlPath);
    if (!fsSync.existsSync(absoluteJsonlPath)) {
      continue;
    }

    normalizedRows.push({
      ...row,
      provider,
      jsonl_path: absoluteJsonlPath,
    });
  }

  return normalizedRows;
}

function buildProjectBuckets(searchableSessions: SearchableSessionRow[]): ProjectBucket[] {
  const projectBuckets = new Map<string, ProjectBucket>();
  const projectMetadataCache = new Map<string, { projectId: string | null; projectDisplayName: string }>();

  for (const session of searchableSessions) {
    const key = makeProjectKey(session.project_path);
    if (!projectBuckets.has(key)) {
      if (!projectMetadataCache.has(key)) {
        if (key === UNKNOWN_PROJECT_KEY) {
          projectMetadataCache.set(key, {
            projectId: null,
            projectDisplayName: 'Unknown Project',
          });
        } else {
          const projectRow = projectsDb.getProjectPath(key);
          const customProjectName = typeof projectRow?.custom_project_name === 'string'
            ? projectRow.custom_project_name.trim()
            : '';
          const displayName = customProjectName || path.basename(key) || key;

          projectMetadataCache.set(key, {
            projectId: projectRow?.project_id ?? null,
            projectDisplayName: displayName,
          });
        }
      }

      const metadata = projectMetadataCache.get(key) as { projectId: string | null; projectDisplayName: string };
      projectBuckets.set(key, {
        key,
        projectId: metadata.projectId,
        projectName: key,
        projectDisplayName: metadata.projectDisplayName,
        sessions: [],
      });
    }

    const bucket = projectBuckets.get(key) as ProjectBucket;
    bucket.sessions.push(session);
  }

  const buckets = Array.from(projectBuckets.values());
  for (const bucket of buckets) {
    bucket.sessions.sort((left, right) => {
      const leftTs = new Date(left.updated_at || left.created_at || 0).getTime();
      const rightTs = new Date(right.updated_at || right.created_at || 0).getTime();
      return rightTs - leftTs;
    });
  }

  return buckets;
}

/**
 * Executes ripgrep with the file list explicitly provided from sessionsDb jsonl paths.
 *
 * This avoids recursive directory walks and uses a fixed known candidate list.
 */
async function runRipgrepFilesWithMatches(
  pattern: string,
  filePaths: string[],
  signal?: AbortSignal,
): Promise<Set<string>> {
  if (!pattern || filePaths.length === 0 || signal?.aborted) {
    return new Set();
  }

  return new Promise((resolve, reject) => {
    const args = [
      '--files-with-matches',
      '--no-messages',
      '--ignore-case',
      '--fixed-strings',
      '--',
      pattern,
      ...filePaths,
    ];
    const rg = spawn(rgPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let aborted = false;

    const abortListener = () => {
      aborted = true;
      rg.kill();
    };

    if (signal) {
      signal.addEventListener('abort', abortListener, { once: true });
    }

    rg.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    rg.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    rg.on('error', (error) => {
      if (signal) {
        signal.removeEventListener('abort', abortListener);
      }

      if (aborted || signal?.aborted) {
        resolve(new Set());
        return;
      }

      reject(error);
    });

    rg.on('close', (code) => {
      if (signal) {
        signal.removeEventListener('abort', abortListener);
      }

      if (aborted || signal?.aborted) {
        resolve(new Set());
        return;
      }

      if (code !== 0 && code !== 1) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(new Error(`ripgrep failed with code ${String(code)}: ${stderr}`));
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const matchedPaths = new Set<string>();

      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        matchedPaths.add(normalizeComparablePath(trimmed));
      }

      resolve(matchedPaths);
    });
  });
}

async function findMatchedFileKeys(
  searchablePathEntries: SearchablePathEntry[],
  rawQuery: string,
  words: string[],
  signal?: AbortSignal,
): Promise<Set<string>> {
  if (searchablePathEntries.length === 0 || words.length === 0 || signal?.aborted) {
    return new Set();
  }

  const normalizedQuery = rawQuery.trim().replace(/\s+/g, ' ');
  const requireExactPhrase = words.length > 1 && normalizedQuery.length > 0;

  if (requireExactPhrase) {
    let matchedForPhrase = searchablePathEntries.slice();

    // Keep ripgrep as an over-approximation for exact phrase mode by requiring
    // each word to appear somewhere in the file, then defer strict phrase
    // validation to the in-memory matcher.
    for (const word of words) {
      if (signal?.aborted) {
        return new Set();
      }

      const matchedForWord = new Set<string>();
      const fileChunks = chunkArray(
        matchedForPhrase.map((entry) => entry.absolutePath),
        RIPGREP_FILE_CHUNK_SIZE,
      );

      let nextChunkIndex = 0;
      const workerCount = Math.min(RIPGREP_CHUNK_CONCURRENCY, fileChunks.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextChunkIndex < fileChunks.length && !signal?.aborted) {
          const currentIndex = nextChunkIndex;
          nextChunkIndex += 1;
          const chunkMatches = await runRipgrepFilesWithMatches(word, fileChunks[currentIndex], signal);
          for (const matchedPath of chunkMatches) {
            matchedForWord.add(matchedPath);
          }
        }
      });

      await Promise.all(workers);
      if (signal?.aborted) {
        return new Set();
      }

      matchedForPhrase = matchedForPhrase.filter((entry) => matchedForWord.has(entry.normalizedPath));
      if (matchedForPhrase.length === 0) {
        break;
      }
    }

    return new Set(matchedForPhrase.map((entry) => entry.normalizedPath));
  }

  let remainingEntries = searchablePathEntries.slice();

  // Run one ripgrep pass per term and intersect by keeping only files that
  // matched every query word.
  for (const word of words) {
    if (signal?.aborted) {
      return new Set();
    }

    const matchedForWord = new Set<string>();
    const fileChunks = chunkArray(
      remainingEntries.map((entry) => entry.absolutePath),
      RIPGREP_FILE_CHUNK_SIZE,
    );

    let nextChunkIndex = 0;
    const workerCount = Math.min(RIPGREP_CHUNK_CONCURRENCY, fileChunks.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextChunkIndex < fileChunks.length && !signal?.aborted) {
        const currentIndex = nextChunkIndex;
        nextChunkIndex += 1;
        const chunkMatches = await runRipgrepFilesWithMatches(word, fileChunks[currentIndex], signal);
        for (const matchedPath of chunkMatches) {
          matchedForWord.add(matchedPath);
        }
      }
    });

    await Promise.all(workers);
    if (signal?.aborted) {
      return new Set();
    }

    remainingEntries = remainingEntries.filter((entry) => matchedForWord.has(entry.normalizedPath));
    if (remainingEntries.length === 0) {
      break;
    }
  }

  return new Set(remainingEntries.map((entry) => entry.normalizedPath));
}

function addSessionMatch(
  runtime: SearchRuntime,
  matches: SessionConversationMatch[],
  match: SessionConversationMatch,
): void {
  if (runtime.totalMatches >= runtime.limit || matches.length >= MAX_MATCHES_PER_SESSION) {
    return;
  }

  matches.push(match);
  runtime.totalMatches += 1;
}

async function parseClaudeSessionMatches(
  session: SearchableSessionRow,
  runtime: SearchRuntime,
): Promise<SessionConversationResult | null> {
  const fileKey = normalizeComparablePath(session.jsonl_path);
  if (!fileKey) {
    return null;
  }

  if (!runtime.claudeFileResultsCache.has(fileKey)) {
    const sessionsForFile = runtime.claudeSessionsByFileKey.get(fileKey) || [];
    const matchedSessionsForFile = sessionsForFile.filter((candidate) =>
      runtime.matchedSessionKeys.has(getSessionKey(candidate)),
    );

    const targetSessions = matchedSessionsForFile.length > 0
      ? matchedSessionsForFile
      : [session];

    const targetSessionIds = new Set(targetSessions.map((candidate) => candidate.session_id));
    const customNameBySessionId = new Map<string, string | null>();
    for (const candidate of targetSessions) {
      customNameBySessionId.set(candidate.session_id, candidate.custom_name ?? null);
    }

    type ClaudeSessionSearchState = {
      matches: SessionConversationMatch[];
      pendingSummaries: Map<string, string>;
      fallbackUserText: string | null;
      fallbackAssistantText: string | null;
      resolvedSummary: string | null;
    };

    const sessionStateById = new Map<string, ClaudeSessionSearchState>();
    const getSessionState = (sessionId: string): ClaudeSessionSearchState => {
      if (!sessionStateById.has(sessionId)) {
        sessionStateById.set(sessionId, {
          matches: [],
          pendingSummaries: new Map<string, string>(),
          fallbackUserText: null,
          fallbackAssistantText: null,
          resolvedSummary: null,
        });
      }
      return sessionStateById.get(sessionId) as ClaudeSessionSearchState;
    };

    let currentSessionId: string | null = null;

    try {
      const fileStream = fsSync.createReadStream(session.jsonl_path);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (runtime.totalMatches >= runtime.limit || runtime.isAborted()) {
          break;
        }
        if (!line.trim()) {
          continue;
        }

        let entry: AnyRecord;
        try {
          entry = JSON.parse(line) as AnyRecord;
        } catch {
          continue;
        }

        if (entry.sessionId) {
          currentSessionId = String(entry.sessionId);
        }
        const entrySessionId = entry.sessionId
          ? String(entry.sessionId)
          : currentSessionId;
        if (!entrySessionId || !targetSessionIds.has(entrySessionId)) {
          continue;
        }

        const state = getSessionState(entrySessionId);

        if (entry.type === 'summary' && entry.summary) {
          const summaryValue = String(entry.summary);
          if (entry.sessionId) {
            state.resolvedSummary = summaryValue;
          } else if (entry.leafUuid) {
            state.pendingSummaries.set(String(entry.leafUuid), summaryValue);
          }
        }

        if (!state.resolvedSummary && entry.parentUuid) {
          const pendingSummary = state.pendingSummaries.get(String(entry.parentUuid));
          if (pendingSummary) {
            state.resolvedSummary = pendingSummary;
          }
        }

        if (!entry.message?.content || entry.isApiErrorMessage) {
          continue;
        }

        const role = entry.message.role;
        if (role !== 'user' && role !== 'assistant') {
          continue;
        }

        const text = extractClaudeText(entry.message.content);
        if (!text || isInternalContent(text)) {
          continue;
        }

        if (role === 'user') {
          state.fallbackUserText = text;
        } else {
          state.fallbackAssistantText = text;
        }

        if (!runtime.matchesQuery(text)) {
          continue;
        }

        const { snippet, highlights } = runtime.buildSnippet(text);
        addSessionMatch(runtime, state.matches, {
          role,
          snippet,
          highlights,
          timestamp: entry.timestamp ? String(entry.timestamp) : null,
          provider: 'claude',
          messageUuid: entry.uuid ? String(entry.uuid) : null,
        });
      }
    } catch {
      runtime.claudeFileResultsCache.set(fileKey, new Map());
      return null;
    }

    const fileResults = new Map<string, SessionConversationResult>();
    for (const [sessionId, state] of sessionStateById.entries()) {
      if (state.matches.length === 0) {
        continue;
      }

      fileResults.set(sessionId, {
        sessionId,
        provider: 'claude',
        sessionSummary: toSummaryText(
          customNameBySessionId.get(sessionId) ?? null,
          state.resolvedSummary || state.fallbackUserText || state.fallbackAssistantText,
          'New Session',
        ),
        matches: state.matches,
      });
    }

    runtime.claudeFileResultsCache.set(fileKey, fileResults);
  }

  return runtime.claudeFileResultsCache.get(fileKey)?.get(session.session_id) ?? null;
}

function isVisibleCodexUserMessage(payload: AnyRecord | null | undefined): boolean {
  if (!payload || payload.type !== 'user_message') {
    return false;
  }

  if (payload.kind && payload.kind !== 'plain') {
    return false;
  }

  return typeof payload.message === 'string' && payload.message.trim().length > 0;
}

async function parseCodexSessionMatches(
  session: SearchableSessionRow,
  runtime: SearchRuntime,
): Promise<SessionConversationResult | null> {
  const matches: SessionConversationMatch[] = [];
  let latestUserMessageText: string | null = null;
  const seenMessageFingerprints = new Set<string>();

  try {
    const fileStream = fsSync.createReadStream(session.jsonl_path);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (runtime.totalMatches >= runtime.limit || runtime.isAborted()) {
        break;
      }
      if (!line.trim()) {
        continue;
      }

      let entry: AnyRecord;
      try {
        entry = JSON.parse(line) as AnyRecord;
      } catch {
        continue;
      }

      let text: string | null = null;
      let role: 'user' | 'assistant' | null = null;

      if (entry.type === 'event_msg' && isVisibleCodexUserMessage(entry.payload as AnyRecord)) {
        text = String(entry.payload.message);
        role = 'user';
      } else if (
        entry.type === 'event_msg'
        && entry.payload?.type === 'agent_reasoning'
        && typeof entry.payload?.text === 'string'
      ) {
        text = String(entry.payload.text);
        role = 'assistant';
      } else if (entry.type === 'response_item' && entry.payload?.type === 'message') {
        const payload = entry.payload as AnyRecord;
        if (payload.role === 'user') {
          text = extractCodexText(payload.content);
          role = 'user';
        } else if (payload.role === 'assistant') {
          text = extractCodexText(payload.content);
          role = 'assistant';
        }
      } else if (entry.type === 'response_item' && entry.payload?.type === 'reasoning') {
        const summaryText = Array.isArray(entry.payload.summary)
          ? entry.payload.summary
            .map((item: AnyRecord) => (typeof item?.text === 'string' ? item.text : ''))
            .filter(Boolean)
            .join('\n')
          : '';

        if (summaryText.trim()) {
          text = summaryText;
          role = 'assistant';
        }
      }

      if (!text || !role) {
        continue;
      }
      if (isInternalCodexContent(text)) {
        continue;
      }
      if (role === 'user') {
        latestUserMessageText = text;
      }

      const fingerprint = `${role}:${text.trim().toLowerCase()}`;
      if (seenMessageFingerprints.has(fingerprint)) {
        continue;
      }
      seenMessageFingerprints.add(fingerprint);

      if (!runtime.matchesQuery(text)) {
        continue;
      }

      const { snippet, highlights } = runtime.buildSnippet(text);
      addSessionMatch(runtime, matches, {
        role,
        snippet,
        highlights,
        timestamp: entry.timestamp ? String(entry.timestamp) : null,
        provider: 'codex',
      });
    }
  } catch {
    return null;
  }

  if (matches.length === 0) {
    return null;
  }

  return {
    sessionId: session.session_id,
    provider: 'codex',
    sessionSummary: toSummaryText(session.custom_name, latestUserMessageText, 'Codex Session'),
    matches,
  };
}

async function parseGeminiSessionMatches(
  session: SearchableSessionRow,
  runtime: SearchRuntime,
): Promise<SessionConversationResult | null> {
  let data: string;
  try {
    data = await fs.readFile(session.jsonl_path, 'utf8');
  } catch {
    return null;
  }

  let parsed: AnyRecord;
  try {
    parsed = JSON.parse(data) as AnyRecord;
  } catch {
    return null;
  }

  const sourceMessages = Array.isArray(parsed.messages) ? parsed.messages as AnyRecord[] : [];
  if (sourceMessages.length === 0) {
    return null;
  }

  const matches: SessionConversationMatch[] = [];
  let firstUserText: string | null = null;

  for (const msg of sourceMessages) {
    if (runtime.totalMatches >= runtime.limit || runtime.isAborted()) {
      break;
    }

    const role = msg.type === 'user'
      ? 'user'
      : (msg.type === 'gemini' || msg.type === 'assistant')
        ? 'assistant'
        : null;
    if (!role) {
      continue;
    }

    const text = extractGeminiText(msg.content);
    if (!text) {
      continue;
    }

    if (role === 'user' && !firstUserText) {
      firstUserText = text;
    }

    if (!runtime.matchesQuery(text)) {
      continue;
    }

    const { snippet, highlights } = runtime.buildSnippet(text);
    addSessionMatch(runtime, matches, {
      role,
      snippet,
      highlights,
      timestamp: msg.timestamp ? String(msg.timestamp) : null,
      provider: 'gemini',
    });
  }

  if (matches.length === 0) {
    return null;
  }

  return {
    sessionId: session.session_id,
    provider: 'gemini',
    sessionSummary: toSummaryText(session.custom_name, firstUserText, 'Gemini Session'),
    matches,
  };
}

async function parseSessionMatches(
  session: SearchableSessionRow,
  runtime: SearchRuntime,
): Promise<SessionConversationResult | null> {
  if (session.provider === 'claude') {
    return parseClaudeSessionMatches(session, runtime);
  }
  if (session.provider === 'codex') {
    return parseCodexSessionMatches(session, runtime);
  }
  return parseGeminiSessionMatches(session, runtime);
}

export async function searchConversations(
  query: string,
  limit = 50,
  onProjectResult: ((update: SessionConversationSearchProgressUpdate) => void) | null = null,
  signal: AbortSignal | null = null,
): Promise<{ results: ProjectConversationResult[]; totalMatches: number; query: string }> {
  const safeQuery = typeof query === 'string' ? query.trim() : '';
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 200));
  const words = safeQuery.toLowerCase().split(/\s+/).filter((word) => word.length > 0);

  if (words.length === 0) {
    return { results: [], totalMatches: 0, query: safeQuery };
  }

  const isAborted = () => signal?.aborted === true;
  if (isAborted()) {
    return { results: [], totalMatches: 0, query: safeQuery };
  }

  const searchableSessions = normalizeSearchableSessions(sessionsDb.getAllSessions());
  if (searchableSessions.length === 0) {
    return { results: [], totalMatches: 0, query: safeQuery };
  }

  const sessionsByPathKey = new Map<string, SearchableSessionRow[]>();
  const searchablePathEntries: SearchablePathEntry[] = [];

  for (const session of searchableSessions) {
    const normalizedPath = normalizeComparablePath(session.jsonl_path);
    if (!normalizedPath) {
      continue;
    }

    if (!sessionsByPathKey.has(normalizedPath)) {
      sessionsByPathKey.set(normalizedPath, []);
      searchablePathEntries.push({
        normalizedPath,
        absolutePath: session.jsonl_path,
      });
    }

    const pathSessions = sessionsByPathKey.get(normalizedPath) as SearchableSessionRow[];
    pathSessions.push(session);
  }

  const matchedFileKeys = await findMatchedFileKeys(
    searchablePathEntries,
    safeQuery,
    words,
    signal ?? undefined,
  );
  if (isAborted() || matchedFileKeys.size === 0) {
    return { results: [], totalMatches: 0, query: safeQuery };
  }

  const matchedSessionKeys = new Set<string>();
  for (const fileKey of matchedFileKeys) {
    const sessions = sessionsByPathKey.get(fileKey);
    if (!sessions) {
      continue;
    }

    for (const session of sessions) {
      matchedSessionKeys.add(getSessionKey(session));
    }
  }

  const projectBuckets = buildProjectBuckets(searchableSessions);
  const totalProjects = projectBuckets.length;
  const results: ProjectConversationResult[] = [];
  let scannedProjects = 0;

  const runtime: SearchRuntime = {
    ...createWordMatcher(safeQuery, words),
    limit: safeLimit,
    totalMatches: 0,
    isAborted,
    matchedSessionKeys,
    claudeSessionsByFileKey: new Map<string, SearchableSessionRow[]>(),
    claudeFileResultsCache: new Map<string, Map<string, SessionConversationResult>>(),
  };

  for (const [fileKey, sessions] of sessionsByPathKey.entries()) {
    const claudeSessions = sessions.filter((session) => session.provider === 'claude');
    if (claudeSessions.length > 0) {
      runtime.claudeSessionsByFileKey.set(fileKey, claudeSessions);
    }
  }

  for (const bucket of projectBuckets) {
    if (runtime.totalMatches >= runtime.limit || runtime.isAborted()) {
      break;
    }

    const projectResult: ProjectConversationResult = {
      projectId: bucket.projectId,
      projectName: bucket.projectName,
      projectDisplayName: bucket.projectDisplayName,
      sessions: [],
    };

    for (const session of bucket.sessions) {
      if (runtime.totalMatches >= runtime.limit || runtime.isAborted()) {
        break;
      }
      if (!matchedSessionKeys.has(getSessionKey(session))) {
        continue;
      }

      const sessionResult = await parseSessionMatches(session, runtime);
      if (sessionResult) {
        projectResult.sessions.push(sessionResult);
      }
    }

    scannedProjects += 1;
    if (projectResult.sessions.length > 0) {
      results.push(projectResult);
      onProjectResult?.({
        projectResult,
        totalMatches: runtime.totalMatches,
        scannedProjects,
        totalProjects,
      });
    } else if (onProjectResult && scannedProjects % 10 === 0) {
      onProjectResult({
        projectResult: null,
        totalMatches: runtime.totalMatches,
        scannedProjects,
        totalProjects,
      });
    }
  }

  return {
    results,
    totalMatches: runtime.totalMatches,
    query: safeQuery,
  };
}

/**
 * Application service for session-conversation search.
 *
 * Provider routes call this service so route handlers stay focused on
 * request parsing/response formatting, while search execution remains
 * centralized in one place.
 */
export const sessionConversationsSearchService = {
  /**
   * Streams progress updates while the search scans provider session logs.
   */
  async search(input: SearchSessionConversationsInput): Promise<void> {
    await searchConversations(
      input.query,
      input.limit,
      input.onProgress ?? null,
      input.signal ?? null,
    );
  },
};
