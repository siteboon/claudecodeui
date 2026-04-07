import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';

import { conversationSearchService } from '@/modules/conversations/conversation-search.service.js';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { workspaceOriginalPathsDb } from '@/shared/database/repositories/workspace-original-paths.db.js';
import { AppError } from '@/shared/utils/app-error.js';
import { createApiErrorResponse } from '@/shared/http/api-response.js';
import { logger } from '@/shared/utils/logger.js';

const router = express.Router();

type SearchResult = Awaited<ReturnType<typeof conversationSearchService.search>>[number];

type ConversationSearchHighlight = {
  start: number;
  end: number;
};

type ConversationSearchMatch = {
  role: 'user' | 'assistant';
  snippet: string;
  highlights: ConversationSearchHighlight[];
  timestamp: string | null;
  provider: string;
  messageUuid: string | null;
};

type ConversationSearchSession = {
  sessionId: string;
  provider: string;
  sessionSummary: string;
  matches: ConversationSearchMatch[];
};

type ConversationSearchProjectResult = {
  projectName: string;
  projectDisplayName: string;
  sessions: ConversationSearchSession[];
};

const normalizeQueryWords = (query: string): string[] =>
  [...new Set(query.toLowerCase().split(/\s+/).filter((word) => word.length > 0))];

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const readOptionalTimestamp = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
};

const encodeLegacyProjectName = (workspacePath: string): string =>
  workspacePath.replace(/[\\/:\s~_]/g, '-');

const getWorkspaceDisplayName = (workspacePath: string, customWorkspaceName: string | null): string => {
  if (customWorkspaceName?.trim()) {
    return customWorkspaceName.trim();
  }

  const normalizedPath = workspacePath.trim().replace(/[\\/]+$/, '');
  const baseName = path.basename(normalizedPath);
  return baseName || workspacePath;
};

const collectTextFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    const normalized = normalizeWhitespace(content);
    return normalized.length > 0 ? normalized : null;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }

        const textPart = (part as Record<string, unknown>).text;
        return typeof textPart === 'string' ? textPart : '';
      })
      .join(' ');
    const normalized = normalizeWhitespace(text);
    return normalized.length > 0 ? normalized : null;
  }

  return null;
};

const parseLineMatchPayload = (lineText: string): {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
  messageUuid: string | null;
} => {
  const defaultPayload = {
    role: 'assistant' as const,
    text: normalizeWhitespace(lineText),
    timestamp: null,
    messageUuid: null,
  };

  let parsedLine: unknown;
  try {
    parsedLine = JSON.parse(lineText);
  } catch {
    return defaultPayload;
  }

  if (!parsedLine || typeof parsedLine !== 'object' || Array.isArray(parsedLine)) {
    return defaultPayload;
  }

  const parsedRecord = parsedLine as Record<string, unknown>;
  const message = parsedRecord.message;
  const messageRecord =
    message && typeof message === 'object' && !Array.isArray(message)
      ? (message as Record<string, unknown>)
      : null;

  const roleValue = readOptionalString(messageRecord?.role ?? parsedRecord.role);
  const role = roleValue === 'user' ? 'user' : 'assistant';

  const textFromMessage = collectTextFromMessageContent(messageRecord?.content ?? parsedRecord.content);
  const textFromInline = readOptionalString(parsedRecord.text);
  const text = normalizeWhitespace(textFromMessage ?? textFromInline ?? lineText);

  const timestamp = readOptionalTimestamp(
    parsedRecord.timestamp ?? parsedRecord.created_at ?? parsedRecord.createdAt ?? parsedRecord.time,
  );
  const messageUuid = readOptionalString(parsedRecord.uuid ?? messageRecord?.uuid);

  return {
    role,
    text,
    timestamp,
    messageUuid,
  };
};

const buildSnippetWithHighlights = (
  text: string,
  queryWords: string[],
): {
  snippet: string;
  highlights: ConversationSearchHighlight[];
} => {
  const normalizedText = normalizeWhitespace(text);
  if (!normalizedText) {
    return { snippet: '', highlights: [] };
  }

  const lowerText = normalizedText.toLowerCase();
  let firstMatchIndex = -1;

  for (const word of queryWords) {
    const index = lowerText.indexOf(word);
    if (index >= 0 && (firstMatchIndex === -1 || index < firstMatchIndex)) {
      firstMatchIndex = index;
    }
  }

  const targetIndex = firstMatchIndex >= 0 ? firstMatchIndex : 0;
  const snippetLength = 180;
  const halfLength = Math.floor(snippetLength / 2);
  const start = Math.max(0, targetIndex - halfLength);
  const end = Math.min(normalizedText.length, start + snippetLength);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';
  const snippetBody = normalizedText.slice(start, end);
  const snippet = `${prefix}${snippetBody}${suffix}`;
  const snippetLower = snippet.toLowerCase();
  const highlights: ConversationSearchHighlight[] = [];

  for (const word of queryWords) {
    let fromIndex = 0;
    while (fromIndex < snippetLower.length) {
      const index = snippetLower.indexOf(word, fromIndex);
      if (index < 0) {
        break;
      }

      highlights.push({
        start: index,
        end: index + word.length,
      });
      fromIndex = index + word.length;
    }
  }

  highlights.sort((left, right) => left.start - right.start);
  const mergedHighlights: ConversationSearchHighlight[] = [];
  for (const highlight of highlights) {
    const previous = mergedHighlights[mergedHighlights.length - 1];
    if (previous && highlight.start <= previous.end) {
      previous.end = Math.max(previous.end, highlight.end);
    } else {
      mergedHighlights.push({ ...highlight });
    }
  }

  return {
    snippet,
    highlights: mergedHighlights,
  };
};

const buildProjectResults = (
  searchResults: SearchResult[],
  queryWords: string[],
): { projectResults: ConversationSearchProjectResult[]; totalMatches: number } => {
  const workspaceRows = workspaceOriginalPathsDb.getWorkspacePaths();
  const customWorkspaceNameByPath = new Map(
    workspaceRows.map((workspaceRow) => [workspaceRow.workspace_path, workspaceRow.custom_workspace_name]),
  );

  const sessions = sessionsDb.getAllSessions();
  const sessionByProviderAndId = new Map(
    sessions.map((session) => [`${session.provider}:${session.session_id}`, session]),
  );
  const sessionById = new Map(sessions.map((session) => [session.session_id, session]));

  const projects = new Map<
    string,
    {
      projectResult: ConversationSearchProjectResult;
      sessions: Map<string, ConversationSearchSession>;
    }
  >();
  let totalMatches = 0;

  for (const result of searchResults) {
    const sessionRow =
      sessionByProviderAndId.get(`${result.provider}:${result.sessionId}`) ??
      sessionById.get(result.sessionId);
    const workspacePath = sessionRow?.workspace_path ?? path.dirname(result.filePath);
    const projectName = encodeLegacyProjectName(workspacePath);
    const projectDisplayName = getWorkspaceDisplayName(
      workspacePath,
      customWorkspaceNameByPath.get(workspacePath) ?? null,
    );

    let projectEntry = projects.get(projectName);
    if (!projectEntry) {
      projectEntry = {
        projectResult: {
          projectName,
          projectDisplayName,
          sessions: [],
        },
        sessions: new Map<string, ConversationSearchSession>(),
      };
      projects.set(projectName, projectEntry);
    }

    const sessionMapKey = `${result.provider}:${result.sessionId}`;
    let sessionEntry = projectEntry.sessions.get(sessionMapKey);
    if (!sessionEntry) {
      sessionEntry = {
        sessionId: result.sessionId,
        provider: result.provider,
        sessionSummary: sessionRow?.custom_name?.trim() || 'Untitled Session',
        matches: [],
      };
      projectEntry.sessions.set(sessionMapKey, sessionEntry);
      projectEntry.projectResult.sessions.push(sessionEntry);
    }

    // Keep payload compact and consistent with previous search UX.
    if (sessionEntry.matches.length >= 2) {
      continue;
    }

    const parsedLine = parseLineMatchPayload(result.lineText);
    const { snippet, highlights } = buildSnippetWithHighlights(parsedLine.text, queryWords);
    if (!snippet) {
      continue;
    }

    sessionEntry.matches.push({
      role: parsedLine.role,
      snippet,
      highlights,
      timestamp: parsedLine.timestamp,
      provider: result.provider,
      messageUuid: parsedLine.messageUuid,
    });
    totalMatches += 1;
  }

  return {
    projectResults: [...projects.values()]
      .map((entry) => entry.projectResult)
      .filter((projectResult) => projectResult.sessions.length > 0),
    totalMatches,
  };
};

router.get('/search', async (req: Request, res: Response) => {
  const queryParam = typeof req.query.q === 'string'
    ? req.query.q
    : (typeof req.query.query === 'string' ? req.query.query : '');
  const query = queryParam.trim();
  const provider = typeof req.query.provider === 'string' ? req.query.provider.trim().toLowerCase() : undefined;
  const caseSensitive = req.query.caseSensitive === 'true';
  const parsedLimit = Number.parseInt(String(req.query.limit), 10);
  const limit = Number.isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 100));

  if (query.length < 2) {
    res.status(400).json(createApiErrorResponse('SEARCH_QUERY_TOO_SHORT', 'Query must be at least 2 characters.'));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  const abortController = new AbortController();
  req.on('close', () => {
    closed = true;
    abortController.abort();
  });

  try {
    const searchResults = await conversationSearchService.search({
      query,
      provider,
      caseSensitive,
      limit,
      signal: abortController.signal,
    });
    if (closed) {
      return;
    }

    const queryWords = normalizeQueryWords(query);
    const { projectResults, totalMatches } = buildProjectResults(searchResults, queryWords);
    const totalProjects = projectResults.length;
    let scannedProjects = 0;

    if (totalProjects === 0) {
      res.write(
        `event: progress\ndata: ${JSON.stringify({
          totalMatches: 0,
          scannedProjects: 0,
          totalProjects: 0,
        })}\n\n`,
      );
    }

    for (const projectResult of projectResults) {
      if (closed) {
        break;
      }

      scannedProjects += 1;
      res.write(
        `event: result\ndata: ${JSON.stringify({
          projectResult,
          totalMatches,
          scannedProjects,
          totalProjects,
        })}\n\n`,
      );
    }

    if (!closed) {
      res.write('event: done\ndata: {}\n\n');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Conversation search failed.';
    logger.error(message, {
      module: 'conversations.routes',
    });
    if (!closed) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Search failed' })}\n\n`);
    }
  } finally {
    if (!closed) {
      res.end();
    }
  }
});

/**
 * Normalizes route-level failures to a consistent JSON API shape.
 */
router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    return;
  }

  if (error instanceof AppError) {
    res
      .status(error.statusCode)
      .json(createApiErrorResponse(error.code, error.message, undefined, error.details));
    return;
  }

  const message =
    error instanceof Error ? error.message : 'Unexpected conversations route failure.';
  logger.error(message, {
    module: 'conversations.routes',
  });

  res.status(500).json(createApiErrorResponse('INTERNAL_ERROR', message));
});

export default router;
