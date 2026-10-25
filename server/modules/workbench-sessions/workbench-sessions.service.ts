import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { worktreeServices } from '@/modules/worktrees/index.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';
import { git, gitOrNull, parseUnifiedDiff, type DiffFile } from '@/modules/workbench-sessions/workbench-git.js';
import {
  workbenchSessionsStore,
  type WorkbenchAgent,
  type WorkbenchSession,
} from '@/modules/workbench-sessions/workbench-sessions.store.js';

export type CreateSessionInput = {
  projectPath: string;
  baseBranch?: string | null;
  agent: WorkbenchAgent;
  profileId?: string | null;
  prompt: string;
  title?: string | null;
};

export type SessionView = WorkbenchSession & {
  dirtyFiles: number;
  ahead: number;
  unpushed: number;
  hasUpstream: boolean;
  worktreeExists: boolean;
};

/** Where new worktrees go: `<worktreesRoot>/<repoName>/<slug>`; default is a `.worktrees` folder next to the repo. */
export function resolveWorktreesRoot(repoRoot: string): string {
  const configured = process.env.WORKBENCH_WORKTREES_ROOT?.trim();
  return configured ? path.resolve(configured) : path.join(path.dirname(repoRoot), '.worktrees');
}

/** Short filesystem- and branch-safe slug from a title or prompt. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'task';
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Root of the main worktree of the repository containing `projectPath`. */
async function resolveRepoRoot(projectPath: string): Promise<string> {
  let out: string;
  try {
    out = (await git(['worktree', 'list', '--porcelain'], projectPath)).stdout;
  } catch {
    throw new AppError('Not a git repository', { code: 'NOT_A_GIT_REPOSITORY', statusCode: 400 });
  }
  const first = out.split('\n').find((line) => line.startsWith('worktree '));
  if (!first) {
    throw new AppError('Not a git repository', { code: 'NOT_A_GIT_REPOSITORY', statusCode: 400 });
  }
  return normalizeProjectPath(first.slice('worktree '.length).trim());
}

async function chooseSlug(repoRoot: string, wanted: string, worktreesDir: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const slug = attempt === 0 ? wanted : `${wanted}-${attempt + 1}`;
    const branchTaken = (await gitOrNull(['rev-parse', '--verify', '--quiet', `refs/heads/ws/${slug}`], repoRoot)) !== null;
    if (!branchTaken && !(await pathExists(path.join(worktreesDir, slug)))) {
      return slug;
    }
  }
  throw new AppError('Could not find a free session name', { code: 'SLUG_EXHAUSTED', statusCode: 409 });
}

/** Copies top-level `.env*` files (untracked, so absent from the new worktree). */
async function copyEnvFiles(repoRoot: string, worktreePath: string, patterns: string[] | null): Promise<string[]> {
  const copied: string[] = [];
  const entries = await readdir(repoRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const matches = patterns
      ? patterns.includes(entry.name)
      : entry.name === '.env' || entry.name.startsWith('.env.');
    if (!matches) continue;
    const target = path.join(worktreePath, entry.name);
    if (await pathExists(target)) continue;
    await copyFile(path.join(repoRoot, entry.name), target);
    copied.push(entry.name);
  }
  return copied;
}

export async function createSession(input: CreateSessionInput): Promise<WorkbenchSession> {
  if (input.agent !== 'claude' && input.agent !== 'codex') {
    throw new AppError('agent must be "claude" or "codex"', { code: 'INVALID_AGENT', statusCode: 400 });
  }
  const prompt = input.prompt?.trim() ?? '';
  const repoRoot = await resolveRepoRoot(normalizeProjectPath(input.projectPath));

  let baseBranch = input.baseBranch?.trim() || '';
  if (!baseBranch) {
    baseBranch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)).stdout.trim();
  }
  if (!baseBranch || baseBranch === 'HEAD') {
    throw new AppError('Repository is on a detached HEAD — pick a base branch', {
      code: 'BASE_BRANCH_REQUIRED',
      statusCode: 400,
    });
  }
  await git(['rev-parse', '--verify', '--quiet', `refs/heads/${baseBranch}`], repoRoot).catch(() => {
    throw new AppError(`Base branch "${baseBranch}" does not exist`, { code: 'BASE_BRANCH_UNKNOWN', statusCode: 400 });
  });

  const title = input.title?.trim() || prompt.split('\n')[0].slice(0, 60) || 'New session';
  const worktreesDir = path.join(resolveWorktreesRoot(repoRoot), path.basename(repoRoot));
  const slug = await chooseSlug(repoRoot, slugify(input.title?.trim() || prompt), worktreesDir);
  const branch = `ws/${slug}`;
  let worktreePath = normalizeProjectPath(path.join(worktreesDir, slug));

  await mkdir(worktreesDir, { recursive: true });
  await git(['worktree', 'add', worktreePath, '-b', branch, baseBranch], repoRoot);
  // Store the path exactly as git reports it (long names, casing), since later comparisons use it.
  const listing = (await git(['worktree', 'list', '--porcelain'], repoRoot)).stdout.split(/\r?\n\r?\n/);
  const reported = listing.find((block) => block.includes(`branch refs/heads/${branch}`));
  const reportedPath = reported?.split(/\r?\n/).find((line) => line.startsWith('worktree '));
  if (reportedPath) {
    worktreePath = normalizeProjectPath(reportedPath.slice('worktree '.length).trim());
  }

  try {
    await copyEnvFiles(repoRoot, worktreePath, null);
    let projectId: string | null = null;
    try {
      const project = await worktreeServices.open({ projectPath: repoRoot, worktreePath });
      projectId = project.projectId;
    } catch {
      // The session works without a sidebar project entry; the terminal only needs the path.
    }
    return workbenchSessionsStore.insert({
      projectPath: repoRoot,
      projectId,
      worktreePath,
      branch,
      baseBranch,
      agent: input.agent,
      profileId: input.profileId?.trim() || 'none',
      title,
      firstPrompt: prompt,
    });
  } catch (error) {
    // Roll back only what this call created.
    await git(['worktree', 'remove', '--force', worktreePath], repoRoot).catch(() => undefined);
    await git(['branch', '-D', branch], repoRoot).catch(() => undefined);
    throw error;
  }
}

async function requireSession(id: string): Promise<WorkbenchSession> {
  const session = workbenchSessionsStore.get(id);
  if (!session || session.status === 'discarded') {
    throw new AppError('Session not found', { code: 'SESSION_NOT_FOUND', statusCode: 404 });
  }
  return session;
}

async function toView(session: WorkbenchSession): Promise<SessionView> {
  const worktreeExists = await pathExists(session.worktreePath);
  if (!worktreeExists) {
    return { ...session, dirtyFiles: 0, ahead: 0, unpushed: 0, hasUpstream: false, worktreeExists };
  }
  const status = await gitOrNull(['status', '--porcelain'], session.worktreePath);
  const dirtyFiles = status ? status.split('\n').filter((line) => line.trim()).length : 0;
  const ahead = Number.parseInt((await gitOrNull(['rev-list', '--count', `${session.baseBranch}..${session.branch}`], session.worktreePath)) ?? '0', 10) || 0;
  const upstreamCount = await gitOrNull(['rev-list', '--count', `${session.branch}@{upstream}..${session.branch}`], session.worktreePath);
  const hasUpstream = upstreamCount !== null;
  const unpushed = hasUpstream ? Number.parseInt(upstreamCount, 10) || 0 : ahead;
  return { ...session, dirtyFiles, ahead, unpushed, hasUpstream, worktreeExists };
}

export async function listSessions(): Promise<SessionView[]> {
  return Promise.all(workbenchSessionsStore.list().map(toView));
}

export async function getSessionView(id: string): Promise<SessionView> {
  return toView(await requireSession(id));
}

export type SessionDiff = {
  baseBranch: string;
  branch: string;
  committed: DiffFile[];
  uncommitted: DiffFile[];
  untracked: string[];
};

export async function getDiff(id: string): Promise<SessionDiff> {
  const session = await requireSession(id);
  const cwd = session.worktreePath;
  const committed = parseUnifiedDiff(
    (await git(['diff', '--no-color', `${session.baseBranch}...${session.branch}`], cwd)).stdout,
  );
  const uncommitted = parseUnifiedDiff((await git(['diff', '--no-color', 'HEAD'], cwd)).stdout);
  const untracked = (await git(['ls-files', '--others', '--exclude-standard'], cwd)).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { baseBranch: session.baseBranch, branch: session.branch, committed, uncommitted, untracked };
}

export async function commitSession(id: string, message: string): Promise<{ commit: string }> {
  const session = await requireSession(id);
  const text = message?.trim();
  if (!text) {
    throw new AppError('Commit message is required', { code: 'MESSAGE_REQUIRED', statusCode: 400 });
  }
  await git(['add', '-A'], session.worktreePath);
  const staged = (await git(['diff', '--cached', '--name-only'], session.worktreePath)).stdout.trim();
  if (!staged) {
    throw new AppError('Nothing to commit', { code: 'NOTHING_TO_COMMIT', statusCode: 409 });
  }
  await git(['commit', '-m', text], session.worktreePath);
  const commit = (await git(['rev-parse', '--short', 'HEAD'], session.worktreePath)).stdout.trim();
  return { commit };
}

export async function rebaseSession(id: string): Promise<{ rebasedOnto: string }> {
  const session = await requireSession(id);
  const dirty = (await git(['status', '--porcelain'], session.worktreePath)).stdout.trim();
  if (dirty) {
    throw new AppError('Commit or discard uncommitted changes before rebasing', {
      code: 'WORKTREE_DIRTY',
      statusCode: 409,
    });
  }
  try {
    await git(['rebase', session.baseBranch], session.worktreePath);
  } catch (error) {
    const conflicts = (await gitOrNull(['diff', '--name-only', '--diff-filter=U'], session.worktreePath)) ?? '';
    await git(['rebase', '--abort'], session.worktreePath).catch(() => undefined);
    throw new AppError(`Rebase onto ${session.baseBranch} hit conflicts — it was aborted`, {
      code: 'REBASE_CONFLICT',
      statusCode: 409,
      details: conflicts.split('\n').filter(Boolean).length
        ? conflicts.split('\n').filter(Boolean)
        : (error instanceof AppError ? error.details : String(error)),
    });
  }
  return { rebasedOnto: session.baseBranch };
}

export async function mergeSession(
  id: string,
  options: { confirm: boolean; message?: string | null },
): Promise<{ mergedBranch: string; targetBranch: string }> {
  if (!options.confirm) {
    throw new AppError('Merging into the base branch needs explicit confirmation', {
      code: 'CONFIRMATION_REQUIRED',
      statusCode: 400,
    });
  }
  const session = await requireSession(id);
  const repoRoot = await resolveRepoRoot(session.projectPath);
  const current = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)).stdout.trim();
  if (current !== session.baseBranch) {
    throw new AppError(
      `The main worktree is on "${current}", not the base branch "${session.baseBranch}" — switch it first`,
      { code: 'BASE_NOT_CHECKED_OUT', statusCode: 409 },
    );
  }
  // The shared worktree service also refuses a dirty main worktree and rolls back conflicts.
  const result = await worktreeServices.merge({
    projectPath: repoRoot,
    worktreePath: session.worktreePath,
    squash: true,
    message: options.message?.trim() || `${session.title} (${session.branch})`,
    removeAfterMerge: false,
  });
  return { mergedBranch: result.mergedBranch, targetBranch: result.targetBranch };
}

export async function pushSession(id: string): Promise<{ branch: string }> {
  const session = await requireSession(id);
  // Plain push only: never forced.
  await git(['push', '-u', 'origin', session.branch], session.worktreePath);
  return { branch: session.branch };
}

export type DiscardPreview = {
  branch: string;
  worktreePath: string;
  dirtyFiles: number;
  unmergedCommits: number;
};

export async function getDiscardPreview(id: string): Promise<DiscardPreview> {
  const view = await getSessionView(id);
  return {
    branch: view.branch,
    worktreePath: view.worktreePath,
    dirtyFiles: view.dirtyFiles,
    unmergedCommits: view.ahead,
  };
}

export async function discardSession(id: string, confirm: boolean): Promise<{ removedPath: string; branch: string }> {
  if (!confirm) {
    throw new AppError('Discarding deletes the worktree and branch and needs explicit confirmation', {
      code: 'CONFIRMATION_REQUIRED',
      statusCode: 400,
    });
  }
  const session = await requireSession(id);
  const repoRoot = await resolveRepoRoot(session.projectPath);
  if (await pathExists(session.worktreePath)) {
    await worktreeServices.remove({
      projectPath: repoRoot,
      worktreePath: session.worktreePath,
      force: true,
      deleteBranch: true,
    });
  } else {
    await git(['worktree', 'prune'], repoRoot).catch(() => undefined);
    await git(['branch', '-D', session.branch], repoRoot).catch(() => undefined);
  }
  workbenchSessionsStore.markDiscarded(session.id);
  return { removedPath: session.worktreePath, branch: session.branch };
}

/** Newest CLI session recorded (read-only, from the app's own index) for this worktree. */
export function findCliSessionId(session: WorkbenchSession): string | null {
  if (session.cliSessionId) return session.cliSessionId;
  const rows = sessionsDb
    .getSessionsByProjectPathIncludingArchived(session.worktreePath)
    .filter((row) => row.provider === session.agent && row.provider_session_id)
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  return rows[0]?.provider_session_id ?? null;
}

export function homeDataDir(): string {
  return path.join(os.homedir(), '.workbench');
}
