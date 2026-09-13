import fsSync from 'node:fs';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import {
  getPiSessionDir,
  normalizeProviderTimestamp,
  normalizeSessionName,
  readOptionalString,
} from '@/shared/utils.js';

import { normalizeTranscriptEntry, readPiTranscriptEntries } from './pi-sessions.provider.js';

const PROVIDER = 'pi';
const FALLBACK_TITLE = 'Untitled pi Session';

type PiSessionHeader = {
  providerSessionId: string;
  projectPath: string;
  createdAt: string;
};

type PiSessionTranscript = {
  path: string;
  /** File mtime, ISO-normalized: pi appends resumes, so this is last activity. */
  updatedAt: string;
};

/**
 * Extracts the `session` header entry every pi transcript starts with.
 *
 * Verified layout (docs/pi-notes.md, pi 0.85.1): the first line carries the
 * provider-native session id and the working directory the session ran in —
 * the only two values the sidebar needs to place the session.
 */
const readPiSessionHeader = (entries: AnyRecord[]): PiSessionHeader | null => {
  for (const entry of entries) {
    if (readOptionalString(entry.type) !== 'session') {
      continue;
    }

    const providerSessionId = readOptionalString(entry.id);
    const projectPath = readOptionalString(entry.cwd);
    if (!providerSessionId || !projectPath) {
      return null;
    }

    return {
      providerSessionId,
      projectPath,
      createdAt: normalizeProviderTimestamp(entry.timestamp),
    };
  }

  return null;
};

/**
 * Derives a sidebar title from one parsed transcript.
 *
 * An explicit `session_info` name wins when pi records one (not present in the
 * 0.85.1 samples, so treated as optional); otherwise the first user prompt is
 * used, read through the same normalizer the history view renders so
 * `<images_input>`/`<files_input>` scaffolding never leaks into the title.
 */
const readPiSessionTitle = (entries: AnyRecord[]): string | undefined => {
  for (const entry of entries) {
    if (readOptionalString(entry.type) !== 'session_info') {
      continue;
    }

    const name = readOptionalString(entry.name);
    if (name) {
      return name;
    }
  }

  for (const entry of entries) {
    const userText = normalizeTranscriptEntry(entry, null)
      .find((message) => message.kind === 'text' && message.role === 'user')
      ?.content;
    if (userText) {
      return userText;
    }
  }

  return undefined;
};

/**
 * Session indexer for pi's JSONL transcripts under `~/.pi/agent/sessions`.
 */
export class PiSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = PROVIDER;

  /**
   * Recursively scans the pi session directory and upserts every transcript
   * modified since the given cursor into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const transcripts = this.listSessionTranscripts(since);

    let processed = 0;
    for (const transcript of transcripts) {
      if (this.upsertSession(transcript)) {
        processed += 1;
      }
    }

    return processed;
  }

  /**
   * Handles watcher changes for one pi session transcript.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!this.isPiSessionTranscript(filePath)) {
      return null;
    }

    const transcript = this.readTranscriptTimestamp(filePath);
    if (!transcript) {
      return null;
    }

    return this.upsertSession(transcript);
  }

  /**
   * Lists `.jsonl` transcripts under the pi session directory, recursively.
   *
   * The `since` cursor filters on mtime: pi appends resumed turns to the same
   * file, so an updated mtime is what makes an existing session re-index.
   */
  private listSessionTranscripts(since?: Date): PiSessionTranscript[] {
    const transcripts: PiSessionTranscript[] = [];
    const walk = (directory: string): void => {
      let entries: fsSync.Dirent[];
      try {
        entries = fsSync.readdirSync(directory, { withFileTypes: true });
      } catch {
        // A missing pi data directory just means "no sessions yet".
        return;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (entry.name.endsWith('.jsonl')) {
          const transcript = this.readTranscriptTimestamp(entryPath);
          if (!transcript) {
            continue;
          }
          if (since && new Date(transcript.updatedAt).getTime() < since.getTime()) {
            continue;
          }
          transcripts.push(transcript);
        }
      }
    };

    walk(getPiSessionDir());
    // File names lead with a timestamp, so lexical order is chronological and
    // sidebar upserts land oldest-first.
    return transcripts.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Reads one transcript's mtime as its last-activity timestamp. */
  private readTranscriptTimestamp(filePath: string): PiSessionTranscript | null {
    try {
      return {
        path: filePath,
        updatedAt: normalizeProviderTimestamp(fsSync.statSync(filePath).mtimeMs),
      };
    } catch {
      // The file may have been removed between listing and reading.
      return null;
    }
  }

  /**
   * Only transcripts inside the pi session directory are pi sessions.
   *
   * The watcher hands this synchronizer every `.jsonl` change under the pi
   * root; anything else (opencode's sqlite store, stray files) is ignored.
   */
  private isPiSessionTranscript(filePath: string): boolean {
    if (!filePath.endsWith('.jsonl')) {
      return false;
    }

    const relative = path.relative(getPiSessionDir(), filePath);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  /**
   * Parses and upserts one pi transcript, returning the canonical session row
   * id, or null when the file carries no usable session header.
   */
  private upsertSession(transcript: PiSessionTranscript): string | null {
    let entries: AnyRecord[];
    try {
      entries = readPiTranscriptEntries(transcript.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[PiProvider] Failed to read session transcript ${transcript.path}:`, message);
      return null;
    }

    const header = readPiSessionHeader(entries);
    if (!header) {
      return null;
    }

    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(header.providerSessionId)
      ?? sessionsDb.getSessionById(header.providerSessionId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, header.projectPath);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      // Slow model responses can let the watcher index the transcript before
      // the runtime reports its provider id back through the websocket
      // mapping. Bind that id to the fresh app row first so the watcher does
      // not create a temporary provider-id sidebar entry for the same session.
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, header.providerSessionId);
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(header.providerSessionId)
      ?? sessionsDb.getSessionById(header.providerSessionId);
    const existingName = existingSession?.custom_name;

    let nextName: string | undefined;
    if (existingName && existingName !== FALLBACK_TITLE) {
      nextName = existingName;
    } else {
      nextName = readPiSessionTitle(entries);
    }

    // pi keeps every session of a working directory in one shared tree, so
    // jsonl_path must stay null to avoid deleting that folder when one app
    // session is removed.
    return sessionsDb.createSession(
      header.providerSessionId,
      this.provider,
      header.projectPath,
      normalizeSessionName(nextName, FALLBACK_TITLE),
      header.createdAt,
      transcript.updatedAt,
      null,
    );
  }
}
