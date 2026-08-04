import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import readline from 'node:readline';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type {
  IProviderSessionSynchronizer,
  SessionSynchronizeOptions,
} from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/**
 * Session indexer for Codex transcript artifacts.
 */
export class CodexSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'codex' as const;
  private readonly codexHome = path.join(os.homedir(), '.codex');
  private indexedNameCache: { mtimeMs: number; names: Map<string, string> } | null = null;
  private synchronizationQueue: Promise<void> = Promise.resolve();

  /**
   * Scans ~/.codex/sessions and upserts discovered sessions into DB.
   */
  async synchronize(
    since?: Date,
    options: SessionSynchronizeOptions = {},
  ): Promise<number> {
    return this.enqueueSynchronization(() => this.synchronizeInternal(since, options));
  }

  private async synchronizeInternal(
    since?: Date,
    options: SessionSynchronizeOptions = {},
  ): Promise<number> {
    const nameMap = options.initializing
      ? await this.buildSessionNameMap()
      : await this.readIndexedNameMap();
    this.updateProviderSessionNames(nameMap);
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(this.codexHome, 'sessions'),
      '.jsonl',
      since ?? null
    );

    let processed = 0;
    for (const filePath of files) {
      const parsed = await this.processSessionFile(filePath, nameMap);
      if (!parsed) {
        continue;
      }

      const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
        ?? sessionsDb.getSessionById(parsed.sessionId);
      if (existingSession) {
        // If session name is untitled and we now have a name, update it
        if (existingSession.custom_name === 'Untitled Codex Session' && parsed.sessionName && parsed.sessionName !== 'Untitled Codex Session') {
          sessionsDb.updateSessionProviderName(existingSession.session_id, parsed.sessionName);
        }
      }

      const timestamps = await readFileTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Parses and upserts one Codex session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    return this.enqueueSynchronization(() => this.synchronizeFileInternal(filePath));
  }

  private async synchronizeFileInternal(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    const nameMap = await this.readIndexedNameMap();
    const parsed = await this.processSessionFile(filePath, nameMap);
    if (!parsed) {
      return null;
    }

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath
    );
  }

  private enqueueSynchronization<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.synchronizationQueue;
    let release!: () => void;
    this.synchronizationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    return previous.then(operation).finally(release);
  }

  private async buildSessionNameMap(): Promise<Map<string, string>> {
    const nameMap = await this.readStateTitleMap();
    const indexedNames = await this.readIndexedNameMap();
    for (const [sessionId, name] of indexedNames) {
      if (name.trim()) {
        nameMap.set(sessionId, name);
      }
    }
    return nameMap;
  }

  private async readIndexedNameMap(): Promise<Map<string, string>> {
    const indexPath = path.join(this.codexHome, 'session_index.jsonl');
    const mtimeMs = await this.readIndexedNameMtime();
    if (mtimeMs === null) {
      return new Map();
    }

    if (this.indexedNameCache?.mtimeMs === mtimeMs) {
      return this.indexedNameCache.names;
    }

    const names = await this.loadIndexedNameMap(indexPath);
    this.indexedNameCache = { mtimeMs, names };
    return names;
  }

  private async readIndexedNameMtime(): Promise<number | null> {
    try {
      return (await stat(path.join(this.codexHome, 'session_index.jsonl'))).mtimeMs;
    } catch {
      return null;
    }
  }

  private async loadIndexedNameMap(indexPath: string): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    try {
      const lines = readline.createInterface({
        input: createReadStream(indexPath),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (typeof entry.id === 'string' && typeof entry.thread_name === 'string') {
            names.set(entry.id, entry.thread_name);
          }
        } catch {
          // A malformed entry must not hide newer names later in the append-only index.
        }
      }
    } catch {
      // The index is optional; state titles and transcript fallbacks remain available.
    }
    return names;
  }

  private updateProviderSessionNames(nameMap: Map<string, string>): void {
    const sessions = sessionsDb.getSessionsByProvider(this.provider);
    const sessionsByLookupId = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      if (session.provider_session_id) {
        sessionsByLookupId.set(session.provider_session_id, session);
      }
    }
    for (const session of sessions) {
      if (!sessionsByLookupId.has(session.session_id)) {
        sessionsByLookupId.set(session.session_id, session);
      }
    }

    for (const [providerSessionId, name] of nameMap) {
      const existingSession = sessionsByLookupId.get(providerSessionId);
      if (!existingSession) {
        continue;
      }

      const normalizedName = normalizeSessionName(name, 'Untitled Codex Session');
      if (normalizedName !== existingSession.custom_name) {
        sessionsDb.updateSessionProviderName(existingSession.session_id, normalizedName);
      }
    }
  }

  private async readStateTitleMap(): Promise<Map<string, string>> {
    try {
      const stateFile = (await readdir(this.codexHome))
        .map((fileName) => ({ fileName, match: /^state_(\d+)\.sqlite$/.exec(fileName) }))
        .filter((entry): entry is { fileName: string; match: RegExpExecArray } => entry.match !== null)
        .sort((a, b) => Number(b.match[1]) - Number(a.match[1]))[0]?.fileName;
      if (!stateFile) {
        return new Map();
      }

      const db = new Database(path.join(this.codexHome, stateFile), {
        readonly: true,
        fileMustExist: true,
      });
      try {
        const rows = db.prepare('SELECT id, title FROM threads WHERE trim(title) <> \'\'')
          .all() as Array<{ id: string; title: string }>;
        return new Map(rows.map((row) => [row.id, row.title]));
      } finally {
        db.close();
      }
    } catch {
      return new Map();
    }
  }

  /**
   * Extracts session metadata from one Codex JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const payload = data.payload as Record<string, unknown> | undefined;
      const sessionId = typeof payload?.id === 'string' ? payload.id : undefined;
      const projectPath = typeof payload?.cwd === 'string' ? payload.cwd : undefined;

      if (!sessionId || !projectPath) {
        return null;
      }

      return {
        sessionId,
        projectPath,
        isSubagent: payload ? this.isSubagentSessionMeta(payload) : false,
      };
    });

    if (!parsed || parsed.isSubagent) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    if (existingSession?.custom_name_source === 'manual' && existingSession.custom_name?.trim()) {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSession.custom_name, 'Untitled Codex Session'),
      };
    }

    const indexedSessionName = nameMap.get(parsed.sessionId);
    if (indexedSessionName?.trim()) {
      return {
        ...parsed,
        sessionName: normalizeSessionName(indexedSessionName, 'Untitled Codex Session'),
      };
    }

    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Codex Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Codex Session'),
      };
    }

    // Sessions started by sending a message from cloudcli carry a distinct
    // app-allocated session_id mapped to the provider id. When Codex has not
    // assigned a thread name yet, use the first user message as the fallback.
    const isAppCreated =
      existingSession != null &&
      existingSession.provider_session_id != null &&
      existingSession.session_id !== existingSession.provider_session_id;

    let sessionName = isAppCreated
      ? await this.extractFirstUserMessageFromStart(filePath)
      : undefined;
    if (!sessionName) {
      sessionName = await this.extractLastAgentMessageFromEnd(filePath);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Codex Session'),
    };
  }

  /**
   * Returns true when a session_meta payload belongs to a Codex sub-agent
   * thread (Codex >=0.144 collaboration spawn_agent, review, compact, etc.).
   * Sub-agent rollouts live in the same sessions tree as user sessions, so
   * they must be skipped here to stay out of the sidebar — the Codex
   * equivalent of the Claude synchronizer's subagent transcript skip.
   * Top-level sessions carry thread_source "user" and a string source
   * ("exec"/"cli"); sub-agents carry thread_source "subagent" and an object
   * source keyed by "subagent".
   */
  private isSubagentSessionMeta(payload: Record<string, unknown>): boolean {
    if (payload.thread_source === 'subagent') {
      return true;
    }

    const source = payload.source;
    return typeof source === 'object' && source !== null && 'subagent' in source;
  }

  /**
   * Returns the first user message text in a Codex transcript, used to title
   * app-created sessions from the prompt the user sent from cloudcli.
   *
   * Reads the `event_msg`/`user_message` payload rather than the raw
   * `response_item` user turn so injected `<environment_context>` boilerplate is
   * never mistaken for the user's prompt.
   */
  private async extractFirstUserMessageFromStart(filePath: string): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const data = parsed as Record<string, unknown>;
        const eventType = typeof data.type === 'string' ? data.type : undefined;
        const payload = data.payload as Record<string, unknown> | undefined;
        const payloadType = typeof payload?.type === 'string' ? payload.type : undefined;
        const message = typeof payload?.message === 'string' ? payload.message : undefined;

        if (eventType === 'event_msg' && payloadType === 'user_message' && message?.trim()) {
          return message;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }

  private async extractLastAgentMessageFromEnd(filePath: string): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim();
        if (!line) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const data = parsed as Record<string, unknown>;
        const eventType = typeof data.type === 'string' ? data.type : undefined;
        const payload = data.payload as Record<string, unknown> | undefined;
        const payloadType = typeof payload?.type === 'string' ? payload.type : undefined;
        const lastAgentMessage = typeof payload?.last_agent_message === 'string'
          ? payload.last_agent_message
          : undefined;

        if (eventType === 'event_msg' && payloadType === 'task_complete' && lastAgentMessage?.trim()) {
          return lastAgentMessage;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }
}
