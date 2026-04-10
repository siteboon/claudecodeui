import { spawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import { PLATFORMS, CREDENTIAL_TYPES } from './constants.js';

/**
 * GitLab Platform Implementation
 *
 * Handles GitLab-specific operations including cloning, branch creation (via local git),
 * and Merge Request creation via GitLab REST API.
 *
 * Note: For GitLab, branch creation is done via local git commands (checkout + push)
 * while Merge Requests are created via the GitLab API.
 */
export class GitLabPlatform {
  constructor(token, customDomain = null, apiVersion = 'v4') {
    this.token = token;
    this.name = PLATFORMS.GITLAB;
    this.customDomain = customDomain;
    // GitLab supports self-hosted instances
    this.baseUrl = customDomain || 'gitlab.com';
    // API version: 'v3' or 'v4'
    this.apiVersion = apiVersion;
  }

  /**
   * Get the credential type for this platform
   * @returns {string}
   */
  getTokenType() {
    return CREDENTIAL_TYPES.GITLAB_TOKEN;
  }

  /**
   * Parse GitLab URL to extract owner (project path) and repo
   * @param {string} url - GitLab URL (HTTPS or SSH, with optional port)
   * @returns {{owner: string, repo: string, host?: string, port?: string}} - Parsed info
   */
  parseUrl(url) {
    // Handle SSH with port: ssh://git@host:port/owner/repo.git
    let match = url.match(/^ssh:\/\/git@([^:\/]+)(?::(\d+))?\/(.+)$/);
    if (match) {
      this.customDomain = match[1];
      const pathParts = match[3].replace(/\.git$/, '').split('/');
      const owner = pathParts.slice(0, -1).join('/');
      const repo = pathParts[pathParts.length - 1];
      return { owner, repo, host: match[1], port: match[2] };
    }

    // Handle SSH: git@host:owner/repo.git
    match = url.match(/^git@([^:\/]+):(.+)$/);
    if (match) {
      this.customDomain = match[1];
      const pathParts = match[2].replace(/\.git$/, '').split('/');
      const owner = pathParts.slice(0, -1).join('/');
      const repo = pathParts[pathParts.length - 1];
      return { owner, repo, host: match[1] };
    }

    // Handle HTTPS: https://host/owner/repo.git
    match = url.match(/^https?:\/\/([^\/]+)\/(.+)$/);
    if (match) {
      this.customDomain = match[1];
      const pathParts = match[2].replace(/\.git$/, '').split('/');
      const owner = pathParts.slice(0, -1).join('/');
      const repo = pathParts[pathParts.length - 1];
      return { owner, repo, host: match[1] };
    }

    throw new Error('Invalid GitLab URL format');
  }

  /**
   * Normalize GitLab URL for comparison
   * @param {string} url - GitLab URL
   * @returns {string} - Normalized URL
   */
  normalizeUrl(url) {
    // Remove .git suffix
    let normalized = url.replace(/\.git$/, '');

    // SSH to HTTPS for comparison
    if (normalized.startsWith('git@')) {
      normalized = normalized.replace(/^git@([^:]+):/, 'https://$1/');
    } else if (normalized.startsWith('ssh://')) {
      // For SSH with port, preserve the port
      const match = normalized.match(/^ssh:\/\/git@([^:\/]+)(?::(\d+))?\/(.+)$/);
      if (match) {
        const host = match[1];
        const port = match[2] ? `:${match[2]}` : '';
        const path = match[3];
        normalized = `https://${host}${port}/${path}`;
      }
    }

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    return normalized.toLowerCase();
  }

  /**
   * Clone a GitLab repository to a directory
   * @param {string} url - GitLab repository URL (SSH or HTTPS)
   * @param {string} projectPath - Path for cloning the repository
   * @returns {Promise<string>} - Path to the cloned repository
   */
  async cloneRepo(url, projectPath) {
    return new Promise(async (resolve, reject) => {
      try {
        if (!url) {
          throw new Error('Invalid GitLab URL');
        }

        const cloneDir = path.resolve(projectPath);

        // Check if directory already exists
        try {
          await fs.access(cloneDir);
          // Directory exists - check if it's a git repo with same URL
          try {
            const existingUrl = await this._getGitRemoteUrl(cloneDir);
            const normalizedExisting = this.normalizeUrl(existingUrl);
            const normalizedRequested = this.normalizeUrl(url);

            if (normalizedExisting === normalizedRequested) {
              console.log('✅ Repository already exists at path with correct URL');
              return resolve(cloneDir);
            } else {
              throw new Error(`Directory ${cloneDir} already exists with a different repository (${existingUrl}). Expected: ${url}`);
            }
          } catch (gitError) {
            throw new Error(`Directory ${cloneDir} already exists but is not a valid git repository or git command failed`);
          }
        } catch (accessError) {
          // Directory doesn't exist - proceed with clone
        }

        // Ensure parent directory exists
        await fs.mkdir(path.dirname(cloneDir), { recursive: true });

        let cloneUrl = url;
        if (this.token) {
          // For HTTPS URLs, convert to authenticated URL
          if (url.startsWith('https://')) {
            // GitLab uses: https://oauth2:TOKEN@gitlab.com/owner/repo
            cloneUrl = url.replace('https://', `https://oauth2:${this.token}@`);
          } else {
            // For SSH URLs, token is not used for clone
            console.log('ℹ️ Token provided but using SSH URL - ensure SSH key is configured');
          }
        }

        console.log('🔄 Cloning repository:', url);
        console.log('📁 Destination:', cloneDir);

        // Execute git clone
        const gitProcess = spawn('git', ['clone', '--depth', '1', cloneUrl, cloneDir], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        gitProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        gitProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('Git stderr:', data.toString());
        });

        gitProcess.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Repository cloned successfully');
            resolve(cloneDir);
          } else {
            console.error('❌ Git clone failed:', stderr);
            reject(new Error(`Git clone failed: ${stderr}`));
          }
        });

        gitProcess.on('error', (error) => {
          reject(new Error(`Failed to execute git: ${error.message}`));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create a new branch on GitLab
   * Note: For GitLab, branch creation is done via local git commands
   * @param {string} owner - Repository owner (project path)
   * @param {string} repo - Repository name
   * @param {string} branchName - Name of new branch
   * @param {string} baseBranch - Base branch to branch from (default: 'main')
   * @returns {Promise<void>}
   */
  async createBranch(owner, repo, branchName, baseBranch = 'main') {
    // GitLab branch creation is done via local git commands
    // This method is a no-op for GitLab since we handle it locally
    console.log(`ℹ️ GitLab branch creation will be handled via local git commands`);
  }

  /**
   * Create a merge request on GitLab
   * @param {string} owner - Repository owner (project path)
   * @param {string} repo - Repository name
   * @param {string} branchName - Source branch name
   * @param {string} title - MR title
   * @param {string} body - MR description
   * @param {string} baseBranch - Target branch (default: 'main')
   * @returns {Promise<{number: number, url: string}>} - MR number and URL
   */
  async createPR(owner, repo, branchName, title, body, baseBranch = 'main') {
    if (!this.token) {
      throw new Error('GitLab token required for Merge Request creation');
    }

    // GitLab uses project path like "group/subgroup/project"
    const projectPath = encodeURIComponent(`${owner}/${repo}`);
    const apiUrl = `https://${this.baseUrl}/api/${this.apiVersion}`;
    console.log(`POST ${apiUrl}/projects/${projectPath}/merge_requests`)

    // Prepare request payload based on API version
    const requestPayload = {
      source_branch: branchName,
      target_branch: baseBranch,
      title
    };

    if (this.apiVersion === 'v4') {
      // v4 uses 'description' field
      requestPayload.description = body;
    } else {
      // v3 uses 'description' field as well, but some parameters might differ
      requestPayload.description = body;
      // v3 specific parameters if needed
    }

    try {
      const response = await fetch(
        `${apiUrl}/projects/${projectPath}/merge_requests`,
        {
          method: 'POST',
          headers: {
            'PRIVATE-TOKEN': this.token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestPayload)
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Failed to create Merge Request: ${errorData.message || response.statusText}`);
      }

      const mrData = await response.json();

      // Log based on API version
      if (this.apiVersion === 'v4') {
        console.log(`✅ Created merge request !${mrData.iid}: ${mrData.web_url}`);
      } else {
        console.log(`✅ Created merge request !${mrData.id}: ${mrData.web_url}`);
      }

      // Return standardized response format
      return {
        number: this.apiVersion === 'v4' ? mrData.iid : mrData.id,
        url: mrData.web_url
      };
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error(`Failed to connect to GitLab API. Please check your network and ensure GitLab token is valid.`);
      }
      throw error;
    }
  }

  /**
   * Get the URL for a branch
   * @param {string} owner - Repository owner (project path)
   * @param {string} repo - Repository name
   * @param {string} branchName - Branch name
   * @returns {string} - Branch URL
   */
  getBranchUrl(owner, repo, branchName) {
    return `https://${this.baseUrl}/${owner}/${repo}/-/tree/${branchName}`;
  }

  /**
   * Helper method to get git remote URL
   * @private
   */
  async _getGitRemoteUrl(repoPath) {
    return new Promise((resolve, reject) => {
      const gitProcess = spawn('git', ['config', '--get', 'remote.origin.url'], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      gitProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      gitProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Failed to get git remote: ${stderr}`));
        }
      });

      gitProcess.on('error', (error) => {
        reject(new Error(`Failed to execute git: ${error.message}`));
      });
    });
  }
}
