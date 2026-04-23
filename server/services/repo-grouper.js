/**
 * REPO GROUPER SERVICE
 * ====================
 *
 * Enriches project records with repository grouping metadata so the sidebar
 * can render a three-level tree: Repo → Topic → Conversation.
 *
 * Algorithm (per project record):
 * 1. Walk up the project's `fullPath` looking for `.git` (file or dir)
 * 2. If `.git` found: read `remote.origin.url` from the git config
 *    - Success → key = normalized origin URL (strip `.git`, trailing slash, lowercased)
 *    - No remote → key = basename of git root
 * 3. No `.git` ancestor → key = "__uncategorized__"
 * 4. Worktrees: detect `.claude/worktrees/` in path OR `.git` as a file (gitdir
 *    pointer) → mark `isWorktree=true`, collapse into parent repo's group.
 *    Worktrees store their actual branch in the gitdir pointer.
 *
 * Results are cached in `~/.cloudcli/project-config.json` under a `repoGroups`
 * key so subsequent getProjects() calls avoid repeated filesystem walks +
 * `git` spawn. The cache is keyed by project slug; stale entries are re-read
 * on demand by inspecting stored fullPath.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_PATH = path.join(os.homedir(), '.cloudcli', 'project-config.json');
const CACHE_KEY = 'repoGroups';
const UNCATEGORIZED_KEY = '__uncategorized__';
const WORKTREE_PATH_MARKER = path.join('.claude', 'worktrees') + path.sep;

function normalizeOrigin(url) {
  if (!url) return null;
  let cleaned = String(url).trim();
  if (!cleaned) return null;
  // Strip .git suffix
  cleaned = cleaned.replace(/\.git$/i, '');
  // Strip trailing slash
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned.toLowerCase();
}

function deriveDisplayNameFromKey(key) {
  if (!key || key === UNCATEGORIZED_KEY) return null;
  // Try to pull "owner/repo" from an origin URL
  const m = key.match(/([^/:]+\/[^/:]+)$/);
  if (m) return m[1];
  // Otherwise basename-ish
  const parts = key.split(/[\/\\]/).filter(Boolean);
  return parts[parts.length - 1] || key;
}

async function findGitRoot(startPath) {
  if (!startPath) return null;
  let cur = path.resolve(startPath);
  const { root } = path.parse(cur);
  // Safety bound: never walk beyond 30 levels.
  for (let i = 0; i < 30; i++) {
    const gitPath = path.join(cur, '.git');
    try {
      const stat = await fs.stat(gitPath);
      return { gitPath, gitRoot: cur, isFile: stat.isFile(), isDir: stat.isDirectory() };
    } catch {
      // .git not at this level; walk up
    }
    if (cur === root) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

async function readGitConfigFile(gitDir) {
  const configPath = path.join(gitDir, 'config');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return raw;
  } catch {
    return null;
  }
}

function parseRemoteOriginUrl(configText) {
  if (!configText) return null;
  // Very small ini-ish parser for [remote "origin"] sections
  const lines = configText.split(/\r?\n/);
  let inOrigin = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      inOrigin = /^\[remote\s+"origin"\]$/i.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const m = line.match(/^url\s*=\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

async function resolveGitdirPointer(gitFilePath) {
  // A .git file contains `gitdir: <path>` when the dir is a worktree.
  try {
    const text = await fs.readFile(gitFilePath, 'utf8');
    const m = text.match(/^gitdir:\s*(.+)$/m);
    if (!m) return null;
    const rel = m[1].trim();
    const abs = path.isAbsolute(rel) ? rel : path.resolve(path.dirname(gitFilePath), rel);
    return abs;
  } catch {
    return null;
  }
}

async function readHeadBranch(gitDir) {
  try {
    const text = await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8');
    const m = text.match(/^ref:\s*refs\/heads\/(.+)$/m);
    if (m) return m[1].trim();
    const trimmed = text.trim();
    if (trimmed && !trimmed.startsWith('ref:')) return trimmed.slice(0, 12);
    return null;
  } catch {
    return null;
  }
}

async function readCache() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed || {};
  } catch {
    return {};
  }
}

async function writeCache(cache) {
  try {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    // Non-fatal — we lose caching for this session
    console.warn('[repo-grouper] failed to write cache:', err.message);
  }
}

/**
 * Compute grouping info for a single project. Does NOT touch the cache.
 * Exposed for unit testing.
 */
export async function computeGroupingFor(project) {
  const startPath = project.fullPath || project.path;
  const result = {
    repoGroup: UNCATEGORIZED_KEY,
    repoDisplayName: null,
    isWorktree: false,
    gitBranch: null,
    gitRoot: null,
    gitOrigin: null,
  };
  if (!startPath) return result;

  // Worktree heuristic from path segment
  const normalizedPath = path.normalize(startPath);
  if (normalizedPath.includes(WORKTREE_PATH_MARKER)) {
    result.isWorktree = true;
  }

  const located = await findGitRoot(startPath);
  if (!located) {
    return result;
  }
  result.gitRoot = located.gitRoot;

  let gitDir = located.gitPath;
  if (located.isFile) {
    // worktree: .git is a pointer file to the actual gitdir
    result.isWorktree = true;
    const realGitDir = await resolveGitdirPointer(located.gitPath);
    if (realGitDir) gitDir = realGitDir;
  }

  // Branch (best-effort)
  result.gitBranch = await readHeadBranch(gitDir);

  // For worktrees, climb to the main repo dir to read origin
  // git worktree .git pointers look like: <repo>/.git/worktrees/<name>
  let configGitDir = gitDir;
  const worktreeMatch = gitDir.match(/(.*)[\\/]worktrees[\\/][^\\/]+$/);
  if (worktreeMatch) {
    configGitDir = worktreeMatch[1];
    result.isWorktree = true;
  }

  const configText = await readGitConfigFile(configGitDir);
  const originRaw = parseRemoteOriginUrl(configText);
  const normalizedOrigin = normalizeOrigin(originRaw);
  result.gitOrigin = normalizedOrigin;

  if (normalizedOrigin) {
    result.repoGroup = normalizedOrigin;
    result.repoDisplayName = deriveDisplayNameFromKey(normalizedOrigin);
  } else {
    // No remote — use basename of git root
    const base = path.basename(result.gitRoot || startPath);
    result.repoGroup = `local:${base}`;
    result.repoDisplayName = base;
  }

  return result;
}

/**
 * Enrich a list of raw projects with grouping metadata.
 * Reads/writes `~/.cloudcli/project-config.json#repoGroups` for caching.
 * Pure-additive: returns a new array with the same project objects plus new
 * fields. Never mutates or removes projects.
 */
export async function group(projects) {
  if (!Array.isArray(projects) || projects.length === 0) return projects;

  const cache = await readCache();
  const groupsCache = cache[CACHE_KEY] && typeof cache[CACHE_KEY] === 'object' ? cache[CACHE_KEY] : {};
  let dirty = false;

  const enriched = await Promise.all(
    projects.map(async (project) => {
      if (!project || typeof project !== 'object' || !project.name) return project;
      const slug = project.name;
      const startPath = project.fullPath || project.path || '';
      const cached = groupsCache[slug];
      if (cached && cached.fullPath === startPath && cached.info) {
        return { ...project, ...cached.info };
      }
      try {
        const info = await computeGroupingFor(project);
        groupsCache[slug] = { fullPath: startPath, info, cachedAt: Date.now() };
        dirty = true;
        return { ...project, ...info };
      } catch (err) {
        console.warn(`[repo-grouper] failed for ${slug}:`, err.message);
        return project;
      }
    }),
  );

  if (dirty) {
    cache[CACHE_KEY] = groupsCache;
    await writeCache(cache);
  }

  return enriched;
}

export const __internal = {
  normalizeOrigin,
  parseRemoteOriginUrl,
  findGitRoot,
  deriveDisplayNameFromKey,
  UNCATEGORIZED_KEY,
};

export default { group, computeGroupingFor, __internal };
