import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
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
 * Session indexer for Gemini transcript artifacts.
 */
export class GeminiSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'gemini' as const;
  private readonly geminiHome = path.join(os.homedir(), '.gemini');

  /**
   * Scans Gemini session JSON files and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const legacySessionFiles = await findFilesRecursivelyCreatedAfter(
      path.join(this.geminiHome, 'sessions'),
      '.json',
      since ?? null
    );
    const tempFiles = await findFilesRecursivelyCreatedAfter(
      path.join(this.geminiHome, 'tmp'),
      '.json',
      since ?? null
    );
    const files = [...legacySessionFiles, ...tempFiles];

    let processed = 0;
    for (const filePath of files) {
      if (
        filePath.startsWith(path.join(this.geminiHome, 'tmp'))
        && !filePath.includes(`${path.sep}chats${path.sep}`)
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
   * Parses and upserts one Gemini session JSON artifact.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.json')) {
      return null;
    }

    if (
      filePath.startsWith(path.join(this.geminiHome, 'tmp'))
      && !filePath.includes(`${path.sep}chats${path.sep}`)
    ) {
      return null;
    }

    const parsed = await this.processSessionFile(filePath);
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

      let projectPath = typeof data.projectPath === 'string' ? data.projectPath : '';

      if (!projectPath && filePath.includes(`${path.sep}chats${path.sep}`)) {
        const chatsDir = path.dirname(filePath);
        const workspaceDir = path.dirname(chatsDir);
        const projectRootPath = path.join(workspaceDir, '.project_root');

        try {
          const rootContent = await readFile(projectRootPath, 'utf8');
          projectPath = rootContent.trim();
        } catch {
          // Some Gemini artifacts do not ship a .project_root marker.
        }
      }

      if (!projectPath) {
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
        projectPath,
        sessionName: normalizeSessionName(rawName, 'New Gemini Chat'),
      };
    } catch {
      return null;
    }
  }
}
