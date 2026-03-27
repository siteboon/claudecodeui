import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import spawn from 'cross-spawn';
import { githubTokensDb } from '@/shared/database/repositories/github-tokens.js';
import { workspaceOriginalPathsDb } from '@/shared/database/repositories/workspace-original-paths.db.js';
import { getWorkspaceNameFromPath, validateWorkspacePath } from './projects.utils.js';

const router = express.Router();

function sanitizeGitError(message, token) {
  if (!message || !token) return message;
  return message.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
}

router.patch('/workspace-name', async (req, res) => {
  try {
    const { path: workspacePath, customWorkspaceName } = req.body;

    if (!workspacePath || !String(workspacePath).trim()) {
      return res.status(400).json({ error: 'path is required' });
    }

    const normalizedPath = path.resolve(String(workspacePath).trim());
    const validation = await validateWorkspacePath(normalizedPath);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid workspace path',
        details: validation.error,
      });
    }

    const safePath = validation.resolvedPath || normalizedPath;
    const normalizedCustomName =
      typeof customWorkspaceName === 'string' && customWorkspaceName.trim()
        ? customWorkspaceName.trim()
        : null;

    workspaceOriginalPathsDb.updateCustomWorkspaceName(safePath, normalizedCustomName);

    return res.json({
      success: true,
      message: 'Workspace name updated successfully',
    });
  } catch (error) {
    console.error('Error updating workspace name:', error);
    return res.status(500).json({
      error: 'Failed to update workspace name',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * Create or add a workspace
 * POST /api/projects/create-workspace
 *
 * Body:
 * - path: string (workspace path)
 */
router.post('/create-workspace', async (req, res) => {
  try {
    const { path: workspacePath } = req.body;

    // Validate required fields
    if (!workspacePath) {
      return res.status(400).json({ error: 'path is required' });
    }

    // Cloning must go through the SSE clone endpoint.
    if (req.body.githubUrl || req.body.githubTokenId || req.body.newGithubToken) {
      return res.status(400).json({
        error: 'Git clone options are not supported on /create-workspace. Use /clone-progress instead.',
      });
    }

    // Validate path safety before any operations
    const validation = await validateWorkspacePath(workspacePath);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid workspace path',
        details: validation.error
      });
    }

    const absolutePath = validation.resolvedPath;

    // Add existing workspace or create it if it doesn't exist.
    let workspaceAlreadyExists = false;
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path exists but is not a directory' });
      }
      workspaceAlreadyExists = true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(absolutePath, { recursive: true });
      } else {
        throw error;
      }
    }

    workspaceOriginalPathsDb.createWorkspacePath(absolutePath, getWorkspaceNameFromPath(absolutePath));
    return res.json({
      success: true,
      message: workspaceAlreadyExists ? 'Workspace added successfully' : 'Workspace created successfully'
    });

  } catch (error) {
    console.error('Error creating workspace:', error);
    res.status(500).json({
      error: error.message || 'Failed to create workspace',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Helper function to get GitHub token from database
 */
async function getGithubTokenById(tokenId, userId) {
  return githubTokensDb.getGithubTokenById(userId, Number.parseInt(String(tokenId), 10));
}

/**
 * Clone repository with progress streaming (SSE)
 * GET /api/projects/clone-progress
 */
router.get('/clone-progress', async (req, res) => {
  const { path: workspacePath, githubUrl, githubTokenId, newGithubToken } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    if (!workspacePath || !githubUrl) {
      sendEvent('error', { message: 'workspacePath and githubUrl are required' });
      res.end();
      return;
    }

    const validation = await validateWorkspacePath(workspacePath);
    if (!validation.valid) {
      sendEvent('error', { message: validation.error });
      res.end();
      return;
    }

    const absolutePath = validation.resolvedPath;

    try {
      const existingPathStats = await fs.stat(absolutePath);
      if (!existingPathStats.isDirectory()) {
        sendEvent('error', { message: 'Path exists but is not a directory' });
        res.end();
        return;
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(absolutePath, { recursive: true });
      } else {
        throw error;
      }
    }

    let githubToken = null;
    if (githubTokenId) {
      const token = await getGithubTokenById(parseInt(githubTokenId), req.user.id);
      if (!token) {
        sendEvent('error', { message: 'GitHub token not found' });
        res.end();
        return;
      }
      githubToken = token.github_token;
    } else if (newGithubToken) {
      githubToken = newGithubToken;
    }

    const normalizedUrl = githubUrl.replace(/\/+$/, '').replace(/\.git$/, '');
    const repoName = normalizedUrl.split('/').pop() || 'repository';
    const clonePath = path.join(absolutePath, repoName);

    // Check if clone destination already exists to prevent data loss
    try {
      await fs.access(clonePath);
      sendEvent('error', { message: `Directory "${repoName}" already exists. Please choose a different location or remove the existing directory.` });
      res.end();
      return;
    } catch (err) {
      // Directory doesn't exist, which is what we want
    }

    let cloneUrl = githubUrl;
    if (githubToken) {
      try {
        const url = new URL(githubUrl);
        url.username = githubToken;
        url.password = '';
        cloneUrl = url.toString();
      } catch (error) {
        // SSH URL or invalid - use as-is
      }
    }

    sendEvent('progress', { message: `Cloning into '${repoName}'...` });

    const gitProcess = spawn('git', ['clone', '--progress', cloneUrl, clonePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0'
      }
    });

    let lastError = '';

    gitProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        sendEvent('progress', { message });
      }
    });

    gitProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      lastError = message;
      if (message) {
        sendEvent('progress', { message });
      }
    });

    gitProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          workspaceOriginalPathsDb.createWorkspacePath(clonePath, getWorkspaceNameFromPath(clonePath));
          sendEvent('complete', { message: 'Repository cloned successfully' });
        } catch (error) {
          sendEvent('error', { message: `Clone succeeded but failed to register workspace: ${error.message}` });
        }
      } else {
        const sanitizedError = sanitizeGitError(lastError, githubToken);
        let errorMessage = 'Git clone failed';
        if (lastError.includes('Authentication failed') || lastError.includes('could not read Username')) {
          errorMessage = 'Authentication failed. Please check your credentials.';
        } else if (lastError.includes('Repository not found')) {
          errorMessage = 'Repository not found. Please check the URL and ensure you have access.';
        } else if (lastError.includes('already exists')) {
          errorMessage = 'Directory already exists';
        } else if (sanitizedError) {
          errorMessage = sanitizedError;
        }
        try {
          await fs.rm(clonePath, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error('Failed to clean up after clone failure:', sanitizeGitError(cleanupError.message, githubToken));
        }
        sendEvent('error', { message: errorMessage });
      }
      res.end();
    });

    gitProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        sendEvent('error', { message: 'Git is not installed or not in PATH' });
      } else {
        sendEvent('error', { message: error.message });
      }
      res.end();
    });

    req.on('close', () => {
      gitProcess.kill();
    });

  } catch (error) {
    sendEvent('error', { message: error.message });
    res.end();
  }
});

export default router;
