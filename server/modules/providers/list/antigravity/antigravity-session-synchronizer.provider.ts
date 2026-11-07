import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { sessionsDb } from '@/modules/database/index.js';
import { antigravityRunBindings } from '@/modules/providers/services/antigravity-run-bindings.service.js';
import type { IProviderSessionSynchronizer } from '@/shared/index.js';
import {
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
  readObjectRecord,
  readOptionalString,
  stripAntigravityTags,
} from '@/shared/index.js';

const PROVIDER = 'antigravity' as const;
const UNTITLED_ANTIGRAVITY_SESSION = 'Untitled Antigravity Session';

type ParsedAntigravitySession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/** Decodes file URLs, including percent escapes and Windows drive/UNC paths. */
function readWorkspacePath(value: unknown): string | undefined {
  const workspace = readOptionalString(value);
  if (!workspace?.startsWith('file://')) return workspace;
  try {
    const url = new URL(workspace);
    const windows = /^\/[a-zA-Z]:\//.test(url.pathname) || (url.hostname !== '' && url.hostname !== 'localhost');
    return fileURLToPath(url, { windows });
  } catch {
    return undefined;
  }
}

/** Providers registry and session watcher use this to index Antigravity transcript metadata. */
export class AntigravitySessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
  private readonly historyPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'history.jsonl');
  private readonly deferredFiles = new Set<string>();

  /** Scans changed AGY transcripts using one history snapshot per synchronization. */
  async synchronize(since?: Date): Promise<number> {
    const files = new Set([
      ...this.deferredFiles,
      ...await findFilesRecursivelyCreatedAfter(this.brainDir, 'transcript.jsonl', since ?? null),
    ]);
    const history = await this.readHistoryMetadata();
    let processed = 0;
    for (const filePath of files) {
      if (await this.synchronizeTranscript(filePath, history)) processed += 1;
    }
    return processed;
  }

  /** Synchronizes one provider transcript and returns the canonical app session id. */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (path.basename(filePath) !== 'transcript.jsonl') return null;
    return this.synchronizeTranscript(filePath, await this.readHistoryMetadata());
  }

  private async synchronizeTranscript(
    filePath: string,
    history: Map<string, { projectPath?: string; sessionName?: string }>,
  ): Promise<string | null> {
    if (path.basename(filePath) !== 'transcript.jsonl') return null;
    const parsed = await this.processTranscriptFile(filePath, history);
    if (!parsed) return null;
    const existing = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    if (!existing && antigravityRunBindings.hasPendingRun(parsed.projectPath)
      && sessionsDb.findLatestPendingAppSession(PROVIDER, parsed.projectPath)) {
      // The init event binds the exact app row. Guessing the newest pending
      // row can steal a concurrent terminal's conversation, so defer indexing
      // until that mapping arrives. Retry even if the next scan is incremental.
      this.deferredFiles.add(filePath);
      return null;
    }
    this.deferredFiles.delete(filePath);
    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId, PROVIDER, parsed.projectPath,
      existing?.custom_name && existing.custom_name !== UNTITLED_ANTIGRAVITY_SESSION
        ? existing.custom_name : parsed.sessionName,
      timestamps.createdAt, timestamps.updatedAt, filePath,
    );
  }

  private async processTranscriptFile(
    filePath: string,
    history: Map<string, { projectPath?: string; sessionName?: string }>,
  ): Promise<ParsedAntigravitySession | null> {
    const relative = path.relative(this.brainDir, filePath);
    const parts = relative.split(path.sep);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || parts.length < 2) return null;
    const sessionId = parts[0];
    const fromHistory = history.get(sessionId);
    let firstUserMessage = fromHistory?.sessionName;
    let projectPath = fromHistory?.projectPath;
    // A mapped app row knows the workspace before AGY appends history.jsonl.
    const existing = sessionsDb.getSessionByProviderSessionId(sessionId);
    projectPath ??= existing?.project_path ?? undefined;
    try {
      const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/);
      for (const line of lines) {
        try {
          const step = readObjectRecord(JSON.parse(line));
          if (step?.source === 'USER_EXPLICIT' && step.type === 'USER_INPUT') {
            const content = readOptionalString(step.content);
            if (content) firstUserMessage ??= stripAntigravityTags(content);
          }
          // VIEW_FILE/LIST_DIRECTORY paths describe tool targets, not the workspace.
          if (projectPath && firstUserMessage) break;
        } catch { /* Live transcripts may end in a partial record. */ }
      }
    } catch { return null; }
    if (!projectPath) return null;
    return {
      sessionId, projectPath,
      sessionName: normalizeSessionName(firstUserMessage, UNTITLED_ANTIGRAVITY_SESSION),
    };
  }

  private async readHistoryMetadata(): Promise<Map<string, { projectPath?: string; sessionName?: string }>> {
    const history = new Map<string, { projectPath?: string; sessionName?: string }>();
    let contents: string;
    try { contents = await readFile(this.historyPath, 'utf8'); }
    catch { return history; }
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = readObjectRecord(JSON.parse(line));
        const sessionId = readOptionalString(entry?.conversationId);
        if (!sessionId) continue;
        const previous = history.get(sessionId);
        history.set(sessionId, {
          projectPath: readWorkspacePath(entry?.workspace) ?? previous?.projectPath,
          sessionName: readOptionalString(entry?.display) ?? previous?.sessionName,
        });
      } catch { /* Skip malformed records without losing valid earlier entries. */ }
    }
    return history;
  }
}
