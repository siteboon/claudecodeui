import express from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import { extractProjectDirectory } from '../projects.js';
import { parseFrontmatter } from '../utils/frontmatter.js';

const router = express.Router();

async function resolveProjectPath(projectName) {
  const projectPath = await extractProjectDirectory(projectName);
  if (!projectPath || typeof projectPath !== 'string') {
    throw new Error(`Unable to resolve project path for "${projectName}"`);
  }
  return projectPath;
}

function extractSection(body, heading) {
  const re = new RegExp(`(^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
  const match = body.match(re);
  return match ? match[2].trim() : '';
}

function parseTicket(filename, raw) {
  const { data, content } = parseFrontmatter(raw);
  const request = extractSection(content, 'Request');
  const logBlock = extractSection(content, 'Log');
  const log = logBlock
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);

  return {
    id: data.id ?? path.basename(filename, '.md'),
    title: data.title ?? '',
    kind: data.kind ?? null,
    status: data.status ?? 'backlog',
    deps: Array.isArray(data.deps) ? data.deps : [],
    env: data.env ?? null,
    created: data.created ?? null,
    updated: data.updated ?? null,
    prUrl: data['pr-url'] ?? null,
    worktreeBranch: data['worktree-branch'] ?? null,
    request,
    log,
  };
}

router.get('/', async (req, res) => {
  const { project } = req.query;
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await resolveProjectPath(project);
    const boardDir = path.join(projectPath, '.prose', 'board');

    let entries;
    try {
      entries = await fs.readdir(boardDir);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.json({ tickets: [] });
      }
      throw err;
    }

    const tickets = [];
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const full = path.join(boardDir, entry);
      const raw = await fs.readFile(full, 'utf8');
      try {
        tickets.push(parseTicket(entry, raw));
      } catch (err) {
        console.error(`board: failed to parse ${full}:`, err.message);
      }
    }

    tickets.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    res.json({ tickets });
  } catch (error) {
    console.error('board list error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
