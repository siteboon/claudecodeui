import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import { providerRuntimeProfilesService } from '@/modules/providers/services/provider-runtime-profiles.service.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { SessionArtifactReadOptions } from '@/shared/types.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/**
 * Used by the providers registry to index Codex transcripts in every configured home.
 */
export class CodexSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'codex' as const;
  private readonly scannedHomes = new Set<string>();

  /**
   * Scans default and profile session roots and preserves their runtime profile.
   */
  async synchronize(since?: Date): Promise<number> {
    let processed = 0;
    const failures: unknown[] = [];
    for (const { codexHome, profileId } of providerRuntimeProfilesService.listCodexHomes()) {
      try {
        // A newly configured profile can contain transcripts older than the global scan cursor.
        const homeSince = this.scannedHomes.has(codexHome) ? since : undefined;
        const homeProcessed = await this.synchronizeHome(codexHome, profileId, homeSince);
        if (homeProcessed === null) {
          this.scannedHomes.delete(codexHome);
          continue;
        }
        processed += homeProcessed;
        this.scannedHomes.add(codexHome);
      } catch (error) {
        this.scannedHomes.delete(codexHome);
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'One or more Codex homes could not be synchronized.');
    return processed;
  }

  /** Missing roots remain eligible for a full scan when the CLI first creates them. */
  private async synchronizeHome(codexHome: string, profileId: string | null, since?: Date): Promise<number | null> {
    const nameMap = await buildLookupMap(path.join(codexHome, 'session_index.jsonl'), 'id', 'thread_name');
    // A parent home can contain another configured account's transcript tree.
    const otherRoots = providerRuntimeProfilesService.listCodexHomes()
      .filter((home) => {
        const relativePath = path.relative(codexHome, home.codexHome);
        return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`)
          && !path.isAbsolute(relativePath);
      })
      .map((home) => path.join(home.codexHome, 'sessions'));
    const sessionsRoot = path.join(codexHome, 'sessions');
    const failures: unknown[] = [];
    let rootMissing = false;
    const readOptions: SessionArtifactReadOptions = {
      throwOnError: true, excludedDirectoryPaths: otherRoots,
      onDiscoveryError: (error) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT'
          && 'path' in error && error.path === sessionsRoot) rootMissing = true;
        else failures.push(error);
      },
    };
    let files: string[];
    try {
      files = await findFilesRecursivelyCreatedAfter(sessionsRoot, '.jsonl', since ?? null, [], readOptions);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT'
        && 'path' in error && error.path === sessionsRoot) return null;
      throw error;
    }

    if (rootMissing) return null;
    let processed = 0;
    for (const filePath of files) {
      if (otherRoots.some((root) => {
        const relativePath = path.relative(root, filePath);
        return relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`)
          && !path.isAbsolute(relativePath);
      })) continue;
      try {
        const parsed = await this.processSessionFile(filePath, nameMap, readOptions);
        if (!parsed) {
          continue;
        }

        const existingRow = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
          ?? sessionsDb.getSessionById(parsed.sessionId);
        const transcriptProfileId = providerRuntimeProfilesService.resolveTranscriptProfileId(
          'codex', profileId,
          existingRow && existingRow.session_id !== parsed.sessionId
            ? existingRow.runtime_profile_id ?? null : undefined,
        );
        const timestamps = await readFileTimestamps(filePath);
        sessionsDb.createSession(
          parsed.sessionId,
          this.provider,
          parsed.projectPath,
          parsed.sessionName,
          timestamps.createdAt,
          timestamps.updatedAt,
          filePath,
          transcriptProfileId,
        );
        processed += 1;
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length) throw new AggregateError(failures, 'One or more Codex transcripts could not be synchronized.');
    return processed;
  }

  /**
   * Parses and upserts one Codex session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    const location = providerRuntimeProfilesService.listCodexHomes()
      .sort((left, right) => right.codexHome.length - left.codexHome.length)
      .find(({ codexHome }) => {
        const relativePath = path.relative(path.join(codexHome, 'sessions'), filePath);
        return relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`)
          && !path.isAbsolute(relativePath);
      });
    if (!location) {
      return null;
    }
    const nameMap = await buildLookupMap(path.join(location.codexHome, 'session_index.jsonl'), 'id', 'thread_name');
    const parsed = await this.processSessionFile(filePath, nameMap);
    if (!parsed) {
      return null;
    }

    const existingRow = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const transcriptProfileId = providerRuntimeProfilesService.resolveTranscriptProfileId(
      'codex', location.profileId,
      existingRow && existingRow.session_id !== parsed.sessionId
        ? existingRow.runtime_profile_id ?? null : undefined,
    );
    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
      transcriptProfileId,
    );
  }

  /**
   * Extracts session metadata from one Codex JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>,
    readOptions: SessionArtifactReadOptions = {},
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
    }, readOptions);

    if (!parsed || parsed.isSubagent) {
      return null;
    }

    // A thread a session was edited off is left on disk on purpose, but it is
    // nobody's conversation any more. Re-indexing it would add a sidebar entry
    // for the version the user edited away from — and for a session that was
    // itself discovered from disk, whose app id is its original thread id, it
    // would hand the row back to that thread.
    if (sessionsDb.isProviderSessionSuperseded(parsed.sessionId, this.provider)) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Codex Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Codex Session'),
      };
    }

    let sessionName = nameMap.get(parsed.sessionId);
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
