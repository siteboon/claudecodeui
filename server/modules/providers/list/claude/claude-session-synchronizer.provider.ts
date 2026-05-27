import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
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
};

/**
 * Session indexer for Claude transcript artifacts.
 */
export class ClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'claude' as const;
  private readonly claudeHome = path.join(os.homedir(), '.claude');

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
      const parsed = await this.processSessionFile(filePath, nameMap);
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
        filePath
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

    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
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

  /**
   * Extracts session metadata from one Claude JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    // Skip sub-agent sidechain files (agent-*.jsonl) — these are internal Claude sub-agent
    // transcripts, not standalone user sessions.
    if (path.basename(filePath).startsWith('agent-')) {
      return null;
    }

    // Detect TaskMaster / direct-CLI internal sessions.
    // User-initiated sessions have an enqueue event before dequeue (the UI enqueues the task).
    // TaskMaster/tool-invoked sessions jump straight to dequeue — no enqueue ever appears.
    // Any session whose ONLY queue-operations are dequeue (no prior enqueue) is internal.
    let hasEnqueue = false;
    let isInternalSession = false;

    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;

      if (data.type === 'queue-operation') {
        const operation = typeof data.operation === 'string' ? data.operation : '';
        if (operation === 'enqueue') {
          hasEnqueue = true;
        } else if (operation === 'dequeue' && !hasEnqueue) {
          // dequeue without a prior enqueue = TaskMaster / direct CLI invocation
          isInternalSession = true;
        }
        return null;
      }

      if (isInternalSession) {
        return null;
      }

      // Skip sidechain entries inside the file (extra safeguard for agent files not caught above).
      if (data.isSidechain === true) {
        return null;
      }

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

    if (!parsed || isInternalSession) {
      return null;
    }

    const existingSession = sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;

    // Always scan the file end for a title event. If the most recent title event
    // is a custom-title (written by CLI /rename or WebUI rename) and it differs
    // from the DB name, honour it so that a CLI /rename propagates to the WebUI.
    const titleResult = await this.extractSessionAiTitleFromEnd(filePath, parsed.sessionId);

    if (existingSessionName && existingSessionName !== 'Untitled Claude Session') {
      const cliRename = titleResult?.isCustomTitle && titleResult.title !== existingSessionName
        ? titleResult.title
        : null;

      return {
        ...parsed,
        sessionName: normalizeSessionName(cliRename ?? existingSessionName, 'Untitled Claude Session'),
      };
    }

    let sessionName = nameMap.get(parsed.sessionId) ?? titleResult?.title;
    if (!sessionName) {
      sessionName = await this.extractFirstUserMessageFromStart(filePath);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Claude Session'),
    };
  }

  /**
   * Extracts the first user message text from the start of a JSONL file as a name fallback.
   */
  private async extractFirstUserMessageFromStart(filePath: string): Promise<string | undefined> {
    const result = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;

      if (data.type !== 'user' || data.isSidechain === true) {
        return null;
      }

      const message = data.message as Record<string, unknown> | undefined;
      const content = message?.content;

      if (Array.isArray(content)) {
        for (const c of content as unknown[]) {
          const item = c as Record<string, unknown>;
          if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
            return item.text.trim().slice(0, 80);
          }
        }
      } else if (typeof content === 'string' && content.trim()) {
        return content.trim().slice(0, 80);
      }

      return null;
    });

    return result ?? undefined;
  }

  private async extractSessionAiTitleFromEnd(
    filePath: string,
    sessionId: string
  ): Promise<{ title: string; isCustomTitle: boolean } | undefined> {
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
        const eventSessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
        const aiTitle = typeof data.aiTitle === 'string' ? data.aiTitle : undefined;
        const lastPrompt = typeof data.lastPrompt === 'string' ? data.lastPrompt : undefined;
        const claudeRenamedTitle = typeof data.customTitle === 'string' ? data.customTitle : undefined;

        if (eventType === 'custom-title' && eventSessionId === sessionId && claudeRenamedTitle?.trim()) {
          return { title: claudeRenamedTitle, isCustomTitle: true };
        }
        if (
          (eventType === 'ai-title' && eventSessionId === sessionId && aiTitle?.trim()) ||
          (eventType === 'last-prompt' && eventSessionId === sessionId && lastPrompt?.trim())
        ) {
          return { title: (aiTitle || lastPrompt) as string, isCustomTitle: false };
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }
}
