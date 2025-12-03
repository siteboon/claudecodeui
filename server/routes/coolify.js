import express from 'express';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import { addProjectManually } from '../projects.js';

const router = express.Router();
const execAsync = promisify(exec);

// Get Coolify credentials from environment variables
function getCoolifyCredentials() {
  const url = process.env.COOLIFY_URL;
  const token = process.env.COOLIFY_TOKEN;

  // Debug: log what we're getting from env
  console.log('[Coolify] Environment check:', {
    COOLIFY_URL: url ? `${url.substring(0, 30)}...` : 'NOT SET',
    COOLIFY_TOKEN: token ? `${token.substring(0, 10)}...` : 'NOT SET'
  });

  if (!url || !token) {
    console.log('[Coolify] Credentials not configured');
    return null;
  }

  // Ensure URL doesn't have trailing slash
  return {
    url: url.replace(/\/$/, ''),
    token
  };
}

// Make authenticated request to Coolify API
async function coolifyFetch(endpoint, options = {}) {
  const credentials = getCoolifyCredentials();

  if (!credentials) {
    throw new Error('Coolify credentials not configured. Set COOLIFY_URL and COOLIFY_TOKEN environment variables.');
  }

  const url = `${credentials.url}/api/v1${endpoint}`;
  console.log('[Coolify] Fetching:', url);

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${credentials.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  // Check content-type before parsing
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Coolify API returned non-JSON response (${contentType}). Check COOLIFY_URL is correct. Response: ${text.substring(0, 100)}...`);
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Coolify API error: ${response.status} - ${errorData.message || JSON.stringify(errorData)}`);
  }

  return response.json();
}

// Check Coolify connection status
router.get('/status', async (req, res) => {
  try {
    const credentials = getCoolifyCredentials();

    if (!credentials) {
      return res.json({
        connected: false,
        error: 'Coolify credentials not configured'
      });
    }

    // Try to fetch version to verify connection (returns plain text, not JSON)
    const url = `${credentials.url}/api/v1/version`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${credentials.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Coolify API error: ${response.status}`);
    }

    const version = await response.text();

    res.json({
      connected: true,
      url: credentials.url,
      version: version.trim()
    });
  } catch (error) {
    console.error('Coolify status check failed:', error);
    res.json({
      connected: false,
      error: error.message
    });
  }
});

// Get all projects with environments
router.get('/projects', async (req, res) => {
  try {
    const projects = await coolifyFetch('/projects');
    res.json(projects);
  } catch (error) {
    console.error('Failed to fetch Coolify projects:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all applications with git info
router.get('/applications', async (req, res) => {
  try {
    const applications = await coolifyFetch('/applications');

    // Enrich applications with project/environment hierarchy
    const projects = await coolifyFetch('/projects');

    // Build environment lookup map
    const envMap = {};
    const projectMap = {};

    for (const project of projects) {
      projectMap[project.id] = project;
      if (project.environments) {
        for (const env of project.environments) {
          envMap[env.id] = {
            ...env,
            project_name: project.name,
            project_uuid: project.uuid
          };
        }
      }
    }

    // Enrich applications with project/environment info
    const enrichedApps = applications.map(app => {
      const envInfo = envMap[app.environment_id] || {};
      return {
        ...app,
        environment_name: envInfo.name || 'Unknown',
        project_name: envInfo.project_name || 'Unknown',
        project_uuid: envInfo.project_uuid || null
      };
    });

    res.json(enrichedApps);
  } catch (error) {
    console.error('Failed to fetch Coolify applications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single application details
router.get('/app/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const application = await coolifyFetch(`/applications/${uuid}`);
    res.json(application);
  } catch (error) {
    console.error('Failed to fetch Coolify application:', error);
    res.status(500).json({ error: error.message });
  }
});

// Find existing clone of a repository
async function findExistingClone(gitUrl) {
  const workDir = path.join(os.homedir(), 'coolify-apps');

  try {
    await fs.access(workDir);
  } catch {
    return null;
  }

  const entries = await fs.readdir(workDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectPath = path.join(workDir, entry.name);
    const gitDir = path.join(projectPath, '.git');

    try {
      await fs.access(gitDir);

      // Get the remote URL of this repo
      const { stdout } = await execAsync('git remote get-url origin', { cwd: projectPath });
      const remoteUrl = stdout.trim();

      // Normalize URLs for comparison (handle .git suffix, https vs git@, etc.)
      if (normalizeGitUrl(remoteUrl) === normalizeGitUrl(gitUrl)) {
        return projectPath;
      }
    } catch {
      continue;
    }
  }

  return null;
}

// Normalize git URL for comparison
function normalizeGitUrl(url) {
  if (!url) return '';

  let normalized = url
    .replace(/\.git$/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^git@gitlab\.com:/, 'https://gitlab.com/')
    .replace(/^git@bitbucket\.org:/, 'https://bitbucket.org/')
    .toLowerCase();

  // If it's just owner/repo format, convert to full GitHub URL
  if (!normalized.startsWith('http') && normalized.includes('/') && !normalized.includes(':')) {
    normalized = `https://github.com/${normalized}`;
  }

  return normalized;
}

// Check if a directory is a git worktree
async function isWorktree(dirPath) {
  const gitPath = path.join(dirPath, '.git');

  try {
    const stat = await fs.stat(gitPath);
    // In a worktree, .git is a file, not a directory
    return stat.isFile();
  } catch {
    return false;
  }
}

// Get list of existing worktrees for a repository
async function getWorktrees(repoPath) {
  try {
    const { stdout } = await execAsync('git worktree list --porcelain', { cwd: repoPath });
    const worktrees = [];
    let current = {};

    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current);
        current = { path: line.substring(9) };
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7).replace('refs/heads/', '');
      }
    }

    if (current.path) worktrees.push(current);

    return worktrees;
  } catch {
    return [];
  }
}

// Try to get GitHub App installation access token from Coolify
async function getGitHubAppToken(app) {
  try {
    // Check if app has a source (GitHub App) configured
    if (!app.source_id) {
      console.log('[Coolify] No source_id found on application');
      return null;
    }

    // Try to fetch the source details
    const source = await coolifyFetch(`/sources/${app.source_id}`);
    console.log('[Coolify] Source details:', JSON.stringify(source, null, 2));

    // If source has an installation_id, we might be able to get a token
    // Note: Coolify may not expose this via API for security reasons
    if (source.installation_id) {
      console.log('[Coolify] Found GitHub App installation_id:', source.installation_id);
    }

    return null; // Coolify doesn't expose tokens directly
  } catch (error) {
    console.log('[Coolify] Could not fetch source:', error.message);
    return null;
  }
}

// Check if user has SSH keys configured for GitHub
async function hasSSHAccess() {
  try {
    const sshKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
    const sshKeyPathEd = path.join(os.homedir(), '.ssh', 'id_ed25519');

    try {
      await fs.access(sshKeyPath);
      return true;
    } catch {}

    try {
      await fs.access(sshKeyPathEd);
      return true;
    } catch {}

    return false;
  } catch {
    return false;
  }
}

// Convert HTTPS URL to SSH URL
function httpsToSsh(httpsUrl) {
  // https://github.com/owner/repo.git -> git@github.com:owner/repo.git
  const match = httpsUrl.match(/https?:\/\/([^/]+)\/(.+)/);
  if (match) {
    const host = match[1];
    let path = match[2];
    if (!path.endsWith('.git')) path += '.git';
    return `git@${host}:${path}`;
  }
  return httpsUrl;
}

// Clone or create worktree for a Coolify application
router.post('/clone', async (req, res) => {
  try {
    const { appUuid, targetPath, useSSH } = req.body;

    if (!appUuid) {
      return res.status(400).json({ error: 'appUuid is required' });
    }

    // Fetch application details from Coolify
    const app = await coolifyFetch(`/applications/${appUuid}`);

    // Debug: log what Coolify returns
    console.log('[Coolify] Application details:', JSON.stringify({
      uuid: app.uuid,
      name: app.name,
      git_repository: app.git_repository,
      git_full_url: app.git_full_url,
      git_branch: app.git_branch,
      source_id: app.source_id,
      private_key_id: app.private_key_id,
      // Check for any credential-related fields
      has_deploy_key: !!app.private_key_id,
    }, null, 2));

    if (!app.git_repository) {
      return res.status(400).json({ error: 'Application has no git repository configured' });
    }

    // Construct the git URL
    let gitUrl = app.git_full_url || app.git_repository;

    // If it's not a full URL, assume GitHub and construct the URL
    if (!gitUrl.startsWith('http') && !gitUrl.startsWith('git@')) {
      gitUrl = `https://github.com/${gitUrl}.git`;
    }

    // For private repos, try SSH if available
    const canUseSSH = await hasSSHAccess();
    if (useSSH || (gitUrl.startsWith('https://') && canUseSSH)) {
      const sshUrl = httpsToSsh(gitUrl);
      console.log('[Coolify] Using SSH URL:', sshUrl);
      gitUrl = sshUrl;
    } else if (gitUrl.startsWith('https://')) {
      console.log('[Coolify] Using HTTPS URL (no SSH keys found):', gitUrl);
      console.log('[Coolify] Note: For private repos, ensure git credentials are configured');
    }

    const branch = app.git_branch || 'main';
    // Clean up app name - remove owner prefix and branch suffix if present
    let appName = app.name || 'coolify-app';
    // If name contains slashes or colons (like "owner/repo:branch-uuid"), extract just the repo name
    if (appName.includes('/')) {
      appName = appName.split('/').pop();
    }
    if (appName.includes(':')) {
      appName = appName.split(':')[0];
    }

    // Determine target path
    const workDir = path.join(os.homedir(), 'coolify-apps');
    const defaultPath = path.join(workDir, branch === 'main' || branch === 'master' ? appName : `${appName}-${branch}`);
    const finalPath = targetPath || defaultPath;

    // Check if this exact path already exists
    try {
      await fs.access(finalPath);
      // Path exists, check if it's the right repo and branch
      const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: finalPath });
      if (currentBranch.trim() === branch) {
        // Already cloned to correct branch, just register and return
        await addProjectManually(finalPath);
        return res.json({
          success: true,
          path: finalPath,
          action: 'existing',
          branch
        });
      }
    } catch {
      // Path doesn't exist, continue with clone/worktree
    }

    // Check if repo is already cloned somewhere else
    const existingClone = await findExistingClone(gitUrl);

    if (existingClone) {
      // Repo exists, check if we need to create a worktree
      const worktrees = await getWorktrees(existingClone);
      const existingWorktree = worktrees.find(wt => wt.branch === branch);

      if (existingWorktree) {
        // Worktree for this branch already exists
        await addProjectManually(existingWorktree.path);
        return res.json({
          success: true,
          path: existingWorktree.path,
          action: 'existing-worktree',
          branch
        });
      }

      // Create new worktree
      await fs.mkdir(path.dirname(finalPath), { recursive: true });

      // Fetch the branch first
      await execAsync(`git fetch origin ${branch}`, { cwd: existingClone });

      // Create worktree
      await execAsync(`git worktree add "${finalPath}" ${branch}`, { cwd: existingClone });

      // Register as project
      await addProjectManually(finalPath);

      return res.json({
        success: true,
        path: finalPath,
        action: 'worktree-created',
        branch,
        mainRepo: existingClone
      });
    }

    // No existing clone, do a fresh clone
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    // Clone the repository
    await new Promise((resolve, reject) => {
      const cloneProcess = spawn('git', ['clone', '-b', branch, gitUrl, finalPath], {
        stdio: 'pipe'
      });

      let stderr = '';
      cloneProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      cloneProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git clone failed: ${stderr}`));
        }
      });

      cloneProcess.on('error', reject);
    });

    // Register as project
    await addProjectManually(finalPath);

    res.json({
      success: true,
      path: finalPath,
      action: 'cloned',
      branch
    });

  } catch (error) {
    console.error('Clone failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Deploy (auto-commit and push)
router.post('/deploy/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const { projectPath, commitMessage } = req.body;

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    // Verify path exists and is a git repo
    try {
      await execAsync('git rev-parse --git-dir', { cwd: projectPath });
    } catch {
      return res.status(400).json({ error: 'Path is not a git repository' });
    }

    // Get current branch
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const branch = currentBranch.trim();

    // Check for changes
    const { stdout: status } = await execAsync('git status --porcelain', { cwd: projectPath });

    if (status.trim()) {
      // There are changes, commit them
      await execAsync('git add -A', { cwd: projectPath });

      const message = commitMessage || `Deploy via Claude Code UI`;
      await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: projectPath });
    }

    // Push to remote
    await execAsync(`git push origin ${branch}`, { cwd: projectPath });

    // Get the latest commit info
    const { stdout: commitInfo } = await execAsync('git log -1 --format="%H|%s"', { cwd: projectPath });
    const [commitHash, commitMsg] = commitInfo.trim().split('|');

    res.json({
      success: true,
      branch,
      commit: {
        hash: commitHash,
        message: commitMsg
      },
      message: 'Pushed successfully. Coolify will auto-deploy via webhook.'
    });

  } catch (error) {
    console.error('Deploy failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get applications grouped by project and environment
router.get('/hierarchy', async (req, res) => {
  try {
    // Check if Coolify is configured
    const credentials = getCoolifyCredentials();
    if (!credentials) {
      return res.json([]); // Return empty array if not configured
    }

    // Get list of projects (doesn't include environments)
    const projectsList = await coolifyFetch('/projects');
    const applications = await coolifyFetch('/applications');

    // Ensure we have arrays
    if (!Array.isArray(projectsList)) {
      console.error('Coolify /projects did not return an array:', projectsList);
      return res.json([]);
    }
    if (!Array.isArray(applications)) {
      console.error('Coolify /applications did not return an array:', applications);
      return res.json([]);
    }

    // Fetch full details for each project (includes environments)
    const projectsWithEnvs = await Promise.all(
      projectsList.map(async (p) => {
        try {
          return await coolifyFetch(`/projects/${p.uuid}`);
        } catch {
          // If individual fetch fails, return the basic project
          return { ...p, environments: [] };
        }
      })
    );

    // Build hierarchy
    const hierarchy = projectsWithEnvs.map(project => {
      const projectEnvs = (project.environments || []).map(env => {
        const envApps = applications.filter(app => app.environment_id === env.id);
        return {
          id: env.id,
          name: env.name,
          applications: envApps.map(app => ({
            uuid: app.uuid,
            name: app.name,
            status: app.status,
            fqdn: app.fqdn,
            git_repository: app.git_repository,
            git_branch: app.git_branch,
            git_commit_sha: app.git_commit_sha
          }))
        };
      });

      return {
        id: project.id,
        uuid: project.uuid,
        name: project.name,
        description: project.description,
        environments: projectEnvs
      };
    });

    res.json(hierarchy);
  } catch (error) {
    console.error('Failed to fetch Coolify hierarchy:', error);
    // Return empty array instead of error to prevent frontend crash
    res.json([]);
  }
});

export default router;
