import express, { type Request, type Response } from 'express';

import { authenticateToken } from '@/modules/auth/auth.middleware.js';
import {
  deleteSessionById,
  deleteWorkspaceByPath,
  getWorkspaceSessionsCollection,
  updateSessionNameById,
  updateWorkspaceNameByPath,
  updateWorkspaceStarByPath,
} from '@/modules/sidebar/sidebar.service.js';

const router = express.Router();

const getTrimmedString = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const getWorkspacePathFromBody = (req: Request): string => getTrimmedString(req.body?.workspacePath);

router.get(
  '/api/sidebar/get-workspaces-sessions',
  authenticateToken,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const workspaces = getWorkspaceSessionsCollection();
      res.json({ workspaces });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch workspaces';
      res.status(500).json({ error: message });
    }
  },
);

router.put(
  '/api/sidebar/update-workspace-star',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspacePath = getWorkspacePathFromBody(req);
      if (!workspacePath) {
        res.status(400).json({ error: 'workspacePath is required' });
        return;
      }

      const isStarred = updateWorkspaceStarByPath(workspacePath);
      res.json({ success: true, workspacePath, isStarred });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update workspace star';
      const statusCode = message.toLowerCase().includes('not found') ? 404 : 500;
      res.status(statusCode).json({ error: message });
    }
  },
);

router.put(
  '/api/sidebar/update-workspace-custom-name',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspacePath = getWorkspacePathFromBody(req);
      if (!workspacePath) {
        res.status(400).json({ error: 'workspacePath is required' });
        return;
      }

      const customWorkspaceName = getTrimmedString(req.body?.workspaceCustomName);
      updateWorkspaceNameByPath(workspacePath, customWorkspaceName || null);

      res.json({ success: true, workspacePath, workspaceCustomName: customWorkspaceName || null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update workspace name';
      res.status(500).json({ error: message });
    }
  },
);

router.put(
  '/api/sidebar/update-session-custom-name',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = getTrimmedString(req.body?.sessionId);
      const sessionCustomName = getTrimmedString(req.body?.sessionCustomName);

      if (!sessionId) {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }

      if (!sessionCustomName) {
        res.status(400).json({ error: 'sessionCustomName is required' });
        return;
      }

      if (sessionCustomName.length > 500) {
        res
          .status(400)
          .json({ error: 'sessionCustomName must not exceed 500 characters' });
        return;
      }

      updateSessionNameById(sessionId, sessionCustomName);
      res.json({ success: true, sessionId, sessionCustomName });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update session name';
      const statusCode = message.toLowerCase().includes('not found') ? 404 : 500;
      res.status(statusCode).json({ error: message });
    }
  },
);

router.delete(
  '/api/sidebar/delete-workspace',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspacePath = getWorkspacePathFromBody(req);
      if (!workspacePath) {
        res.status(400).json({ error: 'workspacePath is required' });
        return;
      }

      const result = await deleteWorkspaceByPath(workspacePath);
      res.json({
        success: true,
        workspacePath,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete workspace';
      res.status(500).json({ error: message });
    }
  },
);

router.delete(
  '/api/sidebar/delete-session',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = getTrimmedString(req.body?.sessionId);
      if (!sessionId) {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }

      const result = await deleteSessionById(sessionId);
      if (!result.deleted) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({
        success: true,
        sessionId,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete session';
      res.status(500).json({ error: message });
    }
  },
);

export default router;
