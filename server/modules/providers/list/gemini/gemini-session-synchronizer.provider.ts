import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import {
  findFilesRecursivelyCreatedAfter,
  normalizeProjectPath,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

type GeminiJsonlMetadata = {
  sessionId: string;
  projectPath?: string;
  projectHash?: string;
  firstUserMessage?: string;
};

/**
 * Session indexer for Gemini transcript artifacts.
 */
export class GeminiSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'gemini' as const;
  private readonly geminiHome = path.join(os.homedir(), '.gemini');

  /**
   * Scans Gemini legacy JSON and new JSONL artifacts and upserts sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const projectHashLookup = this.buildProjectHashLookup();

    const legacySessionFiles = await findFilesRecursivelyCreatedAfter(
      path.join(this.geminiHome, 'sessions'),
      '.json',
      since ?? null
    );
    const legacyTempFiles = await findFilesRecursivelyCreatedAfter(
      path.join(this.geminiHome, 'tmp'),
      '.json',
      since ?? null
    );
    const jsonlSessionFiles = await findFilesRecursivelyCreatedAfter(
      path.join(this.geminiHome, 'sessions'),
      '.jsonl',
      since ?? null
    );
    const jsonlTempFiles = await findFilesRecursivelyCreatedAfter(
      path.join(this.geminiHome, 'tmp'),
      '.jsonl',
      since ?? null
    );

    // Process legacy JSON first, then JSONL. If both exist for a session id,
    // the JSONL artifact becomes the canonical jsonl_path via upsert.
    const files = [
      ...legacySessionFiles,
      ...legacyTempFiles,
      ...jsonlSessionFiles,
      ...jsonlTempFiles,
    ];

    let processed = 0;
    for (const filePath of files) {
      if (this.shouldSkipTempArtifact(filePath)) {
        continue;
      }

      const parsed = filePath.endsWith('.jsonl')
        ? await this.processJsonlSessionFile(filePath, projectHashLookup)
        : await this.processLegacySessionFile(filePath);
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
   * Parses and upserts one Gemini legacy JSON or JSONL artifact.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.json') && !filePath.endsWith('.jsonl')) {
      return null;
    }

    if (this.shouldSkipTempArtifact(filePath)) {
      return null;
    }

    const parsed = filePath.endsWith('.jsonl')
      ? await this.processJsonlSessionFile(filePath, this.buildProjectHashLookup())
      : await this.processLegacySessionFile(filePath);
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
   * Extracts session metadata from one Gemini legacy JSON artifact.
   */
  private async processLegacySessionFile(filePath: string): Promise<ParsedSession | null> {
    try {
      const content = await readFile(filePath, 'utf8');
      const data = JSON.parse(content) as AnyRecord;

      const sessionId =
        typeof data.sessionId === 'string'
          ? data.sessionId
          : typeof data.id === 'string'
            ? data.id
            : undefined;
      if (!sessionId) {
        return null;
      }

      const workspaceProjectPath = await this.resolveProjectPathFromChatWorkspace(filePath);
      const projectPath = typeof data.projectPath === 'string' && data.projectPath.trim().length > 0
        ? data.projectPath
        : workspaceProjectPath;
      if (!projectPath) {
        return null;
      }

      const messages = Array.isArray(data.messages) ? data.messages : [];
      const firstMessage = messages[0] as AnyRecord | undefined;
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

  /**
   * Extracts session metadata from one Gemini JSONL artifact.
   */
  private async processJsonlSessionFile(
    filePath: string,
    projectHashLookup: Map<string, string>
  ): Promise<ParsedSession | null> {
    const metadata = await this.extractJsonlMetadata(filePath);
    if (!metadata) {
      return null;
    }

    let projectPath = typeof metadata.projectPath === 'string' ? metadata.projectPath.trim() : '';
    if (!projectPath) {
      const workspaceProjectPath = await this.resolveProjectPathFromChatWorkspace(filePath);
      if (workspaceProjectPath) {
        projectPath = workspaceProjectPath;
      }
    }
    if (!projectPath && typeof metadata.projectHash === 'string') {
      projectPath = projectHashLookup.get(metadata.projectHash.trim().toLowerCase()) ?? '';
    }
    if (!projectPath) {
      return null;
    }

    // Once we resolve a project hash/path pair, keep it in-memory for this sync run.
    if (typeof metadata.projectHash === 'string' && metadata.projectHash.trim()) {
      projectHashLookup.set(metadata.projectHash.trim().toLowerCase(), projectPath);
    }

    return {
      sessionId: metadata.sessionId,
      projectPath,
      sessionName: normalizeSessionName(metadata.firstUserMessage, 'New Gemini Chat'),
    };
  }

  /**
   * Reads first useful metadata from Gemini JSONL files.
   */
  private async extractJsonlMetadata(filePath: string): Promise<GeminiJsonlMetadata | null> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split('\n');

      let sessionId: string | undefined;
      let projectPath: string | undefined;
      let projectHash: string | undefined;
      let firstUserMessage: string | undefined;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        let parsed: AnyRecord;
        try {
          parsed = JSON.parse(trimmed) as AnyRecord;
        } catch {
          continue;
        }

        if (!sessionId && typeof parsed.sessionId === 'string') {
          sessionId = parsed.sessionId;
        }
        if (!projectPath && typeof parsed.projectPath === 'string') {
          projectPath = parsed.projectPath;
        }
        if (!projectHash && typeof parsed.projectHash === 'string') {
          projectHash = parsed.projectHash;
        }

        if (!firstUserMessage && parsed.type === 'user') {
          firstUserMessage = this.extractGeminiTextContent(parsed.content);
        }

        if (sessionId && (projectPath || projectHash) && firstUserMessage) {
          break;
        }
      }

      if (!sessionId) {
        return null;
      }

      return {
        sessionId,
        projectPath,
        projectHash,
        firstUserMessage,
      };
    } catch {
      return null;
    }
  }

  /**
   * Tries to resolve project root from Gemini tmp chat workspaces.
   */
  private async resolveProjectPathFromChatWorkspace(filePath: string): Promise<string> {
    if (!filePath.includes(`${path.sep}chats${path.sep}`)) {
      return '';
    }

    const chatsDir = path.dirname(filePath);
    const workspaceDir = path.dirname(chatsDir);
    const projectRootPath = path.join(workspaceDir, '.project_root');

    try {
      const rootContent = await readFile(projectRootPath, 'utf8');
      return rootContent.trim();
    } catch {
      return '';
    }
  }

  /**
   * Builds a hash->path lookup for Gemini JSONL metadata that stores projectHash.
   */
  private buildProjectHashLookup(): Map<string, string> {
    const lookup = new Map<string, string>();
    const knownPaths = new Set<string>();

    for (const project of projectsDb.getProjectPaths()) {
      if (typeof project.project_path === 'string' && project.project_path.trim()) {
        knownPaths.add(project.project_path.trim());
      }
    }

    for (const session of sessionsDb.getAllSessions()) {
      if (session.provider === this.provider && typeof session.project_path === 'string' && session.project_path.trim()) {
        knownPaths.add(session.project_path.trim());
      }
    }

    for (const knownPath of knownPaths) {
      this.addProjectHashCandidates(lookup, knownPath);
    }

    return lookup;
  }

  /**
   * Adds likely Gemini hash variants for one project path.
   */
  private addProjectHashCandidates(lookup: Map<string, string>, projectPath: string): void {
    const trimmed = projectPath.trim();
    if (!trimmed) {
      return;
    }

    const normalized = normalizeProjectPath(trimmed);
    const resolved = path.resolve(trimmed);
    const resolvedNormalized = normalizeProjectPath(resolved);

    const candidates = new Set<string>([
      trimmed,
      normalized,
      resolved,
      resolvedNormalized,
    ]);

    if (process.platform === 'win32') {
      for (const candidate of [...candidates]) {
        candidates.add(candidate.toLowerCase());
      }
    }

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      const hash = this.sha256(candidate);
      if (!lookup.has(hash)) {
        lookup.set(hash, trimmed);
      }
    }
  }

  /**
   * Returns first user text from Gemini content payload shapes.
   */
  private extractGeminiTextContent(content: unknown): string | undefined {
    if (typeof content === 'string' && content.trim().length > 0) {
      return content;
    }

    if (!Array.isArray(content)) {
      return undefined;
    }

    for (const part of content) {
      if (typeof part === 'string' && part.trim().length > 0) {
        return part;
      }

      if (part && typeof part === 'object' && typeof (part as AnyRecord).text === 'string') {
        const text = (part as AnyRecord).text;
        if (text.trim().length > 0) {
          return text;
        }
      }
    }

    return undefined;
  }

  /**
   * Keeps tmp scanning scoped to chat artifacts only.
   */
  private shouldSkipTempArtifact(filePath: string): boolean {
    return (
      filePath.startsWith(path.join(this.geminiHome, 'tmp'))
      && !filePath.includes(`${path.sep}chats${path.sep}`)
    );
  }

  private sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
