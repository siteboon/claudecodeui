import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sessionsDb } from '@/modules/database/index.js';
import {
  extractFirstValidJsonlData,
  normalizeSessionName,
  readFileTimestamps,
  resolveCursorTranscriptPath,
  stripCursorContinuedChatTag,
  toCursorProjectSlug,
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

/** How long the IDE workspace list read from `workspaceStorage` is reused. */
const IDE_WORKSPACES_CACHE_MS = 30_000;

/**
 * Returns directory entries, an empty list when the folder is missing, or
 * `null` when it exists but can't be read, so callers can tell an incomplete
 * scan from an empty one.
 */
async function listDirectoryEntriesSafe(
  directoryPath: string
): Promise<import('node:fs').Dirent[] | null> {
  try {
    return await fsp.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? [] : null;
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
 * Converts a `meta.json` millisecond timestamp to ISO, ignoring invalid values.
 */
function toIsoTimestamp(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value).toISOString()
    : undefined;
}

/**
 * Returns the Cursor app's per-user data directory, which holds the IDE's
 * `workspaceStorage`. It follows VS Code's layout on each platform.
 */
function resolveCursorUserDirectory(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User');
  }

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Cursor', 'User');
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Cursor', 'User');
}

/**
 * Session indexer for Cursor chats.
 *
 * CLI (cursor-agent) chats live in `~/.cursor/chats/<md5(cwd)>/<id>/` as a
 * `meta.json` sidecar plus the `store.db` history CloudCLI reads and resumes.
 *
 * Cursor IDE chats have no CLI store, only the transcript every chat leaves at
 * `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`. They are
 * indexed read-only: cursor-agent cannot resume them, and resuming their id
 * would overwrite the transcript. The slug cannot be decoded back into a path,
 * so the IDE's own list of opened folders is encoded forwards and matched.
 */
export class CursorSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'cursor' as const;
  private readonly cursorHome = path.join(os.homedir(), '.cursor');
  private ideWorkspacesCache: { readAt: number; folderBySlug: Map<string, string | null> } | null = null;

  /**
   * Scans every Cursor CLI chat and IDE chat transcript and upserts them.
   *
   * `since` is ignored: there is one small `meta.json` per CLI chat, and chats
   * created before an upgrade (which older builds never indexed) must still
   * be found by the first scan afterwards.
   *
   * One unreadable chat is logged and skipped rather than ending the scan.
   * After a scan with no such failures, rows left by the older
   * transcript-based indexer are removed (see `removeStaleTranscriptRows`).
   */
  async synchronize(_since?: Date): Promise<number> {
    const chatsRoot = path.join(this.cursorHome, 'chats');
    // Every CLI chat id on disk, indexed or not: a transcript with one of
    // these ids belongs to the CLI chat and must never be listed as an IDE chat.
    const cliChatIds = new Set<string>();
    let processed = 0;
    let failed = false;

    const workspaceEntries = await listDirectoryEntriesSafe(chatsRoot);
    if (!workspaceEntries) {
      failed = true;
      console.error('Failed to read Cursor chats directory', { chatsRoot });
    }

    for (const workspaceEntry of workspaceEntries ?? []) {
      if (!workspaceEntry.isDirectory()) {
        continue;
      }

      const workspaceDir = path.join(chatsRoot, workspaceEntry.name);
      const chatEntries = await listDirectoryEntriesSafe(workspaceDir);
      if (!chatEntries) {
        failed = true;
        console.error('Failed to read Cursor chats directory', { workspaceDir });
        continue;
      }

      for (const chatEntry of chatEntries) {
        if (!chatEntry.isDirectory()) {
          continue;
        }

        cliChatIds.add(chatEntry.name);
        const chatDir = path.join(workspaceDir, chatEntry.name);
        try {
          if (await this.indexChatDirectory(chatDir)) {
            processed += 1;
          }
        } catch (error) {
          failed = true;
          const message = error instanceof Error ? error.message : String(error);
          console.error('Failed to index Cursor chat', { chatDir, error: message });
        }
      }
    }

    const folderBySlug = await this.readIdeWorkspaceFolders(true);
    for (const [slug, workspacePath] of folderBySlug) {
      if (!workspacePath) {
        continue;
      }

      const transcriptsDir = path.join(this.cursorHome, 'projects', slug, 'agent-transcripts');
      for (const transcriptEntry of (await listDirectoryEntriesSafe(transcriptsDir)) ?? []) {
        if (!transcriptEntry.isDirectory() || cliChatIds.has(transcriptEntry.name)) {
          continue;
        }

        const transcriptPath = path.join(transcriptsDir, transcriptEntry.name, `${transcriptEntry.name}.jsonl`);
        try {
          if (await this.indexIdeTranscript(transcriptEntry.name, workspacePath, transcriptPath)) {
            processed += 1;
          }
        } catch (error) {
          failed = true;
          const message = error instanceof Error ? error.message : String(error);
          console.error('Failed to index Cursor IDE chat', { transcriptPath, error: message });
        }
      }
    }

    if (!failed) {
      this.removeStaleTranscriptRows();
    }

    return processed;
  }

  /**
   * Deletes Cursor rows that point at a transcript but are not IDE chats.
   *
   * Older builds indexed every `agent-transcripts` file as a resumable chat.
   * This scan repointed each CLI chat at its `store.db` and flagged each IDE
   * chat it could place as read-only, so a writable row still on a transcript
   * is one neither kind accounts for, such as a chat whose folder Cursor
   * cannot place. Rows on a `store.db` are left to the shared orphan pruning,
   * so a chat indexed by the watcher mid-scan stays.
   */
  private removeStaleTranscriptRows(): void {
    for (const row of sessionsDb.getProviderSessionsWithTranscriptPath(this.provider)) {
      if (path.basename(row.jsonl_path) !== 'store.db' && !row.read_only) {
        sessionsDb.deleteSessionById(row.session_id);
      }
    }
  }

  /**
   * Re-indexes the chat a watched file belongs to: a CLI chat's `meta.json` or
   * newly created `store.db`, or an IDE chat's transcript.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    const baseName = path.basename(filePath);
    if (baseName === 'meta.json' || baseName === 'store.db') {
      return this.indexChatDirectory(path.dirname(filePath));
    }

    return this.synchronizeIdeTranscriptFile(filePath);
  }

  /**
   * Indexes one `projects/<slug>/agent-transcripts/<id>/<id>.jsonl` file as an
   * IDE chat, unless it belongs to a CLI chat or to no known IDE workspace.
   */
  private async synchronizeIdeTranscriptFile(filePath: string): Promise<string | null> {
    const relativePath = path.relative(path.join(this.cursorHome, 'projects'), filePath);
    const [slug, transcriptsDirName, sessionId, fileName, ...rest] = relativePath.split(path.sep);
    if (rest.length > 0 || transcriptsDirName !== 'agent-transcripts' || fileName !== `${sessionId}.jsonl`) {
      return null;
    }

    if (await this.hasCliChat(sessionId)) {
      return null;
    }

    let workspacePath = (await this.readIdeWorkspaceFolders(false)).get(slug);
    if (workspacePath === undefined) {
      // A folder opened since the cached read: look again once.
      workspacePath = (await this.readIdeWorkspaceFolders(true)).get(slug);
    }

    return workspacePath ? this.indexIdeTranscript(sessionId, workspacePath, filePath) : null;
  }

  /**
   * Returns whether cursor-agent has a chat directory with this id in any
   * workspace.
   */
  private async hasCliChat(sessionId: string): Promise<boolean> {
    const chatsRoot = path.join(this.cursorHome, 'chats');
    for (const workspaceEntry of (await listDirectoryEntriesSafe(chatsRoot)) ?? []) {
      if (!workspaceEntry.isDirectory()) {
        continue;
      }

      try {
        if ((await fsp.stat(path.join(chatsRoot, workspaceEntry.name, sessionId))).isDirectory()) {
          return true;
        }
      } catch {
        // Not in this workspace.
      }
    }

    return false;
  }

  /**
   * Maps each `~/.cursor/projects` slug to the IDE workspace folder it was
   * named after, from the IDE's `workspaceStorage/<id>/workspace.json` files.
   *
   * A slug two different folders encode to maps to `null`, since its chats
   * cannot be placed. Multi-root (`.code-workspace`) and remote windows are
   * left out: they have no single local folder to list the chats under.
   */
  private async readIdeWorkspaceFolders(refresh: boolean): Promise<Map<string, string | null>> {
    if (!refresh && this.ideWorkspacesCache && Date.now() - this.ideWorkspacesCache.readAt < IDE_WORKSPACES_CACHE_MS) {
      return this.ideWorkspacesCache.folderBySlug;
    }

    const storageDir = path.join(resolveCursorUserDirectory(), 'workspaceStorage');
    const folderBySlug = new Map<string, string | null>();
    for (const entry of (await listDirectoryEntriesSafe(storageDir)) ?? []) {
      if (!entry.isDirectory()) {
        continue;
      }

      let folderPath: string;
      try {
        const workspace = JSON.parse(await fsp.readFile(path.join(storageDir, entry.name, 'workspace.json'), 'utf8'));
        if (typeof workspace?.folder !== 'string' || !workspace.folder.startsWith('file:')) {
          continue;
        }
        folderPath = fileURLToPath(workspace.folder);
      } catch {
        continue;
      }

      const slug = toCursorProjectSlug(folderPath);
      const known = folderBySlug.get(slug);
      folderBySlug.set(slug, known === undefined || known === folderPath ? folderPath : null);
    }

    this.ideWorkspacesCache = { readAt: Date.now(), folderBySlug };
    return folderBySlug;
  }

  /**
   * Upserts one IDE chat as a read-only session; returns its id, or null when
   * the transcript is missing or empty.
   */
  private async indexIdeTranscript(
    sessionId: string,
    workspacePath: string,
    transcriptPath: string
  ): Promise<string | null> {
    if (!(await fileExists(transcriptPath)) || (await fsp.stat(transcriptPath)).size === 0) {
      return null;
    }

    const timestamps = await readFileTimestamps(transcriptPath);
    return sessionsDb.createSession(
      sessionId,
      this.provider,
      workspacePath,
      await this.readTranscriptSessionName(transcriptPath),
      timestamps?.createdAt,
      timestamps?.updatedAt,
      transcriptPath,
      { readOnly: true }
    );
  }

  /**
   * Upserts one CLI chat directory; returns its session id, or null when skipped.
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
        : await this.readTranscriptSessionName(resolveCursorTranscriptPath(projectPath, sessionId)),
      storeDbPath,
      createdAt: toIsoTimestamp(meta.createdAtMs),
      updatedAt: toIsoTimestamp(meta.updatedAtMs),
    };
  }

  /**
   * Names a chat after the first line the user typed, read from the transcript
   * Cursor writes for every chat under `~/.cursor/projects`.
   */
  private async readTranscriptSessionName(transcriptPath: string): Promise<string> {
    const firstLine = await extractFirstValidJsonlData(transcriptPath, (rawData) => {
      const data = rawData as Record<string, any>;
      if (data.role !== 'user') {
        return null;
      }

      const text = typeof data.message?.content?.[0]?.text === 'string' ? data.message.content[0].text : '';
      // What the user typed is inside `<user_query>`; Cursor puts context such
      // as `<timestamp>`, `<external_links>` or attached files around it.
      const userQuery = /<user_query>([\s\S]*?)<\/user_query>/.exec(text)?.[1];
      return stripCursorContinuedChatTag(userQuery ?? text.replace(/<timestamp>[\s\S]*?<\/timestamp>/g, ''))
        .trim()
        .split('\n')[0];
    });

    return normalizeSessionName(firstLine ?? undefined, 'Untitled Cursor Session');
  }
}
