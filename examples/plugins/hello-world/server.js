const http = require('http');
const fs = require('fs');
const path = require('path');

const TEXT_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro',
  '.css', '.scss', '.sass', '.less',
  '.html', '.htm', '.xml', '.svg',
  '.json', '.yaml', '.yml', '.toml', '.ini',
  '.md', '.mdx', '.txt', '.rst',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.gql',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', '__pycache__', '.venv', 'venv',
  'target', 'vendor', '.turbo', 'out', '.output', 'tmp',
]);

function scan(dir, max = 5000) {
  const files = [];
  (function walk(d, depth) {
    if (depth > 6 || files.length >= max) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= max) break;
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1);
      } else if (e.isFile()) {
        try {
          const stat = fs.statSync(full);
          files.push({
            full,
            rel: path.relative(dir, full),
            ext: path.extname(e.name).toLowerCase() || '(none)',
            size: stat.size,
            mtime: stat.mtimeMs,
          });
        } catch { /* skip unreadable */ }
      }
    }
  })(dir, 0);
  return files;
}

function countLines(full, size) {
  if (size > 256 * 1024) return 0; // skip large files
  try { return (fs.readFileSync(full, 'utf-8').match(/\n/g) || []).length + 1; }
  catch { return 0; }
}

function getStats(projectPath) {
  if (!projectPath || !path.isAbsolute(projectPath)) throw new Error('Invalid path');
  if (!fs.existsSync(projectPath)) throw new Error('Path does not exist');

  const files = scan(projectPath);
  const byExt = {};
  let totalLines = 0;
  let totalSize = 0;

  for (const f of files) {
    byExt[f.ext] = (byExt[f.ext] || 0) + 1;
    totalSize += f.size;
    if (TEXT_EXTS.has(f.ext)) totalLines += countLines(f.full, f.size);
  }

  return {
    totalFiles: files.length,
    totalLines,
    totalSize,
    byExtension: Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 12),
    largest: [...files].sort((a, b) => b.size - a.size).slice(0, 6).map(f => ({ name: f.rel, size: f.size })),
    recent: [...files].sort((a, b) => b.mtime - a.mtime).slice(0, 6).map(f => ({ name: f.rel, mtime: f.mtime })),
  };
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url.startsWith('/stats')) {
    try {
      const { searchParams } = new URL(req.url, 'http://localhost');
      const stats = getStats(searchParams.get('path'));
      res.end(JSON.stringify(stats));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  // Signal readiness to the host — this JSON line is required
  console.log(JSON.stringify({ ready: true, port }));
});
