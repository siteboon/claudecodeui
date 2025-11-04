import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import { addProjectManually } from '../projects.js';

const router = express.Router();

/**
 * Create a new workspace
 * POST /api/projects/create-workspace
 *
 * Body:
 * - workspaceType: 'existing' | 'new'
 * - path: string (workspace path)
 * - githubUrl?: string (optional, for new workspaces)
 * - githubTokenId?: number (optional, ID of stored token)
 * - newGithubToken?: string (optional, one-time token)
 */
router.post('/create-workspace', async (req, res) => {
  try {
    const { workspaceType, path: workspacePath, githubUrl, githubTokenId, newGithubToken } = req.body;

    // Validate required fields
    if (!workspaceType || !workspacePath) {
      return res.status(400).json({ error: 'workspaceType and path are required' });
    }

    if (!['existing', 'new'].includes(workspaceType)) {
      return res.status(400).json({ error: 'workspaceType must be "existing" or "new"' });
    }

    const absolutePath = path.resolve(workspacePath);

    // Handle existing workspace
    if (workspaceType === 'existing') {
      // Check if the path exists
      try {
        await fs.access(absolutePath);
        const stats = await fs.stat(absolutePath);

        if (!stats.isDirectory()) {
          return res.status(400).json({ error: 'Path exists but is not a directory' });
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          return res.status(404).json({ error: 'Workspace path does not exist' });
        }
        throw error;
      }

      // Add the existing workspace to the project list
      const project = await addProjectManually(absolutePath);

      return res.json({
        success: true,
        project,
        message: 'Existing workspace added successfully'
      });
    }

    // Handle new workspace creation
    if (workspaceType === 'new') {
      // Check if path already exists
      try {
        await fs.access(absolutePath);
        return res.status(400).json({
          error: 'Path already exists. Please choose a different path or use "existing workspace" option.'
        });
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        // Path doesn't exist - good, we can create it
      }

      // Create the directory
      await fs.mkdir(absolutePath, { recursive: true });

      // If GitHub URL is provided, clone the repository
      if (githubUrl) {
        let githubToken = null;

        // Get GitHub token if needed
        if (githubTokenId) {
          // Fetch token from database
          const token = await getGithubTokenById(githubTokenId, req.user.id);
          if (!token) {
            // Clean up created directory
            await fs.rm(absolutePath, { recursive: true, force: true });
            return res.status(404).json({ error: 'GitHub token not found' });
          }
          githubToken = token.github_token;
        } else if (newGithubToken) {
          githubToken = newGithubToken;
        }

        // Clone the repository
        try {
          await cloneGitHubRepository(githubUrl, absolutePath, githubToken);
        } catch (error) {
          // Clean up created directory on failure
          await fs.rm(absolutePath, { recursive: true, force: true });
          throw new Error(`Failed to clone repository: ${error.message}`);
        }
      }

      // Add the new workspace to the project list
      const project = await addProjectManually(absolutePath);

      return res.json({
        success: true,
        project,
        message: githubUrl
          ? 'New workspace created and repository cloned successfully'
          : 'New workspace created successfully'
      });
    }

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
  const { getDatabase } = await import('../database/db.js');
  const db = await getDatabase();

  const token = await db.get(
    'SELECT * FROM github_tokens WHERE id = ? AND user_id = ? AND is_active = 1',
    [tokenId, userId]
  );

  return token;
}

/**
 * Helper function to clone a GitHub repository
 */
function cloneGitHubRepository(githubUrl, destinationPath, githubToken = null) {
  return new Promise((resolve, reject) => {
    // Parse GitHub URL and inject token if provided
    let cloneUrl = githubUrl;

    if (githubToken) {
      try {
        const url = new URL(githubUrl);
        // Format: https://TOKEN@github.com/user/repo.git
        url.username = githubToken;
        url.password = '';
        cloneUrl = url.toString();
      } catch (error) {
        return reject(new Error('Invalid GitHub URL format'));
      }
    }

    const gitProcess = spawn('git', ['clone', cloneUrl, destinationPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0' // Disable git password prompts
      }
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        // Parse git error messages to provide helpful feedback
        let errorMessage = 'Git clone failed';

        if (stderr.includes('Authentication failed') || stderr.includes('could not read Username')) {
          errorMessage = 'Authentication failed. Please check your GitHub token.';
        } else if (stderr.includes('Repository not found')) {
          errorMessage = 'Repository not found. Please check the URL and ensure you have access.';
        } else if (stderr.includes('already exists')) {
          errorMessage = 'Directory already exists';
        } else if (stderr) {
          errorMessage = stderr;
        }

        reject(new Error(errorMessage));
      }
    });

    gitProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Git is not installed or not in PATH'));
      } else {
        reject(error);
      }
    });
  });
}

export default router;
