/**
 * BEADS API ROUTES
 * ================
 * 
 * This module provides API endpoints for Beads issue tracking integration including:
 * - .beads folder detection in project directories
 * - Issue management via bd CLI
 * - Real-time updates via WebSocket
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { extractProjectDirectory } from '../projects.js';
import { broadcastBeadsIssuesUpdate, broadcastBeadsProjectUpdate } from '../utils/beads-websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

/**
 * Check if bd CLI is installed globally
 * @returns {Promise<Object>} Installation status result
 */
async function checkBeadsInstallation() {
    return new Promise((resolve) => {
        const child = spawn('which', ['bd'], { 
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let output = '';
        let errorOutput = '';
        
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0 && output.trim()) {
                const versionChild = spawn('bd', ['version'], { 
                    stdio: ['ignore', 'pipe', 'pipe']
                });
                
                let versionOutput = '';
                
                versionChild.stdout.on('data', (data) => {
                    versionOutput += data.toString();
                });
                
                versionChild.on('close', (versionCode) => {
                    resolve({
                        isInstalled: true,
                        installPath: output.trim(),
                        version: versionCode === 0 ? versionOutput.trim() : 'unknown',
                        reason: null
                    });
                });
                
                versionChild.on('error', () => {
                    resolve({
                        isInstalled: true,
                        installPath: output.trim(),
                        version: 'unknown',
                        reason: null
                    });
                });
            } else {
                resolve({
                    isInstalled: false,
                    installPath: null,
                    version: null,
                    reason: 'bd CLI not found in PATH. Install from https://github.com/steveyegge/beads'
                });
            }
        });
        
        child.on('error', (error) => {
            resolve({
                isInstalled: false,
                installPath: null,
                version: null,
                reason: `Error checking installation: ${error.message}`
            });
        });
    });
}

/**
 * Detect .beads folder presence in a given project directory
 * @param {string} projectPath - Absolute path to project directory
 * @returns {Promise<Object>} Detection result with status and metadata
 */
async function detectBeadsFolder(projectPath) {
    try {
        const beadsPath = path.join(projectPath, '.beads');
        
        try {
            const stats = await fsPromises.stat(beadsPath);
            if (!stats.isDirectory()) {
                return {
                    hasBeads: false,
                    reason: '.beads exists but is not a directory'
                };
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    hasBeads: false,
                    reason: '.beads directory not found'
                };
            }
            throw error;
        }

        const keyFiles = [
            'issues.jsonl',
            'config.yaml',
            'beads.db'
        ];
        
        const fileStatus = {};
        let hasEssentialFiles = false;

        for (const file of keyFiles) {
            const filePath = path.join(beadsPath, file);
            try {
                await fsPromises.access(filePath, fs.constants.R_OK);
                fileStatus[file] = true;
                if (file === 'issues.jsonl' || file === 'beads.db') {
                    hasEssentialFiles = true;
                }
            } catch (error) {
                fileStatus[file] = false;
            }
        }

        let issueMetadata = null;
        if (hasEssentialFiles) {
            try {
                const statusResult = await runBeadsCommand(projectPath, ['status', '--json']);
                if (statusResult.success) {
                    const status = JSON.parse(statusResult.output);
                    issueMetadata = {
                        totalIssues: status.summary?.total || 0,
                        open: status.summary?.open || 0,
                        inProgress: status.summary?.inProgress || 0,
                        blocked: status.summary?.blocked || 0,
                        closed: status.summary?.closed || 0,
                        readyToWork: status.summary?.ready || 0
                    };
                }
            } catch (parseError) {
                console.warn('Failed to parse beads status:', parseError.message);
                issueMetadata = { error: 'Failed to parse beads status' };
            }
        }

        return {
            hasBeads: true,
            hasEssentialFiles,
            files: fileStatus,
            metadata: issueMetadata,
            path: beadsPath
        };

    } catch (error) {
        console.error('Error detecting Beads folder:', error);
        return {
            hasBeads: false,
            reason: `Error checking directory: ${error.message}`
        };
    }
}

/**
 * Run a bd CLI command and return the result
 * @param {string} cwd - Working directory to run the command in
 * @param {string[]} args - Command arguments
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Promise<Object>} Command result
 */
function runBeadsCommand(cwd, args, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const child = spawn('bd', args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // Set up timeout timer
        const timeoutTimer = setTimeout(() => {
            timedOut = true;
            // Try SIGTERM first, then SIGKILL if needed
            child.kill('SIGTERM');
            
            // Force kill with SIGKILL after 5 seconds if still running
            setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
            }, 5000);
        }, timeoutMs);

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            clearTimeout(timeoutTimer);
            if (timedOut) {
                resolve({
                    success: false,
                    code: -2,
                    output: stdout,
                    error: stderr || 'Command timed out after ' + timeoutMs + 'ms'
                });
            } else {
                resolve({
                    success: code === 0,
                    code,
                    output: stdout,
                    error: stderr
                });
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeoutTimer);
            resolve({
                success: false,
                code: -1,
                output: '',
                error: error.message
            });
        });
    });
}

// API Routes

/**
 * GET /api/beads/installation-status
 * Check if bd CLI is installed on the system
 */
router.get('/installation-status', async (req, res) => {
    try {
        const installationStatus = await checkBeadsInstallation();
        
        res.json({
            success: true,
            installation: installationStatus,
            isReady: installationStatus.isInstalled
        });
    } catch (error) {
        console.error('Error checking Beads installation:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check Beads installation status',
            installation: {
                isInstalled: false,
                reason: `Server error: ${error.message}`
            },
            isReady: false
        });
    }
});

/**
 * GET /api/beads/detect/:projectName
 * Detect Beads configuration for a specific project
 */
router.get('/detect/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project path not found',
                projectName,
                message: error.message
            });
        }
        
        try {
            await fsPromises.access(projectPath, fs.constants.R_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'Project path not accessible',
                projectPath,
                projectName,
                message: error.message
            });
        }

        const beadsResult = await detectBeadsFolder(projectPath);

        let status = 'not-configured';
        if (beadsResult.hasBeads && beadsResult.hasEssentialFiles) {
            status = 'configured';
        } else if (beadsResult.hasBeads) {
            status = 'partial';
        }

        const responseData = {
            projectName,
            projectPath,
            status,
            beads: beadsResult,
            timestamp: new Date().toISOString()
        };

        res.json(responseData);

    } catch (error) {
        console.error('Beads detection error:', error);
        res.status(500).json({
            error: 'Failed to detect Beads configuration',
            message: error.message
        });
    }
});

/**
 * GET /api/beads/detect-all
 * Detect Beads configuration for all known projects
 */
router.get('/detect-all', async (req, res) => {
    try {
        const { getProjects } = await import('../projects.js');
        const projects = await getProjects();

        const detectionPromises = projects.map(async (project) => {
            try {
                let projectPath;
                if (project.fullPath) {
                    projectPath = project.fullPath;
                } else {
                    try {
                        projectPath = await extractProjectDirectory(project.name);
                    } catch (error) {
                        throw new Error(`Failed to extract project directory: ${error.message}`);
                    }
                }
                
                const beadsResult = await detectBeadsFolder(projectPath);

                let status = 'not-configured';
                if (beadsResult.hasBeads && beadsResult.hasEssentialFiles) {
                    status = 'configured';
                } else if (beadsResult.hasBeads) {
                    status = 'partial';
                }

                return {
                    projectName: project.name,
                    displayName: project.displayName,
                    projectPath,
                    status,
                    beads: beadsResult
                };
            } catch (error) {
                return {
                    projectName: project.name,
                    displayName: project.displayName,
                    status: 'error',
                    error: error.message
                };
            }
        });

        const results = await Promise.all(detectionPromises);

        res.json({
            projects: results,
            summary: {
                total: results.length,
                configured: results.filter(p => p.status === 'configured').length,
                partial: results.filter(p => p.status === 'partial').length,
                notConfigured: results.filter(p => p.status === 'not-configured').length,
                errors: results.filter(p => p.status === 'error').length
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Bulk Beads detection error:', error);
        res.status(500).json({
            error: 'Failed to detect Beads configuration for projects',
            message: error.message
        });
    }
});

/**
 * GET /api/beads/issues/:projectName
 * List all issues for a project
 */
router.get('/issues/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { status, priority, limit } = req.query;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const args = ['list', '--json'];
        if (status) {
            args.push('--status', status);
        }
        if (priority) {
            args.push('--priority', priority);
        }

        const result = await runBeadsCommand(projectPath, args);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to list issues',
                message: result.error || result.output
            });
        }

        let issues = [];
        try {
            issues = JSON.parse(result.output);
        } catch (parseError) {
            console.warn('Failed to parse beads list output:', parseError.message);
        }

        if (limit && !isNaN(parseInt(limit))) {
            issues = issues.slice(0, parseInt(limit));
        }

        res.json({
            projectName,
            projectPath,
            issues,
            totalIssues: issues.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads list issues error:', error);
        res.status(500).json({
            error: 'Failed to list Beads issues',
            message: error.message
        });
    }
});

/**
 * GET /api/beads/issue/:projectName/:issueId
 * Get details of a specific issue
 */
router.get('/issue/:projectName/:issueId', async (req, res) => {
    try {
        const { projectName, issueId } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['show', issueId, '--json']);

        if (!result.success) {
            return res.status(404).json({
                error: 'Issue not found',
                message: result.error || result.output
            });
        }

        let issue = null;
        try {
            const parsed = JSON.parse(result.output);
            issue = Array.isArray(parsed) ? parsed[0] : parsed;
        } catch (parseError) {
            console.warn('Failed to parse beads show output:', parseError.message);
            return res.status(500).json({
                error: 'Failed to parse issue data',
                message: parseError.message
            });
        }

        res.json({
            projectName,
            projectPath,
            issue,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads show issue error:', error);
        res.status(500).json({
            error: 'Failed to get issue details',
            message: error.message
        });
    }
});

/**
 * POST /api/beads/create/:projectName
 * Create a new issue
 */
router.post('/create/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { title, description, priority, type, parent, deps } = req.body;

        if (!title) {
            return res.status(400).json({
                error: 'Missing required field',
                message: 'title is required'
            });
        }
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const args = ['create', title];
        if (priority) {
            args.push('--priority', priority.toString());
        }
        if (type) {
            args.push('--type', type);
        }
        if (parent) {
            args.push('--parent', parent);
        }
        if (deps && Array.isArray(deps) && deps.length > 0) {
            args.push('--deps', deps.join(','));
        }
        if (description) {
            args.push('--description', description);
        }

        const result = await runBeadsCommand(projectPath, args);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to create issue',
                message: result.error || result.output
            });
        }

        const issueId = result.output.trim().split('\n')[0];

        if (req.app.locals.wss) {
            broadcastBeadsIssuesUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            issueId,
            message: 'Issue created successfully',
            output: result.output,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads create issue error:', error);
        res.status(500).json({
            error: 'Failed to create issue',
            message: error.message
        });
    }
});

/**
 * PUT /api/beads/update/:projectName/:issueId
 * Update an issue
 */
router.put('/update/:projectName/:issueId', async (req, res) => {
    try {
        const { projectName, issueId } = req.params;
        const { status, title, priority, assignee } = req.body;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        if (status) {
            const statusResult = await runBeadsCommand(projectPath, ['update', issueId, '--status', status]);
            if (!statusResult.success) {
                return res.status(500).json({
                    error: 'Failed to update issue status',
                    message: statusResult.error || statusResult.output
                });
            }
        }

        if (title) {
            const titleResult = await runBeadsCommand(projectPath, ['update', issueId, '--title', title]);
            if (!titleResult.success) {
                return res.status(500).json({
                    error: 'Failed to update issue title',
                    message: titleResult.error || titleResult.output
                });
            }
        }

        if (priority !== undefined) {
            const priorityResult = await runBeadsCommand(projectPath, ['update', issueId, '--priority', priority.toString()]);
            if (!priorityResult.success) {
                return res.status(500).json({
                    error: 'Failed to update issue priority',
                    message: priorityResult.error || priorityResult.output
                });
            }
        }

        if (req.app.locals.wss) {
            broadcastBeadsIssuesUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            issueId,
            message: 'Issue updated successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads update issue error:', error);
        res.status(500).json({
            error: 'Failed to update issue',
            message: error.message
        });
    }
});

/**
 * POST /api/beads/close/:projectName/:issueId
 * Close an issue
 */
router.post('/close/:projectName/:issueId', async (req, res) => {
    try {
        const { projectName, issueId } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['close', issueId]);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to close issue',
                message: result.error || result.output
            });
        }

        if (req.app.locals.wss) {
            broadcastBeadsIssuesUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            issueId,
            message: 'Issue closed successfully',
            output: result.output,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads close issue error:', error);
        res.status(500).json({
            error: 'Failed to close issue',
            message: error.message
        });
    }
});

/**
 * POST /api/beads/reopen/:projectName/:issueId
 * Reopen a closed issue
 */
router.post('/reopen/:projectName/:issueId', async (req, res) => {
    try {
        const { projectName, issueId } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['reopen', issueId]);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to reopen issue',
                message: result.error || result.output
            });
        }

        if (req.app.locals.wss) {
            broadcastBeadsIssuesUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            issueId,
            message: 'Issue reopened successfully',
            output: result.output,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads reopen issue error:', error);
        res.status(500).json({
            error: 'Failed to reopen issue',
            message: error.message
        });
    }
});

/**
 * GET /api/beads/ready/:projectName
 * Get ready-to-work issues (no blockers)
 */
router.get('/ready/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['ready', '--json']);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to get ready issues',
                message: result.error || result.output
            });
        }

        let issues = [];
        try {
            issues = JSON.parse(result.output);
        } catch (parseError) {
            console.warn('Failed to parse beads ready output:', parseError.message);
        }

        res.json({
            projectName,
            projectPath,
            issues,
            totalIssues: issues.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads ready issues error:', error);
        res.status(500).json({
            error: 'Failed to get ready issues',
            message: error.message
        });
    }
});

/**
 * POST /api/beads/init/:projectName
 * Initialize Beads in a project
 */
router.post('/init/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const beadsPath = path.join(projectPath, '.beads');
        try {
            await fsPromises.access(beadsPath, fs.constants.F_OK);
            return res.status(400).json({
                error: 'Beads already initialized',
                message: 'Beads is already configured for this project'
            });
        } catch (error) {
            // Directory doesn't exist, we can proceed
        }

        const result = await runBeadsCommand(projectPath, ['init']);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to initialize Beads',
                message: result.error || result.output
            });
        }

        if (req.app.locals.wss) {
            broadcastBeadsProjectUpdate(req.app.locals.wss, projectName, { hasBeads: true, status: 'initialized' });
        }

        res.json({
            projectName,
            projectPath,
            message: 'Beads initialized successfully',
            output: result.output,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads init error:', error);
        res.status(500).json({
            error: 'Failed to initialize Beads',
            message: error.message
        });
    }
});

/**
 * POST /api/beads/sync/:projectName
 * Sync Beads data with git
 */
router.post('/sync/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['sync']);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to sync Beads',
                message: result.error || result.output
            });
        }

        if (req.app.locals.wss) {
            broadcastBeadsIssuesUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            message: 'Beads synced successfully',
            output: result.output,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads sync error:', error);
        res.status(500).json({
            error: 'Failed to sync Beads',
            message: error.message
        });
    }
});

/**
 * GET /api/beads/status/:projectName
 * Get Beads status for a project
 */
router.get('/status/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['status', '--json']);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to get Beads status',
                message: result.error || result.output
            });
        }

        let status = null;
        try {
            status = JSON.parse(result.output);
        } catch (parseError) {
            console.warn('Failed to parse beads status output:', parseError.message);
            status = { raw: result.output };
        }

        res.json({
            projectName,
            projectPath,
            status,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads status error:', error);
        res.status(500).json({
            error: 'Failed to get Beads status',
            message: error.message
        });
    }
});

/**
 * GET /api/beads/children/:projectName/:issueId
 * Get children of an issue (epic)
 */
router.get('/children/:projectName/:issueId', async (req, res) => {
    try {
        const { projectName, issueId } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['children', issueId, '--json']);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to get children',
                message: result.error || result.output
            });
        }

        let children = [];
        try {
            children = JSON.parse(result.output);
        } catch (parseError) {
            console.warn('Failed to parse beads children output:', parseError.message);
        }

        res.json({
            projectName,
            projectPath,
            parentId: issueId,
            children,
            totalChildren: children.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads children error:', error);
        res.status(500).json({
            error: 'Failed to get children',
            message: error.message
        });
    }
});

/**
 * GET /api/beads/dependencies/:projectName/:issueId
 * Get dependencies of an issue
 */
router.get('/dependencies/:projectName/:issueId', async (req, res) => {
    try {
        const { projectName, issueId } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['dep', 'list', issueId, '--json']);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to get dependencies',
                message: result.error || result.output
            });
        }

        let dependencies = [];
        try {
            dependencies = JSON.parse(result.output);
        } catch (parseError) {
            console.warn('Failed to parse beads dep list output:', parseError.message);
        }

        res.json({
            projectName,
            projectPath,
            issueId,
            dependencies,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads dependencies error:', error);
        res.status(500).json({
            error: 'Failed to get dependencies',
            message: error.message
        });
    }
});

/**
 * POST /api/beads/dependency/:projectName
 * Add a dependency between issues
 */
router.post('/dependency/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { blockedId, blockerId } = req.body;

        if (!blockedId || !blockerId) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'blockedId and blockerId are required'
            });
        }
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['dep', 'add', blockedId, blockerId]);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to add dependency',
                message: result.error || result.output
            });
        }

        if (req.app.locals.wss) {
            broadcastBeadsIssuesUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            blockedId,
            blockerId,
            message: 'Dependency added successfully',
            output: result.output,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads add dependency error:', error);
        res.status(500).json({
            error: 'Failed to add dependency',
            message: error.message
        });
    }
});

/**
 * DELETE /api/beads/dependency/:projectName
 * Remove a dependency between issues
 */
router.delete('/dependency/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { blockedId, blockerId } = req.body;

        if (!blockedId || !blockerId) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'blockedId and blockerId are required'
            });
        }
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['dep', 'remove', blockedId, blockerId]);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to remove dependency',
                message: result.error || result.output
            });
        }

        if (req.app.locals.wss) {
            broadcastBeadsIssuesUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            blockedId,
            blockerId,
            message: 'Dependency removed successfully',
            output: result.output,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads remove dependency error:', error);
        res.status(500).json({
            error: 'Failed to remove dependency',
            message: error.message
        });
    }
});

/**
 * GET /api/beads/tree/:projectName/:issueId
 * Get dependency tree for an issue
 */
router.get('/tree/:projectName/:issueId', async (req, res) => {
    try {
        const { projectName, issueId } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['dep', 'tree', issueId, '--json']);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to get dependency tree',
                message: result.error || result.output
            });
        }

        let tree = null;
        try {
            tree = JSON.parse(result.output);
        } catch (parseError) {
            tree = { raw: result.output };
        }

        res.json({
            projectName,
            projectPath,
            issueId,
            tree,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads dependency tree error:', error);
        res.status(500).json({
            error: 'Failed to get dependency tree',
            message: error.message
        });
    }
});

/**
 * GET /api/beads/epics/:projectName
 * Get all epics in a project
 */
router.get('/epics/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const result = await runBeadsCommand(projectPath, ['list', '--json', '--type', 'epic']);

        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to list epics',
                message: result.error || result.output
            });
        }

        let epics = [];
        try {
            epics = JSON.parse(result.output);
        } catch (parseError) {
            console.warn('Failed to parse beads epics output:', parseError.message);
        }

        res.json({
            projectName,
            projectPath,
            epics,
            totalEpics: epics.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Beads list epics error:', error);
        res.status(500).json({
            error: 'Failed to list epics',
            message: error.message
        });
    }
});

export default router;
export { checkBeadsInstallation };
