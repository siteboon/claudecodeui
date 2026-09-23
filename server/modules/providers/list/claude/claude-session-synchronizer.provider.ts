import os from 'node:os';
import path from 'node:path';
import { open, readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
  buildCloudCliSessionName,
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  /**
   * The transcript's latest `/rename` title ('' when it has none) to record
   * on the row, and whether it also becomes the session's name.
   */
  providerTitleUpdate?: { title: string; rename: boolean };
};

type IndexedSession = NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;

const UNTITLED_SESSION_NAME = 'Untitled Claude Session';

/**
 * How far back from a transcript's end the latest `/rename` title of an
 * already-indexed session is looked for. The Claude CLI keeps its session
 * metadata, `custom-title` included, within the last 64 KiB: its own session
 * picker reads no further back, so it re-appends that metadata after every
 * 32 KiB it writes, and on exit. 1 MiB leaves room for large single rows.
 */
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;

/**
 * Session indexer for Claude transcript artifacts.
 */
export class ClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'claude' as const;
  private readonly claudeHome = path.join(os.homedir(), '.claude');

  /**
   * Returns true when a JSONL file is a subagent transcript or tool result
   * rather than a top-level session.
   *
   * Claude stores subagent transcripts under a `subagents/` directory and
   * tool results under a `tool-results/` directory, e.g.
   * `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl`.
   * Those files repeat the parent session's `sessionId`, so indexing them as
   * standalone sessions overwrites the parent row's `jsonl_path` and corrupts
   * the main session record. The recursive scan in `synchronize()` reaches
   * them, so both entry points must skip them.
   */
  private isSubagentTranscript(filePath: string): boolean {
    const pathParts = path.normalize(filePath).split(path.sep);
    return pathParts.includes('subagents') || pathParts.includes('tool-results');
  }

  /**
   * Scans ~/.claude/projects and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(this.claudeHome, 'projects'),
      '.jsonl',
      since ?? null
    );

    let processed = 0;
    for (const filePath of files) {
      if (this.isSubagentTranscript(filePath)) {
        continue;
      }

      const parsed = await this.processSessionFile(filePath, nameMap);
      if (!parsed) {
        continue;
      }

      await this.upsertSession(filePath, parsed);
      processed += 1;
    }

    return processed;
  }

  /**
   * Parses and upserts one Claude session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }
    if (this.isSubagentTranscript(filePath)) {
      return null;
    }

    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const parsed = await this.processSessionFile(filePath, nameMap);
    if (!parsed) {
      return null;
    }

    return this.upsertSession(filePath, parsed);
  }

  /**
   * Writes one parsed session to the DB and returns its app session id.
   */
  private async upsertSession(filePath: string, parsed: ParsedSession): Promise<string> {
    const timestamps = await readFileTimestamps(filePath);
    const sessionId = sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath
    );

    if (parsed.providerTitleUpdate) {
      sessionsDb.setSessionProviderTitle(sessionId, parsed.providerTitleUpdate.title, {
        rename: parsed.providerTitleUpdate.rename,
      });
    }

    return sessionId;
  }

  /**
   * Extracts session metadata from one Claude JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      const projectPath = typeof data.cwd === 'string' ? data.cwd : undefined;

      if (!sessionId || !projectPath) {
        return null;
      }

      return {
        sessionId,
        projectPath,
      };
    });

    if (!parsed) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSession && existingSessionName && existingSessionName !== UNTITLED_SESSION_NAME) {
      // No `sessionName`: `createSession` then keeps the name the row holds
      // when it writes, so a CloudCLI rename made while the transcript was
      // being read is not overwritten by the name read before it.
      return {
        ...parsed,
        providerTitleUpdate: await this.resolveProviderTitleUpdate(
          filePath,
          parsed.sessionId,
          existingSession,
          nameMap.get(parsed.sessionId)
        ),
      };
    }

    const content = await readTranscript(filePath);
    const findTitle = (type: string, field: string) => (
      content ? findLastSessionRowValue(content, parsed.sessionId, type, field) : undefined
    );
    const customTitle = findTitle('custom-title', 'customTitle');
    let sessionName = customTitle || findTitle('ai-title', 'aiTitle') || findTitle('last-prompt', 'lastPrompt');
    if (!sessionName) {
      sessionName = nameMap.get(parsed.sessionId);
    }

    // Recording the title the name came from (or that there is none) lets
    // later syncs tell a new `/rename` from the CLI re-stating this one.
    const providerTitle = normalizeSessionName(customTitle, '');
    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, UNTITLED_SESSION_NAME),
      providerTitleUpdate: content ? { title: providerTitle, rename: Boolean(providerTitle) } : undefined,
    };
  }

  /**
   * Decides whether a named session's transcript holds a new `/rename`.
   *
   * The CLI re-states the title it holds on exit, periodically and after
   * compaction, so only a title that differs from the one recorded on the row
   * is a new rename. A new rename is the user's latest choice and replaces the
   * name, even one set in CloudCLI; a re-stated one changes nothing, so a
   * later CloudCLI rename stands.
   */
  private async resolveProviderTitleUpdate(
    filePath: string,
    sessionId: string,
    session: IndexedSession,
    historyDisplay: string | undefined
  ): Promise<ParsedSession['providerTitleUpdate']> {
    if (session.provider_title !== null) {
      const tail = await readTranscriptTail(filePath, TRANSCRIPT_TAIL_BYTES);
      const title = normalizeSessionName(
        tail ? findLastSessionRowValue(tail, sessionId, 'custom-title', 'customTitle') : undefined,
        ''
      );
      return title && title !== session.provider_title ? { title, rename: true } : undefined;
    }

    // Not read since titles are recorded (a row from before that, or one the
    // app created): the latest title can sit anywhere in the transcript.
    const content = await readTranscript(filePath);
    if (!content) {
      return undefined;
    }

    const title = normalizeSessionName(
      findLastSessionRowValue(content, sessionId, 'custom-title', 'customTitle'),
      ''
    );
    if (!title) {
      return { title: '', rename: false };
    }

    // A fork's transcript opens with the title CloudCLI gave the branch (the
    // SDK writes it as a `custom-title`), so it is not a rename.
    if (session.forked_from_session_id) {
      return { title, rename: false };
    }

    // The title may predate a CloudCLI rename, so it only replaces a name
    // nobody chose.
    return {
      title,
      rename: isAutomaticSessionName(session.custom_name, content, sessionId, historyDisplay),
    };
  }
}

/**
 * Reads a whole transcript; null when it is missing or unreadable.
 */
async function readTranscript(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Reads the complete lines within the last `maxBytes` of a transcript; null
 * when it is missing or unreadable.
 */
async function readTranscriptTail(filePath: string, maxBytes: number): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, 'r');
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const tail = buffer.subarray(0, bytesRead);
    if (start === 0) {
      return tail;
    }

    // A tail that starts mid-file starts mid-line; drop that partial line.
    const firstNewline = tail.indexOf(0x0a);
    return firstNewline === -1 ? Buffer.alloc(0) : tail.subarray(firstNewline + 1);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * True when a session's stored name is one CloudCLI produced rather than one
 * a user chose: the fallback, any title or prompt the transcript or
 * history.jsonl offers (older versions did not always take the latest), or
 * the first-message name CloudCLI gives a session it starts.
 */
function isAutomaticSessionName(
  name: string | null,
  content: Buffer,
  sessionId: string,
  historyDisplay: string | undefined
): boolean {
  const storedName = normalizeSessionName(name ?? undefined, UNTITLED_SESSION_NAME);
  const isStoredName = (value: string | undefined) => normalizeSessionName(value, '') === storedName;

  if (storedName === UNTITLED_SESSION_NAME || isStoredName(historyDisplay)) {
    return true;
  }

  const titleRows = [
    ['custom-title', 'customTitle'],
    ['ai-title', 'aiTitle'],
    ['last-prompt', 'lastPrompt'],
  ] as const;
  for (const [type, field] of titleRows) {
    for (const value of findSessionRowValues(content, sessionId, type, field)) {
      if (isStoredName(value)) {
        return true;
      }
    }
  }

  const firstPrompt = findFirstUserPrompt(content, sessionId);
  return firstPrompt !== undefined && isStoredName(buildCloudCliSessionName(firstPrompt));
}

/**
 * Returns the newest non-blank `field` of the `type` rows one session wrote
 * to a transcript.
 */
function findLastSessionRowValue(
  content: Buffer,
  sessionId: string,
  type: string,
  field: string
): string | undefined {
  for (const value of findSessionRowValues(content, sessionId, type, field)) {
    return value;
  }

  return undefined;
}

/**
 * Yields the non-blank `field` of every `type` row one session wrote to a
 * transcript, newest first.
 *
 * Transcripts reach tens of megabytes, so instead of decoding and splitting
 * the whole file this searches the raw bytes backwards for `"type":"<type>"`
 * (the compact form the Claude CLI and SDK write these rows in, and the one
 * the CLI searches for itself) and decodes only the lines that match.
 */
function* findSessionRowValues(
  content: Buffer,
  sessionId: string,
  type: string,
  field: string
): Generator<string> {
  const marker = `"type":"${type}"`;
  let searchEnd = content.length - 1;

  while (searchEnd >= 0) {
    const markerIndex = content.lastIndexOf(marker, searchEnd);
    if (markerIndex === -1) {
      return;
    }

    const lineStart = content.lastIndexOf(0x0a, markerIndex) + 1;
    const newlineIndex = content.indexOf(0x0a, markerIndex);
    const line = content.toString('utf8', lineStart, newlineIndex === -1 ? content.length : newlineIndex);
    // The next search must end before this line; a negative offset would
    // make `lastIndexOf` count from the end of the buffer instead.
    searchEnd = lineStart - 1;

    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    // The marker can also sit inside a nested object, and a transcript can
    // carry rows of other sessions, so the row itself must match.
    const value = row[field];
    if (row.type === type && row.sessionId === sessionId && typeof value === 'string' && value.trim()) {
      yield value;
    }
  }
}

/**
 * Returns the text of the first prompt one session's user typed, skipping
 * meta rows and tool results.
 */
function findFirstUserPrompt(content: Buffer, sessionId: string): string | undefined {
  const marker = '"type":"user"';
  let searchStart = 0;

  while (searchStart < content.length) {
    const markerIndex = content.indexOf(marker, searchStart);
    if (markerIndex === -1) {
      return undefined;
    }

    const lineStart = content.lastIndexOf(0x0a, markerIndex) + 1;
    const newlineIndex = content.indexOf(0x0a, markerIndex);
    const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
    searchStart = lineEnd + 1;

    let row: Record<string, unknown>;
    try {
      row = JSON.parse(content.toString('utf8', lineStart, lineEnd)) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (row.type !== 'user' || row.sessionId !== sessionId || row.isMeta || row.isSidechain) {
      continue;
    }

    const message = row.message as { content?: unknown } | undefined;
    if (typeof message?.content === 'string') {
      return message.content;
    }
    if (Array.isArray(message?.content)) {
      const blocks = message.content as { type?: unknown; text?: unknown }[];
      if (blocks.some((block) => block?.type === 'tool_result')) {
        continue;
      }
      const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
      return typeof textBlock?.text === 'string' ? textBlock.text : '';
    }
  }

  return undefined;
}
