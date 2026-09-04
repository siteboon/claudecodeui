import express, { type Request, type Response } from 'express';

import { chromeTabsService } from '@/modules/chrome-tabs/chrome-tabs.service.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

/**
 * Opening a tab in the running Chrome, without going through the agent.
 *
 * The equivalent of `@browser:newTab` in the VS Code extension, which reaches
 * its own MCP client the same way: a UI message, not a prompt.
 */

const router = express.Router();

router.get('/status', asyncHandler(async (_req: Request, res: Response) => {
  res.json(createApiSuccessResponse(chromeTabsService.getStatus()));
}));

router.post('/tab', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { url?: unknown };
  const url = typeof body.url === 'string' ? body.url : undefined;

  res.json(createApiSuccessResponse(await chromeTabsService.openTab(url)));
}));

export default router;
