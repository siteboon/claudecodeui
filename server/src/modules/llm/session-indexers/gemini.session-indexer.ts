import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import {
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/modules/llm/session-indexers/session-indexer.utils.js';
import type { ISessionIndexer } from '@/modules/llm/session-indexers/session-indexer.interface.js';

type ParsedSession = {
  sessionId: string;
  workspacePath: string;
  sessionName?: string;
};

/**
 * Session indexer for Gemini transcript artifacts.
 */
export class GeminiSessionIndexer implements ISessionIndexer {
  readonly provider = 'gemini' as const;

  /**
   * Scans Gemini session JSON files and upserts discovered sessions into DB.
   */
  async synchronize(lastScanAt: Date | null): Promise<number> {
    const geminiHome = path.join(os.homedir(), '.gemini');
    const legacySessionFiles = await findFilesRecursivelyCreatedAfter(
      path.join(geminiHome, 'sessions'),
      '.json',
      lastScanAt,
    );
    const tempFiles = await findFilesRecursivelyCreatedAfter(
      path.join(geminiHome, 'tmp'),
      '.json',
      lastScanAt,
    );
    const files = [...legacySessionFiles, ...tempFiles];

    let processed = 0;
    for (const filePath of files) {
      if (
        filePath.startsWith(path.join(geminiHome, 'tmp')) &&
        !filePath.includes(`${path.sep}chats${path.sep}`)
      ) {
        continue;
      }

      const parsed = await this.processSessionFile(filePath);
      if (!parsed) {
        continue;
      }

      const timestamps = await readFileTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.workspacePath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath,
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Extracts session metadata from one Gemini JSON artifact.
   */
  private async processSessionFile(filePath: string): Promise<ParsedSession | null> {
    try {
      const content = await readFile(filePath, 'utf8');
      const data = JSON.parse(content) as Record<string, any>;

      const sessionId =
        typeof data.sessionId === 'string'
          ? data.sessionId
          : typeof data.id === 'string'
            ? data.id
            : undefined;
      if (!sessionId) {
        return null;
      }

      let workspacePath = typeof data.projectPath === 'string' ? data.projectPath : '';

      if (!workspacePath && filePath.includes(`${path.sep}chats${path.sep}`)) {
        const chatsDir = path.dirname(filePath);
        const workspaceDir = path.dirname(chatsDir);
        const projectRootPath = path.join(workspaceDir, '.project_root');

        try {
          const rootContent = await readFile(projectRootPath, 'utf8');
          workspacePath = rootContent.trim();
        } catch {
          // Some Gemini artifacts do not ship a .project_root marker.
        }
      }

      if (!workspacePath) {
        return null;
      }

      const messages = Array.isArray(data.messages) ? data.messages : [];
      const firstMessage = messages[0] as Record<string, any> | undefined;
      let rawName: string | undefined;

      if (Array.isArray(firstMessage?.content) && typeof firstMessage.content[0]?.text === 'string') {
        rawName = firstMessage.content[0].text;
      } else if (typeof firstMessage?.content === 'string') {
        rawName = firstMessage.content;
      }

      return {
        sessionId,
        workspacePath,
        sessionName: normalizeSessionName(rawName, 'New Gemini Chat'),
      };
    } catch {
      return null;
    }
  }
}
