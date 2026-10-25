import express from 'express';
import type { RequestHandler } from 'express';

import { createLoginRateLimiter } from '@/modules/remote-access/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';
import {
  approveProposal,
  createProposal,
  feedProjects,
  feedSessions,
  feedUsage,
  listProposals,
  proposalForAgent,
  rejectProposal,
} from '@/modules/workbench-agent/workbench-agent.service.js';
import { agentStore, type AgentToken } from '@/modules/workbench-agent/workbench-agent.store.js';

type AgentRequest = express.Request & { agentToken?: AgentToken };

const param = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value);

const requireAgentToken: RequestHandler = (req, res, next) => {
  const header = req.header('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const token = presented ? agentStore.verifyToken(presented) : null;
  if (!token) {
    res.status(401).json({ success: false, error: 'invalid or revoked token' });
    return;
  }
  (req as AgentRequest).agentToken = token;
  next();
};

/**
 * Narrow door for an agent such as Hermes (bearer token, mounted WITHOUT the JWT middleware).
 * It can read status/usage and propose tasks. It cannot run anything, see prompts, diffs or
 * paths, or touch git: a proposal does nothing until the owner approves it.
 */
export function createAgentFeedRouter(): express.Router {
  const router = express.Router();
  // Wrong tokens are throttled like wrong passwords.
  router.use(createLoginRateLimiter());
  router.use(express.json({ limit: '32kb' }));
  router.use(requireAgentToken);

  router.get('/sessions', asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse({ sessions: await feedSessions() }));
  }));

  router.get('/usage', asyncHandler(async (req, res) => {
    const days = Number.parseInt(String(req.query.days ?? '30'), 10);
    res.json(createApiSuccessResponse(await feedUsage(Number.isFinite(days) ? days : 30)));
  }));

  router.get('/projects', asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse({ projects: await feedProjects() }));
  }));

  router.post('/proposals', asyncHandler(async (req, res) => {
    const proposal = await createProposal((req as AgentRequest).agentToken as AgentToken, (req.body ?? {}) as Record<string, unknown>);
    res.status(201).json(createApiSuccessResponse({ id: proposal.id, status: proposal.status }));
  }));

  router.get('/proposals/:id', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await proposalForAgent((req as AgentRequest).agentToken as AgentToken, param(req.params.id))));
  }));

  return router;
}

/** Owner-side management (JWT): tokens and the approval queue. */
export function createAgentAdminRouter(): express.Router {
  const router = express.Router();

  router.get('/tokens', (_req, res) => {
    res.json(createApiSuccessResponse({ tokens: agentStore.listTokens() }));
  });

  router.post('/tokens', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    if (!name) throw new AppError('name is required', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
    const { token, record } = agentStore.createToken(name);
    // The plaintext is shown exactly once.
    res.status(201).json(createApiSuccessResponse({ token, record }));
  });

  router.delete('/tokens/:id', (req, res) => {
    const revoked = agentStore.revokeToken(param(req.params.id));
    if (!revoked) throw new AppError('Token not found', { code: 'TOKEN_NOT_FOUND', statusCode: 404 });
    res.json(createApiSuccessResponse({ revoked: true }));
  });

  router.get('/proposals', (_req, res) => {
    res.json(createApiSuccessResponse({ proposals: listProposals(), pending: agentStore.countPending() }));
  });

  router.post('/proposals/:id/approve', asyncHandler(async (req, res) => {
    const proposal = await approveProposal(param(req.params.id), req.body?.confirm === true);
    res.json(createApiSuccessResponse({ proposal }));
  }));

  router.post('/proposals/:id/reject', (req, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note : null;
    res.json(createApiSuccessResponse({ proposal: rejectProposal(param(req.params.id), note) }));
  });

  return router;
}
