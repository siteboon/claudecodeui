import express from 'express';
import { spawn, execFile } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';

const router = express.Router();

function safeSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function execGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const wrapped = new Error(stderr?.toString() || err.message);
        wrapped.code = err.code;
        reject(wrapped);
        return;
      }
      resolve(stdout.toString());
    });
  });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function parseWorktreeList(output) {
  const entries = [];
  let current = {};
  for (const line of output.split('\n')) {
    if (!line.trim()) {
      if (current.worktree) {
        entries.push(current);
        current = {};
      }
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') current.worktree = value;
    else if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'bare') current.bare = true;
    else if (key === 'detached') current.detached = true;
    else if (key === 'locked') current.locked = true;
    else if (key === 'prunable') current.prunable = true;
  }
  if (current.worktree) entries.push(current);
  return entries;
}

router.get('/', async (req, res) => {
  const repoPath = typeof req.query.repo === 'string' ? req.query.repo : '';
  if (!repoPath) {
    res.status(400).json({ error: 'Missing ?repo=<absolute-path>' });
    return;
  }
  if (!path.isAbsolute(repoPath)) {
    res.status(400).json({ error: 'repo must be absolute' });
    return;
  }
  if (!(await pathExists(repoPath))) {
    res.status(404).json({ error: 'repo not found' });
    return;
  }

  try {
    const raw = await execGit(['worktree', 'list', '--porcelain'], repoPath);
    const entries = parseWorktreeList(raw).map((entry) => ({
      path: entry.worktree,
      branch: entry.branch || (entry.detached ? 'detached' : null),
      head: entry.head,
      isMain: entry.worktree === repoPath,
      locked: entry.locked === true,
      prunable: entry.prunable === true,
      slug: path.basename(entry.worktree),
    }));
    res.json({ repo: repoPath, worktrees: entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { repo, slug, branch, baseBranch } = req.body || {};
  if (!repo || !path.isAbsolute(repo)) {
    res.status(400).json({ error: 'repo (absolute path) is required' });
    return;
  }
  const safeName = safeSlug(slug || branch || `wt-${Date.now().toString(36)}`);
  if (!safeName) {
    res.status(400).json({ error: 'slug resolves to empty after sanitization' });
    return;
  }

  const worktreesDir = path.join(repo, '.claude', 'worktrees');
  const worktreePath = path.join(worktreesDir, safeName);

  if (await pathExists(worktreePath)) {
    res.status(409).json({ error: 'worktree already exists', path: worktreePath });
    return;
  }

  try {
    await fs.mkdir(worktreesDir, { recursive: true });
    const newBranch = branch ? safeSlug(branch) || safeName : `dispatch/${safeName}`;
    const args = ['worktree', 'add', '-b', newBranch, worktreePath];
    if (baseBranch) args.push(String(baseBranch));
    await execGit(args, repo);
    res.json({
      ok: true,
      worktree: {
        path: worktreePath,
        branch: newBranch,
        slug: safeName,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  const { repo, path: worktreePath, force } = req.body || {};
  if (!repo || !worktreePath) {
    res.status(400).json({ error: 'repo + path are required' });
    return;
  }
  if (!path.isAbsolute(repo) || !path.isAbsolute(worktreePath)) {
    res.status(400).json({ error: 'paths must be absolute' });
    return;
  }
  // Safety: never let callers delete the repo itself.
  if (path.resolve(repo) === path.resolve(worktreePath)) {
    res.status(400).json({ error: 'refusing to remove main worktree' });
    return;
  }

  try {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(worktreePath);
    await execGit(args, repo);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Spawn a terminal/tmux session running `claude` in the given worktree.
// Best-effort — if tmux is absent we fall back to spawning a detached
// `claude` process and returning the pid.
router.post('/spawn', async (req, res) => {
  const { worktreePath, sessionName } = req.body || {};
  if (!worktreePath || !path.isAbsolute(worktreePath)) {
    res.status(400).json({ error: 'worktreePath (absolute) is required' });
    return;
  }
  if (!(await pathExists(worktreePath))) {
    res.status(404).json({ error: 'worktree path not found' });
    return;
  }

  const slug = safeSlug(sessionName || path.basename(worktreePath));
  const tmuxSession = `dispatch-${slug}`;

  try {
    const hasTmux = await new Promise((resolve) => {
      const probe = spawn('which', ['tmux']);
      probe.on('exit', (code) => resolve(code === 0));
      probe.on('error', () => resolve(false));
    });

    if (hasTmux) {
      const tmux = spawn(
        'tmux',
        ['new-session', '-d', '-s', tmuxSession, '-c', worktreePath, 'claude'],
        { detached: true, stdio: 'ignore', env: { ...process.env, HOME: os.homedir() } },
      );
      tmux.unref();
      res.json({ ok: true, via: 'tmux', tmuxSession });
      return;
    }

    const child = spawn('claude', [], {
      cwd: worktreePath,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    res.json({ ok: true, via: 'spawn', pid: child.pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
