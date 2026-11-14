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
 * Used by the providers registry to index Claude transcripts in every configured home.
 */
export class ClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'claude' as const;
  private readonly scannedHomes = new Set<string>();

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
   * Scans default and profile project roots and preserves their runtime profile.
   */
  async synchronize(since?: Date): Promise<number> {
    let processed = 0;
    const failures: unknown[] = [];
    for (const { claudeHome, profileId } of providerRuntimeProfilesService.listClaudeHomes()) {
      try {
        // A newly configured home can contain transcripts older than the global scan cursor.
        const homeSince = this.scannedHomes.has(claudeHome) ? since : undefined;
        const homeProcessed = await this.synchronizeHome(claudeHome, profileId, homeSince);
        if (homeProcessed === null) {
          // A missing projects root must get a full scan when it becomes available.
          this.scannedHomes.delete(claudeHome);
          continue;
        }
        processed += homeProcessed;
        // Failed discovery or transcript reads must leave this home eligible for a full retry.
        this.scannedHomes.add(claudeHome);
      } catch (error) {
        // One broken account must not hide readable conversations in another.
        this.scannedHomes.delete(claudeHome);
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'One or more Claude homes could not be synchronized.');
    return processed;
  }

  /** Returns null when the projects root is absent, so it stays eligible for a full scan. */
  private async synchronizeHome(claudeHome: string, profileId: string | null, since?: Date): Promise<number | null> {
    const readOptions: SessionArtifactReadOptions = {
      throwOnError: true,
      excludedDirectoryNames: ['subagents', 'tool-results'],
    };
    const nameMap = await buildLookupMap(path.join(claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const projectsRoot = path.join(claudeHome, 'projects');
    let files: string[];
    try {
      files = await findFilesRecursivelyCreatedAfter(projectsRoot, '.jsonl', since ?? null, [], readOptions);
    } catch (error) {
      // Only the initial root may be absent; a vanished entry makes the scan incomplete.
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT'
        && 'path' in error && error.path === projectsRoot) {
        return null;
      }
      throw error;
    }

    let processed = 0;
    for (const filePath of files) {
      if (this.isSubagentTranscript(filePath)) {
        continue;
      }

      const parsed = await this.processSessionFile(filePath, nameMap, readOptions);
      if (!parsed) {
        continue;
      }

      const timestamps = await readFileTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath,
        profileId,
      );
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

    const homes = providerRuntimeProfilesService.listClaudeHomes();
    const location = [...homes]
      .sort((left, right) => right.claudeHome.length - left.claudeHome.length)
      .find(({ claudeHome }) => {
        const relativePath = path.relative(path.join(claudeHome, 'projects'), filePath);
        return relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`)
          && !path.isAbsolute(relativePath);
      }) ?? homes[0];
    // Explicit file synchronization also supports paths outside watched roots.
    const nameMap = await buildLookupMap(path.join(location.claudeHome, 'history.jsonl'), 'sessionId', 'display');
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
      filePath,
      location.profileId,
    );
  }

  /**
   * Extracts session metadata from one Claude JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>,
    options: SessionArtifactReadOptions = {},
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
    }, options);

    if (!parsed) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Claude Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Claude Session'),
      };
    }

    let sessionName = await this.extractSessionTitle(filePath, parsed.sessionId);
    if (!sessionName) {
      sessionName = nameMap.get(parsed.sessionId);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Claude Session'),
    };
  }

  /**
   * Returns the best available title for one session from its transcript.
   *
   * Scans forward keeping the last match of each event type, then prefers
   * `custom-title` (a manual `/rename`) over `ai-title` over `last-prompt`.
   * Claude writes `custom-title` immediately before `ai-title`, so a reverse
   * scan that returns its first hit would always lose the manual rename.
   *
   * Returns undefined on a missing or unreadable file so sync can continue.
   */
  private async extractSessionTitle(
    filePath: string,
    sessionId: string
  ): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      let foundCustomTitle: string | undefined;
      let foundAiTitle: string | undefined;
      let foundLastPrompt: string | undefined;

      for (let index = 0; index < lines.length; index += 1) {
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
        const eventSessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;

        if (eventSessionId !== sessionId) {
          continue;
        }

        if (eventType === 'custom-title') {
          const title = typeof data.customTitle === 'string' ? data.customTitle : undefined;
          if (title?.trim()) {
            foundCustomTitle = title;
          }
        } else if (eventType === 'ai-title') {
          const title = typeof data.aiTitle === 'string' ? data.aiTitle : undefined;
          if (title?.trim()) {
            foundAiTitle = title;
          }
        } else if (eventType === 'last-prompt') {
          const prompt = typeof data.lastPrompt === 'string' ? data.lastPrompt : undefined;
          if (prompt?.trim()) {
            foundLastPrompt = prompt;
          }
        }
      }

      return foundCustomTitle || foundAiTitle || foundLastPrompt;
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }
}
