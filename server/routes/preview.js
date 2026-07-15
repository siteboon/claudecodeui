import { execFile } from 'node:child_process';
import fs from 'node:fs';

import express from 'express';

import { PREVIEW_COOKIE, issuePreviewToken } from '../utils/preview-proxy.js';

const router = express.Router();

const EXEC_TIMEOUT_MS = 20_000;
const DOCKER_ACTIONS = new Set(['ps', 'up', 'down', 'stop', 'restart', 'logs']);

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, ...options },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err?.code ?? 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || (err && !stderr ? err.message : '')),
        });
      },
    );
  });
}

// POST /api/preview/session — mint a preview cookie for the authenticated user.
// The iframe carries this cookie on every request the /preview proxy serves.
router.post('/session', (req, res) => {
  const token = issuePreviewToken();
  res.setHeader('Set-Cookie', `${PREVIEW_COOKIE}=${token}; Path=/preview; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});

// GET /api/preview/ports — listening TCP ports on this machine plus docker
// containers that publish a host port, so the UI can offer them for preview.
router.get('/ports', async (_req, res) => {
  const ports = new Map(); // port -> { port, source, name }

  // Listening sockets (macOS/Linux via lsof).
  const lsof = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-P']);
  if (lsof.ok) {
    for (const line of lsof.stdout.split('\n').slice(1)) {
      const cols = line.split(/\s+/);
      if (cols.length < 9) continue;
      const command = cols[0];
      const nameField = cols[8] || '';
      const portMatch = nameField.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = Number(portMatch[1]);
      if (!Number.isInteger(port)) continue;
      if (!ports.has(port)) ports.set(port, { port, source: 'process', name: command });
    }
  }

  // Docker published ports.
  const docker = await run('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}']);
  if (docker.ok) {
    for (const line of docker.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [name, portsField = ''] = line.split('\t');
      for (const m of portsField.matchAll(/(?:0\.0\.0\.0|127\.0\.0\.1|\[::\]):(\d+)->/g)) {
        const port = Number(m[1]);
        if (!Number.isInteger(port)) continue;
        ports.set(port, { port, source: 'docker', name });
      }
    }
  }

  res.json({
    ports: [...ports.values()].sort((a, b) => a.port - b.port),
    dockerAvailable: docker.ok,
  });
});

function normalizePort(entry) {
  // `docker compose config --format json` may give a string ("3000:3000",
  // "127.0.0.1:8080:80", "5432") or an object { published, target }.
  if (entry && typeof entry === 'object') {
    const published = entry.published != null ? Number(entry.published) : null;
    const target = entry.target != null ? Number(entry.target) : null;
    return { published: Number.isInteger(published) ? published : null, target };
  }
  if (typeof entry === 'string') {
    const parts = entry.split(':');
    if (parts.length === 1) return { published: null, target: Number(parts[0]) || null };
    const published = Number(parts[parts.length - 2]);
    const target = Number(parts[parts.length - 1]);
    return {
      published: Number.isInteger(published) ? published : null,
      target: Number.isInteger(target) ? target : null,
    };
  }
  return { published: null, target: null };
}

function parseComposePs(stdout) {
  const byService = {};
  const text = stdout.trim();
  if (!text) return byService;
  let rows = [];
  try {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Newline-delimited JSON objects (docker compose v2 default).
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
  }
  for (const row of rows) {
    const service = row.Service || row.service;
    if (!service) continue;
    byService[service] = {
      state: row.State || row.state || 'unknown',
      publishers: Array.isArray(row.Publishers) ? row.Publishers : [],
    };
  }
  return byService;
}

// GET /api/preview/docker/services — resolve the project's compose file and
// return its services with declared ports and current running state, so the UI
// can show real services instead of asking the user to type names.
router.get('/docker/services', async (req, res) => {
  const projectPath = req.query.projectPath;
  if (!projectPath || typeof projectPath !== 'string') {
    return res.status(400).json({ error: 'projectPath is required' });
  }
  try {
    if (!fs.statSync(projectPath).isDirectory()) {
      return res.status(400).json({ error: 'projectPath is not a directory' });
    }
  } catch {
    return res.status(400).json({ error: 'projectPath does not exist' });
  }

  const config = await run('docker', ['compose', 'config', '--format', 'json'], { cwd: projectPath });
  if (!config.ok) {
    // No compose file, or docker missing — tell the UI which.
    const hasCompose = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].some(
      (f) => fs.existsSync(`${projectPath}/${f}`),
    );
    return res.json({
      hasCompose,
      dockerAvailable: !/not found|command not found|not recognized/i.test(config.stderr),
      services: [],
      error: config.stderr.trim() || null,
    });
  }

  let parsed = {};
  try {
    parsed = JSON.parse(config.stdout);
  } catch {
    return res.json({ hasCompose: true, dockerAvailable: true, services: [], error: 'Failed to parse compose config' });
  }

  const ps = await run('docker', ['compose', 'ps', '--format', 'json', '--all'], { cwd: projectPath });
  const running = ps.ok ? parseComposePs(ps.stdout) : {};

  const services = Object.entries(parsed.services || {}).map(([name, def]) => {
    const declaredPorts = (def.ports || []).map(normalizePort);
    const live = running[name];
    // Prefer actually-published ports from `ps` when the service is up.
    const livePorts = live
      ? (live.publishers || [])
          .filter((p) => p.PublishedPort)
          .map((p) => ({ published: Number(p.PublishedPort), target: Number(p.TargetPort) }))
      : [];
    const ports = livePorts.length ? livePorts : declaredPorts;
    return {
      name,
      image: def.image || null,
      state: live ? live.state : 'not created',
      ports: ports.filter((p) => p.published != null),
    };
  });

  res.json({ hasCompose: true, dockerAvailable: true, services });
});

// POST /api/preview/docker — run a whitelisted docker compose action in the
// currently selected project's directory.
router.post('/docker', async (req, res) => {
  const { action, projectPath, service } = req.body || {};

  if (!DOCKER_ACTIONS.has(action)) {
    return res.status(400).json({ error: `Unsupported action: ${action}` });
  }
  if (!projectPath || typeof projectPath !== 'string') {
    return res.status(400).json({ error: 'projectPath is required' });
  }
  let stat;
  try {
    stat = fs.statSync(projectPath);
  } catch {
    return res.status(400).json({ error: 'projectPath does not exist' });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'projectPath is not a directory' });
  }
  if (service && !/^[a-zA-Z0-9_.-]+$/.test(service)) {
    return res.status(400).json({ error: 'Invalid service name' });
  }

  const argsByAction = {
    ps: ['compose', 'ps'],
    up: ['compose', 'up', '-d', ...(service ? [service] : [])],
    down: ['compose', 'down'],
    stop: ['compose', 'stop', ...(service ? [service] : [])],
    restart: ['compose', 'restart', ...(service ? [service] : [])],
    logs: ['compose', 'logs', '--tail', '200', '--no-color', ...(service ? [service] : [])],
  };

  const result = await run('docker', argsByAction[action], { cwd: projectPath });
  res.json(result);
});

export default router;
