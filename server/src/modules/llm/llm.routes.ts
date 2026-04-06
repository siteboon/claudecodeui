import express, { type NextFunction, type Request, type Response } from 'express';

import { asyncHandler } from '@/shared/http/async-handler.js';
import { AppError } from '@/shared/utils/app-error.js';
import { createApiErrorResponse, createApiSuccessResponse } from '@/shared/http/api-response.js';
import { llmService } from '@/modules/llm/llm.service.js';
import { llmSessionsService } from '@/modules/llm/sessions.service.js';
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
 * Allows callers to block until a launched/resumed session reaches a final state.
 */
const parseWaitForCompletion = (req: Request): boolean => {
  const value = (req.body as Record<string, unknown> | undefined)?.waitForCompletion;
  return value === true;
};

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

router.get(
  '/providers',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse({ providers: llmService.listProviders() }));
  }),
);

router.get(
  '/providers/:provider/models',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = normalizeProviderParam(req.params.provider);
    const models = await llmService.listModels(provider);
    res.json(createApiSuccessResponse({ provider, models }));
  }),
);

router.get(
  '/providers/:provider/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = normalizeProviderParam(req.params.provider);
    const sessions = llmService.listSessions(provider);
    res.json(createApiSuccessResponse({ provider, sessions }));
  }),
);

router.get(
  '/providers/:provider/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = normalizeProviderParam(req.params.provider);
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const session = llmService.getSession(provider, sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" not found for provider "${provider}".`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    res.json(createApiSuccessResponse({ provider, session }));
  }),
);

router.post(
  '/providers/:provider/sessions/start',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = normalizeProviderParam(req.params.provider);
    const snapshot = await llmService.startSession(provider, req.body);

    const waitForCompletion = parseWaitForCompletion(req);
    if (!waitForCompletion) {
      res.status(202).json(
        createApiSuccessResponse({
          provider,
          session: snapshot,
        }),
      );
      return;
    }

    const completedSnapshot = await llmService.waitForSession(provider, snapshot.sessionId);
    res.json(createApiSuccessResponse({ provider, session: completedSnapshot ?? snapshot }));
  }),
);

router.post(
  '/providers/:provider/sessions/:sessionId/resume',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = normalizeProviderParam(req.params.provider);
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');

    const snapshot = await llmService.resumeSession(provider, sessionId, req.body);

    const waitForCompletion = parseWaitForCompletion(req);
    if (!waitForCompletion) {
      res.status(202).json(createApiSuccessResponse({ provider, session: snapshot }));
      return;
    }

    const completedSnapshot = await llmService.waitForSession(provider, sessionId);
    res.json(createApiSuccessResponse({ provider, session: completedSnapshot ?? snapshot }));
  }),
);

router.post(
  '/providers/:provider/sessions/:sessionId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = normalizeProviderParam(req.params.provider);
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const stopped = await llmService.stopSession(provider, sessionId);
    res.json(createApiSuccessResponse({ provider, sessionId, stopped }));
  }),
);

router.patch(
  '/providers/:provider/sessions/:sessionId/model',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = normalizeProviderParam(req.params.provider);
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    if (!model) {
      throw new AppError('model is required.', {
        code: 'MODEL_REQUIRED',
        statusCode: 400,
      });
    }

    await llmService.setSessionModel(provider, sessionId, model);
    res.json(
      createApiSuccessResponse({
        provider,
        sessionId,
        model,
      }),
    );
  }),
);

router.patch(
  '/providers/:provider/sessions/:sessionId/thinking',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = normalizeProviderParam(req.params.provider);
    const sessionId = readPathParam(req.params.sessionId, 'sessionId');
    const thinkingMode =
      typeof req.body?.thinkingMode === 'string' ? req.body.thinkingMode.trim() : '';

    if (!thinkingMode) {
      throw new AppError('thinkingMode is required.', {
        code: 'THINKING_MODE_REQUIRED',
        statusCode: 400,
      });
    }

    await llmService.setSessionThinkingMode(provider, sessionId, thinkingMode);
    res.json(
      createApiSuccessResponse({
        provider,
        sessionId,
        thinkingMode,
      }),
    );
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
    module: 'llm.routes',
  });

  res.status(500).json(createApiErrorResponse('INTERNAL_ERROR', message));
});

export default router;
