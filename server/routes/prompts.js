import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { parseFrontmatter } from '../utils/frontmatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

async function scanPromptsDirectory(dir, namespace) {
  const prompts = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subPrompts = await scanPromptsDirectory(fullPath, namespace);
        prompts.push(...subPrompts);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const parsed = parseFrontmatter(content);

          if (parsed.data.name && parsed.data.type) {
            prompts.push({
              name: parsed.data.name,
              type: parsed.data.type,
              category: parsed.data.category || 'custom',
              description: parsed.data.description || '',
              icon: parsed.data.icon,
              tags: parsed.data.tags || [],
              path: fullPath,
              namespace,
              metadata: parsed.data
            });
          }
        } catch (err) {
          console.warn(`Failed to parse prompt file ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Failed to scan directory ${dir}:`, err.message);
    }
  }

  return prompts;
}

function validatePromptPath(promptPath, allowedDirs) {
  // Resolve to absolute path to prevent traversal attacks
  const resolvedPath = path.resolve(promptPath);

  // Check if path is within allowed directories using path.relative
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    const relativePath = path.relative(resolvedDir, resolvedPath);

    // Path is valid if:
    // 1. relative path doesn't start with '..' (not outside allowed dir)
    // 2. relative path is not empty (not the dir itself, but that's ok)
    // 3. path doesn't contain null bytes
    return relativePath &&
           !relativePath.startsWith('..') &&
           !relativePath.includes('\0') &&
           !path.isAbsolute(relativePath);
  });

  if (!isAllowed) {
    throw new Error('Invalid prompt path');
  }

  return resolvedPath;
}

/**
 * POST /api/prompts/list
 * List all available prompts from built-in, user, and project directories
 */
router.post('/list', async (req, res) => {
  try {
    const { projectPath } = req.body;

    // Scan built-in prompts
    const builtInDir = path.join(__dirname, '../../shared/prompts');
    const builtIn = await scanPromptsDirectory(builtInDir, 'builtin');

    // Scan user prompts
    const userDir = path.join(os.homedir(), '.claude', 'prompts');
    const user = await scanPromptsDirectory(userDir, 'user');

    // Scan project prompts
    let project = [];
    if (projectPath) {
      const projectDir = path.join(projectPath, '.claude', 'prompts');
      project = await scanPromptsDirectory(projectDir, 'project');
    }

    const allPrompts = [...builtIn, ...user, ...project];

    res.json({
      prompts: allPrompts,
      builtIn,
      user,
      project,
      count: allPrompts.length
    });
  } catch (error) {
    console.error('Error listing prompts:', error);
    res.status(500).json({
      error: 'Failed to list prompts',
      message: error.message
    });
  }
});

/**
 * POST /api/prompts/load
 * Load a specific prompt file with content
 */
router.post('/load', async (req, res) => {
  try {
    const { promptPath, projectPath } = req.body;

    // Define allowed directories
    const allowedDirs = [
      path.join(__dirname, '../../shared/prompts'),
      path.join(os.homedir(), '.claude', 'prompts')
    ];

    if (projectPath) {
      allowedDirs.push(path.join(projectPath, '.claude', 'prompts'));
    }

    // Validate path
    const validPath = validatePromptPath(promptPath, allowedDirs);

    // Read and parse file
    const content = await fs.readFile(validPath, 'utf-8');
    const parsed = parseFrontmatter(content);

    res.json({
      path: validPath,
      metadata: parsed.data,
      content: parsed.content.trim()
    });
  } catch (error) {
    console.error('Error loading prompt:', error);
    res.status(500).json({
      error: 'Failed to load prompt',
      message: error.message
    });
  }
});

export default router;
