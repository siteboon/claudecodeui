import express, { type NextFunction, type Request, type Response } from 'express';

import { asyncHandler } from '@/shared/http/async-handler.js';
import { AppError } from '@/shared/utils/app-error.js';
import { createApiErrorResponse, createApiSuccessResponse } from '@/shared/http/api-response.js';
import { llmService } from '@/modules/ai-runtime/services/ai-runtime.service.js';
import { llmSessionsService } from '@/modules/ai-runtime/services/sessions.service.js';
import { llmMcpService } from '@/modules/ai-runtime/services/mcp.service.js';
import { llmSkillsService } from '@/modules/ai-runtime/services/skills.service.js';
import type { McpScope, McpTransport, UpsertProviderMcpServerInput } from '@/modules/ai-runtime/types/index.js';
import { llmMessagesUnifier } from '@/modules/ai-runtime/services/messages-unifier.service.js';
import type { LLMProvider } from '@/shared/types/app.js';
import { logger } from '@/shared/utils/logger.js';

const router = express.Router();

/**
 * Safely reads an Express path parameter that may arrive as string or string[].
 */
const readPathParam = (value: unknown, name: string): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  throw new AppError(`${name} path parameter is invalid.`, {
    code: 'INVALID_PATH_PARAMETER',
    statusCode: 400,
  });
};

const normalizeProviderParam = (value: unknown): string =>
  readPathParam(value, 'provider').trim().toLowerCase();

/**
 * Validates and normalizes rename payload.
 */
const parseRenamePayload = (payload: unknown): { summary: string } => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (!summary) {
    throw new AppError('summary is required.', {
      code: 'SUMMARY_REQUIRED',
      statusCode: 400,
    });
  }

  if (summary.length > 500) {
    throw new AppError('summary must not exceed 500 characters.', {
      code: 'SUMMARY_TOO_LONG',
      statusCode: 400,
    });
  }

  return { summary };
};

/**
 * Reads optional query values and trims surrounding whitespace.
 */
const readOptionalQueryString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Validates MCP scope query/body values.
 */
const parseMcpScope = (value: unknown): McpScope | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'user' || normalized === 'local' || normalized === 'project') {
    return normalized;
  }

  throw new AppError(`Unsupported MCP scope "${normalized}".`, {
    code: 'INVALID_MCP_SCOPE',
    statusCode: 400,
  });
};

/**
 * Validates MCP transport query/body values.
 */
const parseMcpTransport = (value: unknown): McpTransport => {
  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    throw new AppError('transport is required.', {
      code: 'MCP_TRANSPORT_REQUIRED',
      statusCode: 400,
    });
  }

  if (normalized === 'stdio' || normalized === 'http' || normalized === 'sse') {
    return normalized;
  }

  throw new AppError(`Unsupported MCP transport "${normalized}".`, {
    code: 'INVALID_MCP_TRANSPORT',
    statusCode: 400,
  });
};

/**
 * Parses and validates MCP upsert payload.
 */
const parseMcpUpsertPayload = (payload: unknown): UpsertProviderMcpServerInput => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const name = readOptionalQueryString(body.name);
  if (!name) {
    throw new AppError('name is required.', {
      code: 'MCP_NAME_REQUIRED',
      statusCode: 400,
    });
  }

  const transport = parseMcpTransport(body.transport);
  const scope = parseMcpScope(body.scope);
  const workspacePath = readOptionalQueryString(body.workspacePath);

  return {
    name,
    transport,
    scope,
    workspacePath,
    command: readOptionalQueryString(body.command),
    args: Array.isArray(body.args) ? body.args.filter((entry): entry is string => typeof entry === 'string') : undefined,
    env: typeof body.env === 'object' && body.env !== null
      ? Object.fromEntries(
          Object.entries(body.env as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
    cwd: readOptionalQueryString(body.cwd),
    url: readOptionalQueryString(body.url),
    headers: typeof body.headers === 'object' && body.headers !== null
      ? Object.fromEntries(
          Object.entries(body.headers as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
    envVars: Array.isArray(body.envVars)
      ? body.envVars.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    bearerTokenEnvVar: readOptionalQueryString(body.bearerTokenEnvVar),
    envHttpHeaders: typeof body.envHttpHeaders === 'object' && body.envHttpHeaders !== null
      ? Object.fromEntries(
          Object.entries(body.envHttpHeaders as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
  };
};

/**
 * Converts any provider route parameter into the strongly typed provider union.
 */
const parseProvider = (value: unknown): LLMProvider => {
  const normalized = normalizeProviderParam(value);
  if (normalized === 'claude' || normalized === 'codex' || normalized === 'cursor' || normalized === 'gemini') {
    return normalized;
  }

  throw new AppError(`Unsupported provider "${normalized}".`, {
    code: 'UNSUPPORTED_PROVIDER',
    statusCode: 400,
  });
};

/**
 * Enriches provider session snapshots with normalized message types for frontend rendering.
 */
const formatSessionSnapshot = (
  provider: LLMProvider,
  snapshot: {
    sessionId: string;
    events: Array<{
      timestamp: string;
      channel: 'sdk' | 'stdout' | 'stderr' | 'json' | 'system' | 'error';
      message?: string;
      data?: unknown;
    }>;
  },
) => ({
  ...snapshot,
  messages: llmMessagesUnifier.normalizeSessionEvents(provider, snapshot.sessionId, snapshot.events),
});

router.get(
  '/providers',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse({ providers: llmService.listProviders() }));
  }),
);

router.get(
  '/providers/:provider/models',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const models = await llmService.listModels(provider);
    res.json(createApiSuccessResponse({ provider, models }));
  }),
);

router.get(
  '/providers/:provider/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessions = llmService.listSessions(provider).map((session) => formatSessionSnapshot(provider, session));
    res.json(createApiSuccessResponse({ provider, sessions }));
  }),
);

router.get(
  '/providers/:provider/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const session = llmService.getSession(provider, sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" not found for provider "${provider}".`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    res.json(createApiSuccessResponse({ provider, session: formatSessionSnapshot(provider, session) }));
  }),
);

router.post(
  '/providers/:provider/sessions/start',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const snapshot = await llmService.startSession(provider, req.body);
    const formattedSnapshot = formatSessionSnapshot(provider, snapshot);
    res.status(202).json(
      createApiSuccessResponse({
        provider,
        session: formattedSnapshot,
      }),
    );
  }),
);

router.post(
  '/providers/:provider/sessions/:sessionId/resume',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');

    const snapshot = await llmService.resumeSession(provider, sessionId, req.body);
    res.status(202).json(createApiSuccessResponse({ provider, session: formatSessionSnapshot(provider, snapshot) }));
  }),
);

router.post(
  '/providers/:provider/sessions/:sessionId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const stopped = await llmService.stopSession(provider, sessionId);
    res.json(createApiSuccessResponse({ provider, sessionId, stopped }));
  }),
);

/**
 * Lists MCP servers for one provider grouped by user/local/project scopes.
 */
router.get(
  '/providers/:provider/mcp/servers',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const scope = parseMcpScope(req.query.scope);

    if (scope) {
      const servers = await llmMcpService.listProviderMcpServersForScope(provider, scope, { workspacePath });
      res.json(createApiSuccessResponse({ provider, scope, servers }));
      return;
    }

    const groupedServers = await llmMcpService.listProviderMcpServers(provider, { workspacePath });
    res.json(createApiSuccessResponse({ provider, scopes: groupedServers }));
  }),
);

/**
 * Adds one MCP server for one provider and scope.
 */
router.post(
  '/providers/:provider/mcp/servers',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const payload = parseMcpUpsertPayload(req.body);
    const server = await llmMcpService.upsertProviderMcpServer(provider, payload);
    res.status(201).json(createApiSuccessResponse({ server }));
  }),
);

/**
 * Updates one provider MCP server definition.
 */
router.put(
  '/providers/:provider/mcp/servers/:name',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const payload = parseMcpUpsertPayload({
      ...((req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}),
      name: readPathParam(req.params.name, 'name'),
    });
    const server = await llmMcpService.upsertProviderMcpServer(provider, payload);
    res.json(createApiSuccessResponse({ server }));
  }),
);

/**
 * Removes one provider MCP server from its configured scope.
 */
router.delete(
  '/providers/:provider/mcp/servers/:name',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const scope = parseMcpScope(req.query.scope);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const result = await llmMcpService.removeProviderMcpServer(provider, {
      name: readPathParam(req.params.name, 'name'),
      scope,
      workspacePath,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

/**
 * Executes a lightweight startup/connectivity probe for one provider MCP server.
 */
router.post(
  '/providers/:provider/mcp/servers/:name/run',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const body = (req.body as Record<string, unknown> | undefined) ?? {};
    const scope = parseMcpScope(body.scope ?? req.query.scope);
    const workspacePath = readOptionalQueryString(body.workspacePath ?? req.query.workspacePath);
    const result = await llmMcpService.runProviderMcpServer(provider, {
      name: readPathParam(req.params.name, 'name'),
      scope,
      workspacePath,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

/**
 * Adds one HTTP/stdio MCP server to every provider.
 */
router.post(
  '/mcp/servers/global',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = parseMcpUpsertPayload(req.body);
    if (payload.scope === 'local') {
      throw new AppError('Global MCP add supports only "user" or "project" scopes.', {
        code: 'INVALID_GLOBAL_MCP_SCOPE',
        statusCode: 400,
      });
    }
    const results = await llmMcpService.addMcpServerToAllProviders({
      ...payload,
      scope: payload.scope === 'user' ? 'user' : 'project',
    });
    res.status(201).json(createApiSuccessResponse({ results }));
  }),
);

/**
 * Lists provider-specific skills from all documented skill directories.
 */
router.get(
  '/providers/:provider/skills',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const skills = await llmSkillsService.listProviderSkills(provider, { workspacePath });
    res.json(createApiSuccessResponse({ provider, skills }));
  }),
);

/**
 * Lists skills for one provider or for all providers in a single response.
 */
router.get(
  '/skills',
  asyncHandler(async (req: Request, res: Response) => {
    const providerQuery = readOptionalQueryString(req.query.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    if (providerQuery) {
      const provider = parseProvider(providerQuery);
      const skills = await llmSkillsService.listProviderSkills(provider, { workspacePath });
      res.json(createApiSuccessResponse({ provider, skills }));
      return;
    }

    const providers: LLMProvider[] = ['claude', 'codex', 'cursor', 'gemini'];
    const byProvider = Object.fromEntries(
      await Promise.all(
        providers.map(async (provider) => ([
          provider,
          await llmSkillsService.listProviderSkills(provider, { workspacePath }),
        ])),
      ),
    );
    res.json(createApiSuccessResponse({ providers: byProvider }));
  }),
);

router.get(
  '/sessions/:sessionId/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const history = await llmSessionsService.getSessionHistory(sessionId);
    res.json(createApiSuccessResponse({
      sessionId,
      provider: history.provider,
      messages: history.messages,
    }));
  }),
);

router.get(
  '/sessions/:sessionId/history',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const history = await llmSessionsService.getSessionHistory(sessionId);
    res.json(createApiSuccessResponse(history));
  }),
);

/**
 * Renames one indexed session by writing the custom summary into DB.
 */
router.put(
  '/sessions/:sessionId/rename',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const { summary } = parseRenamePayload(req.body);
    llmSessionsService.updateSessionCustomName(sessionId, summary);
    res.json(createApiSuccessResponse({ sessionId, summary }));
  }),
);

/**
 * Returns DB-indexed sessions discovered by the session-processor scan.
 */
router.get(
  '/sessions/index',
  asyncHandler(async (req: Request, res: Response) => {
    const provider =
      typeof req.query.provider === 'string' ? req.query.provider.trim().toLowerCase() : undefined;
    const sessions = llmSessionsService.listIndexedSessions(provider);
    res.json(createApiSuccessResponse({ provider: provider ?? null, sessions }));
  }),
);

/**
 * Returns one DB-indexed session metadata row.
 */
router.get(
  '/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const session = llmSessionsService.getIndexedSession(sessionId);
    res.json(createApiSuccessResponse({ session }));
  }),
);

/**
 * Triggers provider disk scans and refreshes the shared sessions table.
 */
router.post(
  '/sessions/sync',
  asyncHandler(async (_req: Request, res: Response) => {
    const syncResult = await llmSessionsService.synchronizeSessions();
    res.json(createApiSuccessResponse(syncResult));
  }),
);

/**
 * Deletes provider-specific session artifacts and removes the DB row.
 */
router.delete(
  '/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const result = await llmSessionsService.deleteSessionArtifacts(sessionId);
    res.json(createApiSuccessResponse(result));
  }),
);

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

  const message = error instanceof Error ? error.message : 'Unexpected LLM route failure.';
  logger.error(message, {
    module: 'ai-runtime.routes',
  });

  res.status(500).json(createApiErrorResponse('INTERNAL_ERROR', message));
});

export default router;
