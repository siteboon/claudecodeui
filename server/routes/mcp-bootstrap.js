/**
 * MCP BOOTSTRAP ROUTES
 * ====================
 *
 * Ensures Dispatch's two recommended MCP servers are registered in
 * `~/.claude.json` on boot (unless the user has previously toggled them off),
 * and exposes HTTP endpoints for listing, toggling, and spawning sub-agents.
 *
 * Dispatch-only module. Touches `~/.claude.json` additively (never removes
 * unrelated MCP servers) and keeps a companion `~/.claude/dispatch-recommended-mcps.json`
 * to track user dismissals so the bootstrap doesn't re-add things the user
 * explicitly turned off.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import express from 'express';

const router = express.Router();

const CLAUDE_CONFIG_PATH = path.join(os.homedir(), '.claude.json');
const DISPATCH_STATE_DIR = path.join(os.homedir(), '.claude');
const DISPATCH_STATE_PATH = path.join(DISPATCH_STATE_DIR, 'dispatch-recommended-mcps.json');

export const RECOMMENDED_MCPS = {
    'codebase-memory-mcp': {
        displayName: 'Codebase Memory',
        description: 'Repo indexer with knowledge graph. Adds "files touched" signals to sidebar conversations.',
        repoUrl: 'https://github.com/DeusData/codebase-memory-mcp',
        stars: '1.7k',
        config: {
            command: 'npx',
            args: ['-y', '@deusdata/codebase-memory-mcp'],
        },
    },
    'claude-code-mcp': {
        displayName: 'Claude Code Sub-agent',
        description: 'Exposes Claude Code as an MCP server. Enables the "Spawn sub-agent" composer button.',
        repoUrl: 'https://github.com/steipete/claude-code-mcp',
        stars: '1.2k',
        config: {
            command: 'npx',
            args: ['-y', '@steipete/claude-code-mcp'],
        },
    },
};

async function readJsonIfExists(filepath) {
    try {
        const raw = await fs.readFile(filepath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

async function writeJsonAtomic(filepath, data) {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    const tmp = `${filepath}.tmp-${process.pid}`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, filepath);
}

async function readDispatchState() {
    const state = await readJsonIfExists(DISPATCH_STATE_PATH);
    return state && typeof state === 'object' ? state : {};
}

async function writeDispatchState(state) {
    await writeJsonAtomic(DISPATCH_STATE_PATH, state);
}

async function readClaudeConfig() {
    return (await readJsonIfExists(CLAUDE_CONFIG_PATH)) || {};
}

// Returns true only when ~/.claude.json already exists. Bootstrap refuses to
// materialize a brand-new config for users who have never run Claude — the
// recommended-MCPs entries would be the *only* keys in that file, which the
// user did not opt into. Once Claude itself is installed, the file appears
// and the bootstrap may run on the next boot.
async function claudeConfigExists() {
    try {
        await fs.access(CLAUDE_CONFIG_PATH);
        return true;
    } catch (err) {
        if (err && err.code === 'ENOENT') return false;
        throw err;
    }
}

const ALLOWED_WORKING_DIR_ROOTS = (() => {
    const roots = [os.homedir()];
    if (process.env.DISPATCH_PROJECT_ROOTS) {
        for (const candidate of process.env.DISPATCH_PROJECT_ROOTS.split(path.delimiter)) {
            const trimmed = candidate.trim();
            if (trimmed) roots.push(path.resolve(trimmed));
        }
    }
    return roots.map((p) => path.resolve(p));
})();

const SENSITIVE_HOME_SUBDIRS = ['.ssh', '.aws', '.gnupg', '.config/gh', 'Library/Keychains'];

// Returns the resolved absolute path if `input` is a usable working dir for a
// sub-agent spawn, or { error } describing why it isn't. Conservative gate:
// must be absolute, must resolve under HOME (or DISPATCH_PROJECT_ROOTS), and
// must not point at well-known credential stores.
async function resolveSafeWorkingDir(input) {
    if (typeof input !== 'string' || !input.trim()) {
        return { error: 'workingDir must be a non-empty string' };
    }
    if (input.includes('\0')) {
        return { error: 'workingDir contains a null byte' };
    }
    const resolved = path.resolve(input);
    const homeDir = path.resolve(os.homedir());
    const underAllowedRoot = ALLOWED_WORKING_DIR_ROOTS.some((root) => {
        return resolved === root || resolved.startsWith(root + path.sep);
    });
    if (!underAllowedRoot) {
        return { error: 'workingDir must be under $HOME or DISPATCH_PROJECT_ROOTS' };
    }
    for (const subdir of SENSITIVE_HOME_SUBDIRS) {
        const sensitive = path.resolve(homeDir, subdir);
        if (resolved === sensitive || resolved.startsWith(sensitive + path.sep)) {
            return { error: `workingDir resolves to a sensitive directory (${subdir})` };
        }
    }
    try {
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) return { error: 'workingDir is not a directory' };
    } catch {
        return { error: 'workingDir does not exist' };
    }
    return { path: resolved };
}

async function writeClaudeConfig(config) {
    await writeJsonAtomic(CLAUDE_CONFIG_PATH, config);
}

function installedInConfig(config, name) {
    return Boolean(config && config.mcpServers && config.mcpServers[name]);
}

/**
 * On server boot, install recommended MCPs into `~/.claude.json` unless:
 *   - they're already configured (under any command/URL)
 *   - the user has previously dismissed them via the toggle API
 *
 * Non-throwing — if `~/.claude.json` is malformed, we log and skip. This
 * function is safe to call multiple times; it's idempotent.
 */
export async function ensureRecommendedMCPs() {
    const state = await readDispatchState();
    if (!(await claudeConfigExists())) {
        // First-run users without Claude installed — do not materialize a
        // ~/.claude.json containing only Dispatch's two MCPs. They get added
        // on a later boot once the user has actually run Claude.
        return { added: [], state, skipped: 'no-claude-config' };
    }
    let config;
    try {
        config = await readClaudeConfig();
    } catch (err) {
        console.error(
            `[mcp-bootstrap] ${CLAUDE_CONFIG_PATH} is unreadable or not valid JSON — refusing to rewrite. Fix the file and restart to re-enable bootstrap. Error: ${err.message}`,
        );
        return { added: [], state, skipped: true };
    }
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        config.mcpServers = {};
    }

    const added = [];
    for (const [name, entry] of Object.entries(RECOMMENDED_MCPS)) {
        const record = state[name] || {};
        if (record.userDismissed) {
            continue;
        }
        if (installedInConfig(config, name)) {
            state[name] = { ...record, installedByDispatch: record.installedByDispatch || false };
            continue;
        }
        config.mcpServers[name] = entry.config;
        state[name] = { installedByDispatch: true, userDismissed: false, installedAt: new Date().toISOString() };
        added.push(name);
    }

    if (added.length > 0) {
        await writeClaudeConfig(config);
        console.log(`[mcp-bootstrap] registered recommended MCPs: ${added.join(', ')}`);
    }
    await writeDispatchState(state);
    return { added, state };
}

async function describeRecommendedMCPs() {
    const state = await readDispatchState();
    let config;
    try {
        config = await readClaudeConfig();
    } catch {
        // Surface the server-side error in the log but keep the API shape stable
        // so the Settings page can still render (items show installed=false).
        config = {};
    }
    return Object.entries(RECOMMENDED_MCPS).map(([name, meta]) => {
        const record = state[name] || {};
        return {
            name,
            displayName: meta.displayName,
            description: meta.description,
            repoUrl: meta.repoUrl,
            stars: meta.stars,
            installed: installedInConfig(config, name),
            userDismissed: Boolean(record.userDismissed),
            installedByDispatch: Boolean(record.installedByDispatch),
        };
    });
}

router.get('/recommended', async (req, res) => {
    try {
        const list = await describeRecommendedMCPs();
        res.json({ items: list });
    } catch (err) {
        console.error('[mcp-bootstrap] list failed:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/recommended/:name/toggle', async (req, res) => {
    const { name } = req.params;
    if (!RECOMMENDED_MCPS[name]) {
        return res.status(404).json({ error: `Unknown MCP: ${name}` });
    }
    const { enabled } = req.body || {};
    try {
        let config;
        try {
            config = await readClaudeConfig();
        } catch (err) {
            return res.status(409).json({
                error: `${CLAUDE_CONFIG_PATH} is unreadable or not valid JSON. Fix the file before toggling MCPs: ${err.message}`,
            });
        }
        if (!config.mcpServers || typeof config.mcpServers !== 'object') {
            config.mcpServers = {};
        }
        const state = await readDispatchState();
        const record = state[name] || {};

        if (enabled) {
            config.mcpServers[name] = RECOMMENDED_MCPS[name].config;
            state[name] = {
                ...record,
                userDismissed: false,
                installedByDispatch: true,
                installedAt: record.installedAt || new Date().toISOString(),
            };
        } else {
            if (config.mcpServers[name]) {
                delete config.mcpServers[name];
            }
            state[name] = { ...record, userDismissed: true };
        }

        await writeClaudeConfig(config);
        await writeDispatchState(state);
        const list = await describeRecommendedMCPs();
        return res.json({ items: list });
    } catch (err) {
        console.error('[mcp-bootstrap] toggle failed:', err);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * Spawn a sub-agent and stream its output via Server-Sent Events. The client
 * calls this from the composer modal; output shows up live in the modal and
 * can be copied back into the parent chat.
 *
 * Uses `claude` CLI directly in headless/print mode. If claude-code-mcp is
 * configured, the sub-agent sees it as an available tool.
 */
router.post('/spawn-sub-agent', async (req, res) => {
    const subAgentType = typeof req.body?.subAgentType === 'string' ? req.body.subAgentType : 'general-purpose';
    const userPrompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
    const requestedWorkingDir = typeof req.body?.workingDir === 'string' && req.body.workingDir
        ? req.body.workingDir
        : process.cwd();

    const validated = await resolveSafeWorkingDir(requestedWorkingDir);
    if (validated.error) {
        return res.status(400).json({ error: `Invalid workingDir: ${validated.error}` });
    }
    const workingDir = validated.path;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    const writeEvent = (type, data) => {
        try {
            res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
            // client closed; ignore
        }
    };

    const promptText = [
        `[Dispatch sub-agent of type: ${subAgentType}]`,
        '',
        userPrompt,
    ].join('\n').trim();

    writeEvent('start', { subAgentType, workingDir, promptLength: promptText.length });

    let child;
    try {
        child = spawn('claude', ['-p', promptText], {
            cwd: workingDir,
            env: { ...process.env },
        });
    } catch (err) {
        writeEvent('error', { message: `Failed to spawn claude: ${err.message}` });
        return res.end();
    }

    child.stdout.on('data', (buf) => writeEvent('stdout', { chunk: buf.toString('utf8') }));
    child.stderr.on('data', (buf) => writeEvent('stderr', { chunk: buf.toString('utf8') }));
    child.on('close', (code) => {
        writeEvent('done', { code });
        res.end();
    });
    child.on('error', (err) => {
        writeEvent('error', { message: err.message });
        res.end();
    });

    req.on('close', () => {
        if (child && !child.killed) {
            child.kill('SIGTERM');
        }
    });
});

/**
 * Derive "files touched" from a session's JSONL transcript. Returns the top
 * files by tool-use count. Falls back gracefully to an empty list when the
 * JSONL is missing or unreadable so the sidebar never breaks.
 */
router.get('/session-files-touched/:projectName/:sessionId', async (req, res) => {
    const { projectName, sessionId } = req.params;
    // Reject any traversal/null bytes BEFORE building the path. The subsequent
    // path.resolve + prefix check is defense-in-depth.
    const unsafe = /[\\/]|\0|\.\./;
    if (unsafe.test(projectName) || unsafe.test(sessionId) || !projectName || !sessionId) {
        return res.status(400).json({ error: 'Invalid projectName or sessionId' });
    }
    const projectsRoot = path.resolve(os.homedir(), '.claude', 'projects');
    const jsonlPath = path.resolve(projectsRoot, projectName, `${sessionId}.jsonl`);
    if (!jsonlPath.startsWith(`${projectsRoot}${path.sep}`)) {
        return res.status(400).json({ error: 'Path escapes projects root' });
    }
    try {
        const content = await fs.readFile(jsonlPath, 'utf8');
        const counts = new Map();
        for (const rawLine of content.split('\n')) {
            if (!rawLine.trim()) {
                continue;
            }
            let msg;
            try {
                msg = JSON.parse(rawLine);
            } catch {
                continue;
            }
            const blocks = msg?.message?.content;
            if (!Array.isArray(blocks)) {
                continue;
            }
            for (const block of blocks) {
                if (!block || block.type !== 'tool_use' || !block.input) {
                    continue;
                }
                const toolName = block.name;
                if (!['Read', 'Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(toolName)) {
                    continue;
                }
                const filePath = block.input.file_path || block.input.path;
                if (!filePath || typeof filePath !== 'string') {
                    continue;
                }
                counts.set(filePath, (counts.get(filePath) || 0) + 1);
            }
        }
        const top = Array.from(counts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 4)
            .map(([fullPath, count]) => ({
                fullPath,
                basename: fullPath.split('/').pop() || fullPath,
                count,
            }));
        return res.json({ files: top, totalUnique: counts.size });
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return res.json({ files: [], totalUnique: 0 });
        }
        console.error('[mcp-bootstrap] files-touched failed:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Kick off bootstrap as a module-level side-effect so `import` in server/index.js
// registers the MCPs without needing a second wiring line. Deferred via
// setImmediate so the import chain is not blocked by file IO, and skipped when
// ~/.claude.json doesn't yet exist (see ensureRecommendedMCPs).
setImmediate(() => {
    ensureRecommendedMCPs().catch((err) => {
        console.error('[mcp-bootstrap] ensureRecommendedMCPs failed:', err.message);
    });
});

export default router;
