import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import {
  extractFirstValidJsonlData,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  storeDbPath: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Returns directory entries or an empty list when the folder is missing.
 */
async function listDirectoryEntriesSafe(
  directoryPath: string
): Promise<import('node:fs').Dirent[]> {
  try {
    return await fsp.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Returns whether a regular file exists. Only a missing path counts as absent;
 * any other error (permissions, symlink loops) is rethrown so it gets logged.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fsp.stat(filePath)).isFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false;
    }
    throw error;
  }
}

/**
 * Mirrors how Cursor names `~/.cursor/projects/<slug>` after a workspace path:
 * non-alphanumerics become `-`, runs of `-` collapse, and edges are trimmed.
 */
function toCursorProjectSlug(workspacePath: string): string {
  return workspacePath
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Converts a `meta.json` millisecond timestamp to ISO, ignoring invalid values.
 */
function toIsoTimestamp(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value).toISOString()
    : undefined;
}

/**
 * Session indexer for Cursor CLI (cursor-agent) chats.
 *
 * cursor-agent keeps each chat in `~/.cursor/chats/<md5(cwd)>/<id>/` as a
 * `meta.json` sidecar plus the `store.db` history CloudCLI reads and resumes.
 * Only these chats are indexed: Cursor IDE chats also leave transcripts under
 * `~/.cursor/projects`, but have no CLI store, so they can neither be loaded
 * nor resumed by cursor-agent.
 */
export class CursorSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'cursor' as const;
  private readonly cursorHome = path.join(os.homedir(), '.cursor');

  /**
   * Scans every Cursor CLI chat and upserts it into the DB.
   *
   * `since` is ignored: there is one small `meta.json` per chat, and chats
   * created before an upgrade (which older builds never indexed) must still
   * be found by the first scan afterwards.
   *
   * One unreadable chat is logged and skipped rather than ending the scan.
   * After a scan with no such failures, rows left by the older
   * transcript-based indexer are removed (see `removeStaleTranscriptRows`).
   */
  async synchronize(_since?: Date): Promise<number> {
    const chatsRoot = path.join(this.cursorHome, 'chats');
    const indexedSessionIds = new Set<string>();
    let failed = false;

    for (const workspaceEntry of await listDirectoryEntriesSafe(chatsRoot)) {
      if (!workspaceEntry.isDirectory()) {
        continue;
      }

      const workspaceDir = path.join(chatsRoot, workspaceEntry.name);
      for (const chatEntry of await listDirectoryEntriesSafe(workspaceDir)) {
        if (!chatEntry.isDirectory()) {
          continue;
        }

        const chatDir = path.join(workspaceDir, chatEntry.name);
        try {
          const sessionId = await this.indexChatDirectory(chatDir);
          if (sessionId) {
            indexedSessionIds.add(path.basename(chatDir));
          }
        } catch (error) {
          failed = true;
          const message = error instanceof Error ? error.message : String(error);
          console.error('Failed to index Cursor chat', { chatDir, error: message });
        }
      }
    }

    if (!failed) {
      this.removeStaleTranscriptRows();
    }

    return indexedSessionIds.size;
  }

  /**
   * Deletes Cursor rows that still point at an `agent-transcripts` `.jsonl`.
   *
   * Older builds indexed those transcripts, which also include Cursor IDE
   * chats that CloudCLI can neither load nor resume. Every CLI chat this scan
   * found was repointed at its `store.db`, so a row still on a transcript is
   * one cursor-agent has no chat for. Rows already on a `store.db` are left to
   * the shared orphan pruning, so a chat indexed by the watcher mid-scan stays.
   */
  private removeStaleTranscriptRows(): void {
    for (const row of sessionsDb.getProviderSessionsWithTranscriptPath(this.provider)) {
      if (path.basename(row.jsonl_path) !== 'store.db') {
        sessionsDb.deleteSessionById(row.session_id);
      }
    }
  }

  /**
   * Re-indexes the chat a watched `meta.json` or newly created `store.db`
   * belongs to.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    const baseName = path.basename(filePath);
    if (baseName !== 'meta.json' && baseName !== 'store.db') {
      return null;
    }

    return this.indexChatDirectory(path.dirname(filePath));
  }

  /**
   * Upserts one chat directory; returns its session id, or null when skipped.
   */
  private async indexChatDirectory(chatDir: string): Promise<string | null> {
    const parsed = await this.parseChatDirectory(chatDir);
    if (!parsed) {
      return null;
    }

    const fallbackTimestamps = parsed.createdAt && parsed.updatedAt
      ? null
      : await readFileTimestamps(parsed.storeDbPath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      parsed.createdAt ?? fallbackTimestamps?.createdAt,
      parsed.updatedAt ?? fallbackTimestamps?.updatedAt,
      parsed.storeDbPath
    );
  }

  /**
   * Reads one chat directory, applying the same rules as cursor-agent's own
   * session list: a `store.db` must exist, subagent chats are skipped, and the
   * chat must have a conversation (cursor-agent sets that on the first message).
   */
  private async parseChatDirectory(chatDir: string): Promise<ParsedSession | null> {
    const storeDbPath = path.join(chatDir, 'store.db');
    if (!(await fileExists(storeDbPath))) {
      return null;
    }

    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(await fsp.readFile(path.join(chatDir, 'meta.json'), 'utf8'));
    } catch {
      return null;
    }

    if (!meta || typeof meta !== 'object' || meta.isSubagent === true || meta.hasConversation !== true) {
      return null;
    }

    const projectPath = typeof meta.cwd === 'string' && meta.cwd.length > 0 ? meta.cwd : null;
    if (!projectPath) {
      return null;
    }

    const sessionId = path.basename(chatDir);
    const title = typeof meta.title === 'string' && meta.title.trim() ? meta.title : undefined;

    return {
      sessionId,
      projectPath,
      sessionName: title
        ? normalizeSessionName(title, 'Untitled Cursor Session')
        : await this.readTranscriptSessionName(projectPath, sessionId),
      storeDbPath,
      createdAt: toIsoTimestamp(meta.createdAtMs),
      updatedAt: toIsoTimestamp(meta.updatedAtMs),
    };
  }

  /**
   * Names a chat after the first line the user typed, read from the transcript
   * cursor-agent writes for every CLI chat under `~/.cursor/projects`.
   */
  private async readTranscriptSessionName(projectPath: string, sessionId: string): Promise<string> {
    const transcriptPath = path.join(
      this.cursorHome,
      'projects',
      toCursorProjectSlug(projectPath),
      'agent-transcripts',
      sessionId,
      `${sessionId}.jsonl`
    );

    const firstLine = await extractFirstValidJsonlData(transcriptPath, (rawData) => {
      const data = rawData as Record<string, any>;
      if (data.role !== 'user') {
        return null;
      }

      const text = typeof data.message?.content?.[0]?.text === 'string' ? data.message.content[0].text : '';
      // Drop Cursor's `<timestamp>…</timestamp>` prefix and `<user_query>` tags
      // so the session name comes from the actual first line the user typed.
      return text
        .replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '')
        .replace(/<\/?user_query>/g, '')
        .trim()
        .split('\n')[0];
    });

    return normalizeSessionName(firstLine ?? undefined, 'Untitled Cursor Session');
  }
}
