/**
 * Unified messages endpoint.
 *
 * GET /api/sessions/:sessionId/messages?provider=claude&projectId=<id>&limit=50&offset=0
 *
 * Replaces the four provider-specific session message endpoints with a single route
 * that delegates to the appropriate adapter via the provider registry.
 *
 * After the projectName → projectId migration, Claude history is located via the
 * DB-backed project path lookup; the route accepts `projectId` (preferred) and
 * resolves it to the underlying Claude folder name for the downstream adapter.
 *
 * @module routes/messages
 */

import express from 'express';
import { sessionsService } from '../modules/providers/services/sessions.service.js';
import { getProjectPathById, claudeFolderNameFromPath } from '../projects.js';

const router = express.Router();

/**
 * GET /api/sessions/:sessionId/messages
 *
 * Auth: authenticateToken applied at mount level in index.js
 *
 * Query params:
 *   provider    - 'claude' | 'cursor' | 'codex' | 'gemini' (default: 'claude')
 *   projectId   - DB primary key of the project (required for claude provider)
 *   projectPath - required for cursor provider (absolute path used for cwdId hash)
 *   limit       - page size (omit or null for all)
 *   offset      - pagination offset (default: 0)
 */
router.get('/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const provider = String(req.query.provider || 'claude').trim().toLowerCase();
    const projectId = req.query.projectId || '';
    const projectPath = req.query.projectPath || '';
    const limitParam = req.query.limit;
    const limit = limitParam !== undefined && limitParam !== null && limitParam !== ''
      ? parseInt(limitParam, 10)
      : null;
    const offset = parseInt(req.query.offset || '0', 10);

    const availableProviders = sessionsService.listProviderIds();
    if (!availableProviders.includes(provider)) {
      const available = availableProviders.join(', ');
      return res.status(400).json({ error: `Unknown provider: ${provider}. Available: ${available}` });
    }

    // The Claude adapter still reads sessions from ~/.claude/projects/<folder>/,
    // so we translate the caller's projectId into the encoded folder name via
    // the DB-stored project path before delegating to the adapter.
    let claudeProjectName = '';
    if (provider === 'claude' && projectId) {
      const resolvedPath = await getProjectPathById(projectId);
      if (!resolvedPath) {
        return res.status(404).json({ error: 'Project not found' });
      }
      claudeProjectName = claudeFolderNameFromPath(resolvedPath);
    }

    const result = await sessionsService.fetchHistory(provider, sessionId, {
      projectName: claudeProjectName,
      projectPath,
      limit,
      offset,
    });

    return res.json(result);
  } catch (error) {
    console.error('Error fetching unified messages:', error);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

export default router;
