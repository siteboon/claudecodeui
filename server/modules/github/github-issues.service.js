import * as github from './github.service.js';
import { cacheGet, cacheSet, cacheDeletePrefix } from './github-cache.js';
import { readSyncConfig } from './github-sync.service.js';

const ISSUES_TTL = 60_000;   // 60s
const COMMENTS_TTL = 30_000; // 30s

const STATUS_LABELS = ['in-progress', 'review', 'blocked', 'deferred', 'cancelled'];

export const COLUMNS = [
    { id: 'todo',        title: 'To Do',       state: 'open',   labels: [],              color: 'border-slate-400/50 bg-slate-200 dark:border-slate-600/50 dark:bg-slate-800/60',              headerColor: 'bg-slate-300/80 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300' },
    { id: 'in-progress', title: 'In Progress',  state: 'open',   labels: ['in-progress'], color: 'border-sky-200/60 bg-sky-50/30 dark:border-sky-800/40 dark:bg-sky-950/20',              headerColor: 'bg-sky-50/60 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400' },
    { id: 'review',      title: 'In Review',    state: 'open',   labels: ['review'],      color: 'border-violet-200/60 bg-violet-50/30 dark:border-violet-800/40 dark:bg-violet-950/20',  headerColor: 'bg-violet-50/60 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400' },
    { id: 'blocked',     title: 'Blocked',      state: 'open',   labels: ['blocked'],     color: 'border-rose-200/60 bg-rose-50/30 dark:border-rose-800/40 dark:bg-rose-950/20',          headerColor: 'bg-rose-50/60 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400' },
    { id: 'done',        title: 'Done',         state: 'closed', labels: [],              color: 'border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-800/40 dark:bg-emerald-950/20', headerColor: 'bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400' },
];

export function issueToColumn(issue) {
    if (issue.state === 'closed') return 'done';
    const labelNames = (issue.labels || []).map(l => l.name);
    for (const col of COLUMNS) {
        if (col.labels.length > 0 && col.labels.some(l => labelNames.includes(l))) {
            return col.id;
        }
    }
    return 'todo';
}

export async function fetchIssues(projectPath) {
    const config = await readSyncConfig(projectPath);
    if (!config?.token || !config?.owner || !config?.repo) {
        throw new Error('GitHub not configured for this project');
    }

    const cacheKey = `issues:${config.owner}/${config.repo}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const raw = await github.listIssues(config.token, config.owner, config.repo, 'all');
    const issues = raw.filter(i => !i.pull_request);

    const result = { issues, owner: config.owner, repo: config.repo };
    cacheSet(cacheKey, result, ISSUES_TTL);
    return result;
}

export async function fetchComments(projectPath, issueNumber) {
    const config = await readSyncConfig(projectPath);
    if (!config?.token || !config?.owner || !config?.repo) return [];

    const cacheKey = `comments:${config.owner}/${config.repo}:${issueNumber}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const comments = await github.listIssueComments(config.token, config.owner, config.repo, issueNumber);
    cacheSet(cacheKey, comments, COMMENTS_TTL);
    return comments;
}

export async function patchIssue(projectPath, issueNumber, { state, addLabels, removeLabels, title, labels }) {
    const config = await readSyncConfig(projectPath);
    if (!config?.token || !config?.owner || !config?.repo) throw new Error('Not configured');

    const patch = {};
    if (state !== undefined) patch.state = state;
    if (title !== undefined) patch.title = title;

    if (labels !== undefined) {
        // Direct label replacement — used by priority setter and AI prioritize
        patch.labels = labels;
    } else if (addLabels || removeLabels) {
        const current = await github.getIssue(config.token, config.owner, config.repo, issueNumber);
        const currentLabels = (current.labels || []).map(l => l.name);
        const filtered = currentLabels.filter(l => !(removeLabels || []).includes(l));
        patch.labels = [...new Set([...filtered, ...(addLabels || [])])];
    }

    const updated = await github.updateIssue(config.token, config.owner, config.repo, issueNumber, patch);

    // Invalidate cache
    cacheDeletePrefix(`issues:${config.owner}/${config.repo}`);

    return updated;
}

export function columnChange(fromColumnId, toColumnId) {
    const fromCol = COLUMNS.find(c => c.id === fromColumnId);
    const toCol = COLUMNS.find(c => c.id === toColumnId);
    if (!toCol) return null;

    return {
        state: toCol.state,
        addLabels: toCol.labels,
        removeLabels: fromCol ? STATUS_LABELS.filter(l => !toCol.labels.includes(l)) : STATUS_LABELS,
    };
}
