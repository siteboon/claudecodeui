import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { NormalizedMessage } from '@/shared/types.js';

/**
 * Local transcript store for the Antigravity provider.
 *
 * agy keeps its own conversation history inside a protobuf-backed SQLite file
 * (`~/.gemini/antigravity-cli/conversations/<id>.db`), which cannot be read
 * without agy's generated protobuf definitions. Rather than depend on that,
 * this provider writes its own append-only JSONL transcript per conversation,
 * exactly like the other providers' on-disk artifacts. The file then feeds
 * `fetchHistory`, the sidebar indexer, and session titles.
 *
 * A transcript file holds two record shapes:
 *   { type: 'meta', sessionId, projectPath, title, model, createdAt }
 *   { type: 'message', message: NormalizedMessage }
 */

type AntigravityTranscriptMeta = {
  sessionId: string;
  projectPath: string;
  title: string | null;
  model: string | null;
  createdAt: string;
};

type TranscriptRecord =
  | ({ type: 'meta' } & AntigravityTranscriptMeta)
  | { type: 'message'; message: NormalizedMessage };

/** Root of this provider's own artifacts. Override with ANTIGRAVITY_TRANSCRIPTS_DIR. */
export function getAntigravityTranscriptsRoot(): string {
  return process.env.ANTIGRAVITY_TRANSCRIPTS_DIR
    || path.join(os.homedir(), '.cloudcli', 'antigravity');
}

/** Keeps a provider-native id from escaping the transcripts directory. */
function safeTranscriptName(sessionId: string): string {
  const cleaned = String(sessionId || '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned || 'unknown';
}

export function transcriptPathFor(sessionId: string): string {
  return path.join(getAntigravityTranscriptsRoot(), `${safeTranscriptName(sessionId)}.jsonl`);
}

export async function ensureTranscriptsRoot(): Promise<void> {
  await fsp.mkdir(getAntigravityTranscriptsRoot(), { recursive: true });
}

/** Writes the meta header once; later turns keep the first header. */
export async function writeTranscriptMeta(meta: AntigravityTranscriptMeta): Promise<void> {
  await ensureTranscriptsRoot();
  const target = transcriptPathFor(meta.sessionId);
  try {
    await fsp.access(target);
    return;
  } catch {
    // First turn of this conversation: fall through and create the header.
  }
  const record: TranscriptRecord = { type: 'meta', ...meta };
  await fsp.writeFile(target, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
}

/** Appends normalized messages so a reload can replay the conversation. */
export async function appendTranscriptMessages(
  sessionId: string,
  messages: NormalizedMessage[],
): Promise<void> {
  if (messages.length === 0) {
    return;
  }
  await ensureTranscriptsRoot();
  const body = messages
    .map((message): TranscriptRecord => ({ type: 'message', message }))
    .map((record) => JSON.stringify(record))
    .join('\n');
  await fsp.appendFile(transcriptPathFor(sessionId), `${body}\n`, { encoding: 'utf8' });
}

type ReadTranscriptResult = {
  meta: AntigravityTranscriptMeta | null;
  messages: NormalizedMessage[];
};

/**
 * Reads one transcript. Malformed or partially written lines are skipped so a
 * crash mid-append never makes the whole conversation unreadable.
 */
export async function readTranscript(sessionId: string): Promise<ReadTranscriptResult> {
  let text = '';
  try {
    text = await fsp.readFile(transcriptPathFor(sessionId), 'utf8');
  } catch {
    return { meta: null, messages: [] };
  }

  let meta: AntigravityTranscriptMeta | null = null;
  const messages: NormalizedMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const record = JSON.parse(trimmed) as TranscriptRecord;
      if (record.type === 'meta' && !meta) {
        meta = record;
      } else if (record.type === 'message' && record.message) {
        messages.push(record.message);
      }
    } catch {
      // Skip a torn tail line.
    }
  }

  return { meta, messages };
}

/** Lists every transcript file as `{ sessionId, filePath }`. */
export async function listTranscriptFiles(): Promise<Array<{ sessionId: string; filePath: string }>> {
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(getAntigravityTranscriptsRoot());
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({
      sessionId: name.slice(0, -'.jsonl'.length),
      filePath: path.join(getAntigravityTranscriptsRoot(), name),
    }));
}
