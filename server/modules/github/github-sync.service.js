import { spawn } from 'child_process';
import path from 'path';
import { promises as fsPromises } from 'fs';

import * as github from './github.service.js';

const SYNC_FILE = '.taskmaster/github-sync.json';

// Labels used to represent TaskMaster statuses in GitHub
const TM_STATUS_LABELS = ['in-progress', 'review', 'blocked', 'deferred', 'cancelled'];

export async function readSyncConfig(projectPath) {
    const syncFile = path.join(projectPath, SYNC_FILE);
    try {
        const content = await fsPromises.readFile(syncFile, 'utf8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

export async function writeSyncConfig(projectPath, config) {
    const syncFile = path.join(projectPath, SYNC_FILE);
    await fsPromises.mkdir(path.dirname(syncFile), { recursive: true });
    await fsPromises.writeFile(syncFile, JSON.stringify(config, null, 2), 'utf8');
}

export async function getOrCreateSyncConfig(projectPath, overrides = {}) {
    const existing = await readSyncConfig(projectPath);
    return { tasks: {}, issues: {}, enabled: false, ...existing, ...overrides };
}

function statusToGitHub(status) {
    switch (status) {
        case 'done': return { state: 'closed', statusLabel: null };
        case 'cancelled': return { state: 'closed', statusLabel: 'cancelled' };
        case 'in-progress': return { state: 'open', statusLabel: 'in-progress' };
        case 'review': return { state: 'open', statusLabel: 'review' };
        case 'blocked': return { state: 'open', statusLabel: 'blocked' };
        case 'deferred': return { state: 'open', statusLabel: 'deferred' };
        default: return { state: 'open', statusLabel: null }; // pending/todo
    }
}

function githubToStatus(issue) {
    if (issue.state === 'closed') {
        const labels = issue.labels?.map(l => l.name) || [];
        return labels.includes('cancelled') ? 'cancelled' : 'done';
    }
    const labels = issue.labels?.map(l => l.name) || [];
    for (const label of TM_STATUS_LABELS) {
        if (labels.includes(label)) return label;
    }
    return 'pending';
}

function buildIssueLabels(task, currentIssueLabels = []) {
    // Keep non-TM labels, replace TM status labels
    const { statusLabel } = statusToGitHub(task.status);
    const preserved = currentIssueLabels
        .map(l => (typeof l === 'string' ? l : l.name))
        .filter(l => !TM_STATUS_LABELS.includes(l));
    return statusLabel ? [...preserved, statusLabel] : preserved;
}

function taskToIssueBody(task) {
    const lines = [];
    if (task.description) lines.push(task.description);
    if (task.details) lines.push('', '---', task.details);
    if (task.priority) lines.push('', `**Priority:** ${task.priority}`);
    if (task.id) lines.push(`<!-- tm-task-id: ${task.id} -->`);
    return lines.join('\n');
}

// Read tasks.json from the project
async function readTasks(projectPath) {
    const tasksFile = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
    try {
        const content = await fsPromises.readFile(tasksFile, 'utf8');
        const data = JSON.parse(content);
        if (Array.isArray(data)) return data;
        if (data.tasks) return data.tasks;
        // Tagged format
        const tag = data.master ? 'master' : Object.keys(data)[0];
        return data[tag]?.tasks || [];
    } catch {
        return [];
    }
}

// Push one task → GitHub (create or update issue)
export async function syncTaskToGitHub(projectPath, taskId) {
    const config = await readSyncConfig(projectPath);
    if (!config?.enabled || !config.token || !config.owner || !config.repo) return null;

    const tasks = await readTasks(projectPath);
    const task = tasks.find(t => String(t.id) === String(taskId));
    if (!task) return null;

    const { state, statusLabel } = statusToGitHub(task.status);
    const mapping = config.tasks?.[String(taskId)];

    try {
        if (mapping?.issueNumber) {
            // Update existing issue
            const currentIssue = await github.getIssue(config.token, config.owner, config.repo, mapping.issueNumber);
            const labels = buildIssueLabels(task, currentIssue.labels);
            await github.updateIssue(config.token, config.owner, config.repo, mapping.issueNumber, {
                title: task.title,
                body: taskToIssueBody(task),
                state,
                labels,
            });
            return mapping;
        } else {
            // Create new issue
            const labels = statusLabel ? [statusLabel] : [];
            const issue = await github.createIssue(config.token, config.owner, config.repo, {
                title: task.title,
                body: taskToIssueBody(task),
                labels,
            });

            // Update mapping
            const updatedConfig = { ...config };
            updatedConfig.tasks = { ...updatedConfig.tasks, [String(taskId)]: { issueNumber: issue.number, issueUrl: issue.html_url } };
            updatedConfig.issues = { ...updatedConfig.issues, [String(issue.number)]: String(taskId) };
            await writeSyncConfig(projectPath, updatedConfig);

            return { issueNumber: issue.number, issueUrl: issue.html_url };
        }
    } catch (err) {
        console.error(`[GitHub Sync] syncTaskToGitHub task=${taskId}:`, err.message);
        return null;
    }
}

// Push all unmapped tasks → GitHub (called after add-task or parse-prd)
export async function syncNewTasksToGitHub(projectPath) {
    const config = await readSyncConfig(projectPath);
    if (!config?.enabled || !config.token || !config.owner || !config.repo) return;

    const tasks = await readTasks(projectPath);
    const mapped = new Set(Object.keys(config.tasks || {}));
    const newTasks = tasks.filter(t => !mapped.has(String(t.id)));

    for (const task of newTasks) {
        await syncTaskToGitHub(projectPath, task.id);
    }
}

// Update a task's status from a GitHub issue event
// broadcastFn is optional: (wss, projectId) => void — caller provides to avoid boundary violations
export async function applyIssueToTask(projectPath, issueNumber, issueData, wss, projectId, broadcastFn) {
    const config = await readSyncConfig(projectPath);
    if (!config) return null;

    const taskId = config.issues?.[String(issueNumber)];
    if (!taskId) return null; // Not a TM-managed issue

    const newStatus = githubToStatus(issueData);

    await new Promise((resolve) => {
        const proc = spawn('task-master', ['set-status', `--id=${taskId}`, `--status=${newStatus}`], {
            cwd: projectPath,
            stdio: 'pipe',
        });
        proc.on('close', resolve);
    });

    if (wss && projectId && broadcastFn) {
        broadcastFn(wss, projectId);
    }

    return { taskId, newStatus };
}

// Full push sync: all tasks → GitHub (create or update issues)
export async function fullSyncToGitHub(projectPath) {
    const config = await readSyncConfig(projectPath);
    if (!config?.enabled || !config.token || !config.owner || !config.repo) {
        throw new Error('GitHub sync not configured');
    }

    const tasks = await readTasks(projectPath);
    const results = [];

    for (const task of tasks) {
        const result = await syncTaskToGitHub(projectPath, task.id);
        results.push({ taskId: task.id, ...result });
    }

    // Update lastSync
    const updated = await readSyncConfig(projectPath);
    if (updated) {
        await writeSyncConfig(projectPath, { ...updated, lastSync: new Date().toISOString() });
    }

    return results;
}
