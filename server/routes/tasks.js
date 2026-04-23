import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

import express from 'express';

const router = express.Router();

const CLAUDE_PROJECTS_DIR = path.resolve(os.homedir(), '.claude', 'projects');

// Reject anything that looks like path traversal or a separator before we
// try to open a file. Defense-in-depth: the resolved path is also prefix-
// checked against CLAUDE_PROJECTS_DIR below.
const UNSAFE_PATH_SEGMENT = /[\\/]|\0|\.\./;

function slugFromProjectName(projectName) {
  // Claude stores JSONLs in `~/.claude/projects/<slug>/`. The slug is the
  // passed project name directly in our API (callers already know it).
  return String(projectName || '').trim();
}

async function readSessionFile(projectSlug, sessionId) {
  if (!projectSlug || !sessionId) return null;
  if (UNSAFE_PATH_SEGMENT.test(projectSlug) || UNSAFE_PATH_SEGMENT.test(sessionId)) {
    return null;
  }
  const jsonlPath = path.resolve(CLAUDE_PROJECTS_DIR, projectSlug, `${sessionId}.jsonl`);
  if (!jsonlPath.startsWith(CLAUDE_PROJECTS_DIR + path.sep)) {
    return null;
  }
  try {
    const raw = await fs.readFile(jsonlPath, 'utf8');
    return raw.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function findLatestTodoWrite(lines) {
  if (!lines) return null;
  let latest = null;
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const content = parsed?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (
        item &&
        item.type === 'tool_use' &&
        item.name === 'TodoWrite' &&
        item.input &&
        Array.isArray(item.input.todos)
      ) {
        latest = {
          timestamp: parsed.timestamp || null,
          todos: item.input.todos,
        };
      }
    }
  }
  return latest;
}

function normalizeStatus(status) {
  const v = String(status || '').toLowerCase();
  if (v === 'in_progress' || v === 'in-progress') return 'in_progress';
  if (v === 'completed' || v === 'done') return 'completed';
  return 'pending';
}

/**
 * GET /api/tasks?projectName=<slug>&sessionId=<uuid>
 *
 * Reads the session's JSONL, finds the most recent TodoWrite tool_use,
 * and returns the todos bucketed into columns.
 */
router.get('/', async (req, res) => {
  const projectName = slugFromProjectName(req.query.projectName);
  const sessionId = String(req.query.sessionId || '').trim();

  if (!projectName || !sessionId) {
    res.status(400).json({ error: 'projectName and sessionId are required' });
    return;
  }

  const lines = await readSessionFile(projectName, sessionId);
  if (lines === null) {
    res.status(404).json({
      error: 'session file not found',
      projectName,
      sessionId,
    });
    return;
  }

  const latest = findLatestTodoWrite(lines);
  if (!latest) {
    res.json({
      projectName,
      sessionId,
      updatedAt: null,
      columns: { todo: [], in_progress: [], completed: [] },
      total: 0,
    });
    return;
  }

  const columns = { todo: [], in_progress: [], completed: [] };
  for (const todo of latest.todos) {
    const status = normalizeStatus(todo.status);
    const card = {
      content: String(todo.content || ''),
      activeForm: String(todo.activeForm || ''),
      status,
    };
    if (status === 'in_progress') columns.in_progress.push(card);
    else if (status === 'completed') columns.completed.push(card);
    else columns.todo.push(card);
  }

  res.json({
    projectName,
    sessionId,
    updatedAt: latest.timestamp,
    columns,
    total: latest.todos.length,
  });
});

export default router;
