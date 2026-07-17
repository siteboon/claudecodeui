import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import {
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

const PROVIDER = 'antigravity' as const;
const UNTITLED_ANTIGRAVITY_SESSION = 'Untitled Antigravity Session';

type ParsedAntigravitySession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

function isAntigravityTranscript(filePath: string): boolean {
  return path.basename(filePath) === 'transcript.jsonl';
}

function getSessionIdFromTranscriptPath(filePath: string): string | null {
  const parts = filePath.split(path.sep);
  const brainIndex = parts.lastIndexOf('brain');
  const sessionId = brainIndex >= 0 ? parts[brainIndex + 1] : null;
  return sessionId?.trim() || null;
}

function stripAntigravityTags(content: string): string {
  return content
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
    .replace(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/g, '$1')
    .trim();
}

function extractAntigravityStepContent(rawLine: string): { projectPath?: string; firstUserMessage?: string } | null {
  try {
    const parsed = readObjectRecord(JSON.parse(rawLine));
    if (!parsed) {
      return null;
    }

    const source = readOptionalString(parsed.source);
    const type = readOptionalString(parsed.type);
    const content = readOptionalString(parsed.content);

    if (type === 'LIST_DIRECTORY' || type === 'VIEW_FILE') {
      const match = content?.match(/File Path: `file:\/\/([^`]+)`/);
      if (match?.[1]) {
        const projectPath = type === 'VIEW_FILE' ? path.dirname(match[1]) : match[1];
        return { projectPath };
      }
    }

    if (source !== 'USER_EXPLICIT' || type !== 'USER_INPUT' || !content) {
      return null;
    }

    return { firstUserMessage: stripAntigravityTags(content) };
  } catch {
    return null;
  }
}

export class AntigravitySessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
  private readonly historyPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'history.jsonl');

  async synchronize(since?: Date): Promise<number> {
    const files = await findFilesRecursivelyCreatedAfter(this.brainDir, 'transcript.jsonl', since ?? null);

    let processed = 0;
    for (const filePath of files) {
      if (!isAntigravityTranscript(filePath)) {
        continue;
      }

      const sessionId = await this.synchronizeFile(filePath);
      if (sessionId) {
        processed += 1;
      }
    }

    return processed;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!isAntigravityTranscript(filePath)) {
      return null;
    }

    const parsed = await this.processTranscriptFile(filePath);
    if (!parsed) {
      return null;
    }

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      PROVIDER,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
    );
  }

  private async processTranscriptFile(filePath: string): Promise<ParsedAntigravitySession | null> {
    const sessionId = getSessionIdFromTranscriptPath(filePath);
    if (!sessionId) {
      return null;
    }

    const fromHistory = await this.readHistoryMetadata(sessionId);
    let firstUserMessage = fromHistory?.sessionName;
    let projectPath = fromHistory?.projectPath;

    try {
      const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/);
      for (const line of lines) {
        const extracted = extractAntigravityStepContent(line);
        if (!extracted) {
          continue;
        }

        projectPath ??= extracted.projectPath;
        firstUserMessage ??= extracted.firstUserMessage;

        if (projectPath && firstUserMessage) {
          break;
        }
      }
    } catch {
      return null;
    }

    if (!projectPath) {
      return null;
    }

    return {
      sessionId,
      projectPath,
      sessionName: normalizeSessionName(firstUserMessage, UNTITLED_ANTIGRAVITY_SESSION),
    };
  }

  private async readHistoryMetadata(
    sessionId: string,
  ): Promise<{ projectPath?: string; sessionName?: string } | null> {
    try {
      const lines = (await readFile(this.historyPath, 'utf8')).split(/\r?\n/);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim();
        if (!line) {
          continue;
        }

        const entry = readObjectRecord(JSON.parse(line));
        if (readOptionalString(entry?.conversationId) !== sessionId) {
          continue;
        }

        return {
          projectPath: readOptionalString(entry?.workspace),
          sessionName: readOptionalString(entry?.display),
        };
      }
    } catch {
      return null;
    }

    return null;
  }
}
