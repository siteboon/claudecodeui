import express from 'express';
import { spawn } from 'child_process';
import { extractProjectDirectory } from '../projects.js';

const router = express.Router();

const KIND_LABELS = new Set(['prose:fix', 'prose:feature', 'prose:test']);
const ISSUE_LIST_LIMIT = 200;

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const err = new Error(`Command failed: ${command} ${args.join(' ')}`);
      err.code = code;
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
}

async function resolveProjectPath(projectName) {
  const projectPath = await extractProjectDirectory(projectName);
  if (!projectPath || typeof projectPath !== 'string') {
    throw new Error(`Unable to resolve project path for "${projectName}"`);
  }
  return projectPath;
}

function extractSection(body, heading) {
  if (!body) return '';
  const re = new RegExp(`(^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
  const match = body.match(re);
  return match ? match[2].trim() : '';
}

function parseDependsOn(body) {
  const section = extractSection(body, 'Depends on');
  if (!section) return [];
  const out = [];
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    // Match "- [ ] #42" or "- [x] #42" / "- [X] #42"
    const match = line.match(/^[-*]\s*\[(\s|x|X)\]\s*#(\d+)/);
    if (!match) continue;
    out.push({ number: Number(match[2]), checked: match[1].toLowerCase() === 'x' });
  }
  return out;
}

function pickKind(labels) {
  const kindMatches = labels.filter((l) => KIND_LABELS.has(l.name));
  if (kindMatches.length !== 1) return null;
  return kindMatches[0].name.replace(/^prose:/, '');
}

function deriveStatus(issue, deps) {
  if (issue.state === 'CLOSED') return 'done';
  const labelNames = new Set(issue.labels.map((l) => l.name));
  if (labelNames.has('prose:in-progress')) return 'in-progress';
  if (labelNames.has('prose:blocked')) return 'blocked';
  if (deps.length > 0 && deps.some((d) => !d.checked)) return 'backlog';
  return 'ready';
}

function shapeIssue(issue) {
  const kind = pickKind(issue.labels ?? []);
  if (!kind) return null;
  const deps = parseDependsOn(issue.body ?? '');
  const status = deriveStatus(issue, deps);
  const request = extractSection(issue.body ?? '', 'Request') || (issue.body ?? '');
  return {
    number: issue.number,
    title: issue.title ?? '',
    kind,
    status,
    deps: deps.map((d) => ({ number: d.number, closed: d.checked })),
    request,
    url: issue.url,
    state: issue.state ? issue.state.toLowerCase() : 'open',
    createdAt: issue.createdAt ?? null,
    updatedAt: issue.updatedAt ?? null,
  };
}

router.get('/', async (req, res) => {
  const { project } = req.query;
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await resolveProjectPath(project);

    const args = [
      'issue',
      'list',
      '--state', 'all',
      '--limit', String(ISSUE_LIST_LIMIT),
      '--json', 'number,title,body,state,labels,url,createdAt,updatedAt',
    ];

    let stdout;
    try {
      ({ stdout } = await spawnAsync('gh', args, { cwd: projectPath }));
    } catch (err) {
      const message = (err.stderr || err.message || '').trim();
      if (/not authenticated|gh auth login/i.test(message)) {
        return res.status(401).json({
          error: 'gh-auth-missing',
          detail: 'Run `gh auth login` on the server host to enable the kanban board.',
        });
      }
      if (err.code === 'ENOENT') {
        return res.status(500).json({
          error: 'gh-not-installed',
          detail: 'The `gh` CLI is not on PATH for the server process.',
        });
      }
      return res.status(500).json({ error: 'gh-failed', detail: message });
    }

    let raw;
    try {
      raw = JSON.parse(stdout);
    } catch (err) {
      return res.status(500).json({ error: 'gh-parse-failed', detail: err.message });
    }

    const tickets = [];
    for (const issue of raw) {
      const shaped = shapeIssue(issue);
      if (shaped) tickets.push(shaped);
    }

    tickets.sort((a, b) => a.number - b.number);
    res.json({ tickets });
  } catch (error) {
    console.error('board list error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
