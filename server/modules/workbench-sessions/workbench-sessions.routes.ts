import express from 'express';

import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';
import {
  getHooksStatus,
  installHooks,
  uninstallHooks,
  type HookAgent,
} from '@/modules/workbench-sessions/workbench-hooks.service.js';
import { getRunScript, setRunScript } from '@/modules/workbench-sessions/workbench-config.js';
import { getHookToken, recordHookEvent } from '@/modules/workbench-sessions/workbench-runtime.service.js';
import {
  commitSession,
  createSession,
  discardSession,
  getDiff,
  getDiscardPreview,
  getSessionView,
  listSessions,
  mergeSession,
  pushSession,
  rebaseSession,
} from '@/modules/workbench-sessions/workbench-sessions.service.js';
import { workbenchSessionsStore } from '@/modules/workbench-sessions/workbench-sessions.store.js';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function pid(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function hookAgent(body: unknown): HookAgent {
  return (body as Record<string, unknown> | undefined)?.agent === 'codex' ? 'codex' : 'claude';
}

function bool(value: unknown): boolean {
  return value === true;
}

/** Authenticated API (mounted behind the app's JWT middleware). */
export function createWorkbenchSessionsRouter(): express.Router {
  const router = express.Router();

  router.get('/sessions', asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse({ sessions: await listSessions() }));
  }));

  router.post('/sessions', asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const session = await createSession({
      projectPath: str(body.projectPath),
      baseBranch: str(body.baseBranch) || null,
      agent: str(body.agent) as 'claude' | 'codex',
      profileId: str(body.profileId) || null,
      prompt: str(body.prompt),
      title: str(body.title) || null,
    });
    res.json(createApiSuccessResponse({ session: await getSessionView(session.id) }));
  }));

  router.get('/sessions/:id', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ session: await getSessionView(pid(req.params.id)) }));
  }));

  router.patch('/sessions/:id', asyncHandler(async (req, res) => {
    const title = str((req.body as Record<string, unknown>).title).trim();
    if (!title) throw new AppError('title is required', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
    await getSessionView(pid(req.params.id));
    workbenchSessionsStore.rename(pid(req.params.id), title);
    res.json(createApiSuccessResponse({ session: await getSessionView(pid(req.params.id)) }));
  }));

  router.get('/sessions/:id/diff', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await getDiff(pid(req.params.id))));
  }));

  router.post('/sessions/:id/commit', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await commitSession(pid(req.params.id), str((req.body as Record<string, unknown>).message))));
  }));

  router.post('/sessions/:id/rebase', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await rebaseSession(pid(req.params.id))));
  }));

  router.post('/sessions/:id/merge', asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    res.json(createApiSuccessResponse(await mergeSession(pid(req.params.id), {
      confirm: bool(body.confirm),
      message: str(body.message) || null,
    })));
  }));

  router.post('/sessions/:id/push', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await pushSession(pid(req.params.id))));
  }));

  router.get('/sessions/:id/discard-preview', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await getDiscardPreview(pid(req.params.id))));
  }));

  router.post('/sessions/:id/discard', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(
      await discardSession(pid(req.params.id), bool((req.body as Record<string, unknown>).confirm)),
    ));
  }));

  router.get('/run-config', asyncHandler(async (req, res) => {
    const projectPath = str(req.query.projectPath);
    res.json(createApiSuccessResponse({ projectPath, command: await getRunScript(projectPath) }));
  }));

  router.put('/run-config', asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const projectPath = str(body.projectPath);
    if (!projectPath) throw new AppError('projectPath is required', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
    await setRunScript(projectPath, str(body.command));
    res.json(createApiSuccessResponse({ projectPath, command: await getRunScript(projectPath) }));
  }));

  router.get('/hooks/status', asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse(await getHooksStatus()));
  }));

  router.post('/hooks/install', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await installHooks(hookAgent(req.body), bool((req.body as Record<string, unknown>).confirm))));
  }));

  router.post('/hooks/uninstall', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await uninstallHooks(hookAgent(req.body), bool((req.body as Record<string, unknown>).confirm))));
  }));

  return router;
}

/**
 * Hook receiver. Mounted WITHOUT the JWT middleware because the hook script cannot log in;
 * instead it must present the per-process token that only Workbench-launched PTYs receive.
 */
export function createWorkbenchHookRouter(): express.Router {
  const router = express.Router();
  router.post('/hooks', express.json(), (req, res) => {
    if (req.header('x-workbench-token') !== getHookToken()) {
      res.status(401).json({ success: false, error: 'invalid token' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ok = recordHookEvent(str(body.sessionId), str(body.event));
    res.status(ok ? 200 : 404).json({ success: ok });
  });
  return router;
}
