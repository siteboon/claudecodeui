// @ts-nocheck -- dynamic provider event payloads are normalized at the injected writer boundary.
import path from 'path';

import express from 'express';

import type { ProviderRunFunction } from '@/shared/types.js';

import { normalizeProjectPath } from '../../shared/utils.js';

/** What the route reads off a session row it continues: the row, not the request, says which provider and project a session belongs to. */
type AgentSessionRow = {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  project_path: string | null;
};

type AgentRouterDependencies = {
  fileSystem: typeof import('node:fs/promises');
  crypto: typeof import('node:crypto');
  homeDirectory(): string;
  spawnProcess: typeof import('cross-spawn').default;
  platformMode: boolean;
  users: { getFirstUser(): unknown };
  apiKeys: { validateApiKey(apiKey: string): unknown };
  githubTokens: { getActiveGithubToken(userId: number): string | null };
  projects: { createProjectPath(projectPath: string, customName: string | null): unknown };
  models: typeof import('../providers/index.js').providerModelsService;
  /** The session gateway: an API run gets an app session row like a chat send, so the UI can list, open and subscribe to it. */
  sessions: {
    getSessionById(sessionId: string): AgentSessionRow | null;
    getSessionByProviderSessionId(providerSessionId: string): AgentSessionRow | null;
    createAppSession(provider: string, projectPath: string, initialMessage: string): { sessionId: string };
  };
  /** The live-run registry the chat socket uses; registering here is what puts an API run on the running-sessions list. */
  runs: Pick<typeof import('../websocket/index.js').chatRunRegistry, 'startRun' | 'completeRunIfCurrent' | 'isProcessing'>;
  queryClaude: ProviderRunFunction;
  queryCursor: ProviderRunFunction;
  queryCodex: ProviderRunFunction;
  queryOpenCode: ProviderRunFunction;
  GithubClient: typeof import('@octokit/rest').Octokit;
};

/**
 * Creates Agent routes around explicit authentication, repository, provider,
 * filesystem, subprocess, runtime, and GitHub dependencies.
 */
export function createAgentRouter(dependencies: AgentRouterDependencies): express.Router {
  const fs = dependencies.fileSystem;
  const crypto = dependencies.crypto;
  const os = { homedir: dependencies.homeDirectory };
  const spawn = dependencies.spawnProcess;
  const IS_PLATFORM = dependencies.platformMode;
  const userDb = dependencies.users;
  const apiKeysDb = dependencies.apiKeys;
  const githubTokensDb = dependencies.githubTokens;
  const projectsDb = dependencies.projects;
  const providerModelsService = dependencies.models;
  const sessionGateway = dependencies.sessions;
  const runRegistry = dependencies.runs;
  const queryClaudeSDK = dependencies.queryClaude;
  const spawnCursor = dependencies.queryCursor;
  const queryCodex = dependencies.queryCodex;
  const spawnOpenCode = dependencies.queryOpenCode;
  const Octokit = dependencies.GithubClient;
  const router = express.Router();

  /**
   * Middleware to authenticate agent API requests.
   *
   * Supports two authentication modes:
   * 1. Platform mode (IS_PLATFORM=true): For managed/hosted deployments where
   *    authentication is handled by an external proxy. Requests are trusted and
   *    the default user context is used.
   *
   * 2. API key mode (default): For self-hosted deployments where users authenticate
   *    via API keys created in the UI. Keys are validated against the local database.
   */
  const validateExternalApiKey = (req, res, next) => {
    // Platform mode: Authentication is handled externally (e.g., by a proxy layer).
    // Trust the request and use the default user context.
    if (IS_PLATFORM) {
      try {
        const user = userDb.getFirstUser();
        if (!user) {
          return res.status(500).json({ error: 'Platform mode: No user found in database' });
        }
        req.user = user;
        return next();
      } catch (error) {
        console.error('Platform mode error:', error);
        return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
      }
    }

    // Self-hosted mode: Validate API key from header or query parameter
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const user = apiKeysDb.validateApiKey(apiKey);

    if (!user) {
      return res.status(401).json({ error: 'Invalid or inactive API key' });
    }

    req.user = user;
    next();
  };

  /**
   * Get the remote URL of a git repository
   * @param {string} repoPath - Path to the git repository
   * @returns {Promise<string>} - Remote URL of the repository
   */
  async function getGitRemoteUrl(repoPath) {
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

  /**
   * Normalize GitHub URLs for comparison
   * @param {string} url - GitHub URL
   * @returns {string} - Normalized URL
   */
  function normalizeGitHubUrl(url) {
    // Remove .git suffix
    let normalized = url.replace(/\.git$/, '');
    // Convert SSH to HTTPS format for comparison
    normalized = normalized.replace(/^git@github\.com:/, 'https://github.com/');
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    return normalized.toLowerCase();
  }

  /**
   * Parse GitHub URL to extract owner and repo
   * @param {string} url - GitHub URL (HTTPS or SSH)
   * @returns {{owner: string, repo: string}} - Parsed owner and repo
   */
  function parseGitHubUrl(url) {
    // Handle HTTPS URLs: https://github.com/owner/repo or https://github.com/owner/repo.git
    // Handle SSH URLs: git@github.com:owner/repo or git@github.com:owner/repo.git
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) {
      throw new Error('Invalid GitHub URL format');
    }
    return {
      owner: match[1],
      repo: match[2].replace(/\.git$/, '')
    };
  }

  /**
   * Auto-generate a branch name from a message
   * @param {string} message - The agent message
   * @returns {string} - Generated branch name
   */
  function autogenerateBranchName(message) {
    // Convert to lowercase, replace spaces/special chars with hyphens
    let branchName = message
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

    // Ensure non-empty fallback
    if (!branchName) {
      branchName = 'task';
    }

    // Generate timestamp suffix (last 6 chars of base36 timestamp)
    const timestamp = Date.now().toString(36).slice(-6);
    const suffix = `-${timestamp}`;

    // Limit length to ensure total length including suffix fits within 50 characters
    const maxBaseLength = 50 - suffix.length;
    if (branchName.length > maxBaseLength) {
      branchName = branchName.substring(0, maxBaseLength);
    }

    // Remove any trailing hyphen after truncation and ensure no leading hyphen
    branchName = branchName.replace(/-$/, '').replace(/^-+/, '');

    // If still empty or starts with hyphen after cleanup, use fallback
    if (!branchName || branchName.startsWith('-')) {
      branchName = 'task';
    }

    // Combine base name with timestamp suffix
    branchName = `${branchName}${suffix}`;

    // Final validation: ensure it matches safe pattern
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branchName)) {
      // Fallback to deterministic safe name
      return `branch-${timestamp}`;
    }

    return branchName;
  }

  /**
   * Validate a Git branch name
   * @param {string} branchName - Branch name to validate
   * @returns {{valid: boolean, error?: string}} - Validation result
   */
  function validateBranchName(branchName) {
    if (!branchName || branchName.trim() === '') {
      return { valid: false, error: 'Branch name cannot be empty' };
    }

    // Git branch name rules
    const invalidPatterns = [
      { pattern: /^\./, message: 'Branch name cannot start with a dot' },
      { pattern: /\.$/, message: 'Branch name cannot end with a dot' },
      { pattern: /\.\./, message: 'Branch name cannot contain consecutive dots (..)' },
      { pattern: /\s/, message: 'Branch name cannot contain spaces' },
      { pattern: /[~^:?*\[\\]/, message: 'Branch name cannot contain special characters: ~ ^ : ? * [ \\' },
      { pattern: /@{/, message: 'Branch name cannot contain @{' },
      { pattern: /\/$/, message: 'Branch name cannot end with a slash' },
      { pattern: /^\//, message: 'Branch name cannot start with a slash' },
      { pattern: /\/\//, message: 'Branch name cannot contain consecutive slashes' },
      { pattern: /\.lock$/, message: 'Branch name cannot end with .lock' }
    ];

    for (const { pattern, message } of invalidPatterns) {
      if (pattern.test(branchName)) {
        return { valid: false, error: message };
      }
    }

    // Check for ASCII control characters
    if (/[\x00-\x1F\x7F]/.test(branchName)) {
      return { valid: false, error: 'Branch name cannot contain control characters' };
    }

    return { valid: true };
  }

  /**
   * Get recent commit messages from a repository
   * @param {string} projectPath - Path to the git repository
   * @param {number} limit - Number of commits to retrieve (default: 5)
   * @returns {Promise<string[]>} - Array of commit messages
   */
  async function getCommitMessages(projectPath, limit = 5) {
    return new Promise((resolve, reject) => {
      const gitProcess = spawn('git', ['log', `-${limit}`, '--pretty=format:%s'], {
        cwd: projectPath,
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
          const messages = stdout.trim().split('\n').filter(msg => msg.length > 0);
          resolve(messages);
        } else {
          reject(new Error(`Failed to get commit messages: ${stderr}`));
        }
      });

      gitProcess.on('error', (error) => {
        reject(new Error(`Failed to execute git: ${error.message}`));
      });
    });
  }

  /**
   * Create a new branch on GitHub using the API
   * @param {Octokit} octokit - Octokit instance
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} branchName - Name of the new branch
   * @param {string} baseBranch - Base branch to branch from (default: 'main')
   * @returns {Promise<void>}
   */

  /**
   * Create a pull request on GitHub
   * @param {Octokit} octokit - Octokit instance
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} branchName - Head branch name
   * @param {string} title - PR title
   * @param {string} body - PR body/description
   * @param {string} baseBranch - Base branch (default: 'main')
   * @returns {Promise<{number: number, url: string}>} - PR number and URL
   */
  async function createGitHubPR(octokit, owner, repo, branchName, title, body, baseBranch = 'main') {
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title,
      head: branchName,
      base: baseBranch,
      body
    });

    console.log(`✅ Created pull request #${pr.number}: ${pr.html_url}`);

    return {
      number: pr.number,
      url: pr.html_url
    };
  }

  /**
   * Clone a GitHub repository to a directory
   * @param {string} githubUrl - GitHub repository URL
   * @param {string} githubToken - Optional GitHub token for private repos
   * @param {string} projectPath - Path for cloning the repository
   * @returns {Promise<{path: string, created: boolean}>} - Checkout path and ownership flag
   */
  async function cloneGitHubRepo(githubUrl, githubToken = null, projectPath) {
    return new Promise(async (resolve, reject) => {
      try {
        // Validate the host before using credentials or invoking Git.
        let parsedGithubUrl;
        try {
          parsedGithubUrl = new URL(githubUrl);
        } catch {
          throw new Error('Invalid GitHub URL');
        }
        if (
          parsedGithubUrl.protocol !== 'https:'
          || parsedGithubUrl.hostname !== 'github.com'
          || parsedGithubUrl.username
          || parsedGithubUrl.password
        ) {
          throw new Error('Invalid GitHub URL');
        }
        const cloneUrl = parsedGithubUrl.toString();

        const cloneDir = path.resolve(projectPath);

        // Check if directory already exists
        try {
          await fs.access(cloneDir);
          // Directory exists - check if it's a git repo with the same URL
          try {
            const existingUrl = await getGitRemoteUrl(cloneDir);
            const normalizedExisting = normalizeGitHubUrl(existingUrl);
            const normalizedRequested = normalizeGitHubUrl(cloneUrl);

            if (normalizedExisting === normalizedRequested) {
              console.log('✅ Repository already exists at path with correct URL');
              return resolve({ path: cloneDir, created: false });
            } else {
              throw new Error(`Directory ${cloneDir} already exists with a different repository (${existingUrl}). Expected: ${githubUrl}`);
            }
          } catch (gitError) {
            throw new Error(`Directory ${cloneDir} already exists but is not a valid git repository or git command failed`);
          }
        } catch (accessError) {
          // Directory doesn't exist - proceed with clone
        }

        // Ensure parent directory exists
        await fs.mkdir(path.dirname(cloneDir), { recursive: true });

        console.log('🔄 Cloning repository:', githubUrl);
        console.log('📁 Destination:', cloneDir);

        // Execute git clone. The host was validated above; the helper is
        // still scoped to github.com over https so the token can answer no
        // other challenge (a redirect, say).
        const gitEnvironment = githubToken ? {
          ...process.env,
          GIT_CONFIG_COUNT: '2',
          GIT_CONFIG_KEY_0: 'credential.helper',
          GIT_CONFIG_VALUE_0: '',
          GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
          GIT_CONFIG_VALUE_1: '!f() { echo username=x-access-token; echo "password=$CLOUDCLI_GITHUB_TOKEN"; }; f',
          CLOUDCLI_GITHUB_TOKEN: githubToken,
          GIT_TERMINAL_PROMPT: '0'
        } : process.env;
        const gitProcess = spawn('git', ['clone', '--depth', '1', '--', cloneUrl, cloneDir], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: gitEnvironment
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
            resolve({ path: cloneDir, created: true });
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
   * Clean up a temporary project directory and its Claude session
   * @param {string} projectPath - Path to the project directory
   * @param {string} sessionId - Session ID to clean up
   */
  async function cleanupProject(projectPath, sessionId = null) {
    try {
      const externalProjectsRoot = await fs.realpath(
        path.join(os.homedir(), '.claude', 'external-projects')
      );
      const canonicalProjectPath = await fs.realpath(projectPath);
      const relativeProjectPath = path.relative(externalProjectsRoot, canonicalProjectPath);
      const isContained = relativeProjectPath !== ''
        && relativeProjectPath !== '..'
        && !relativeProjectPath.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relativeProjectPath);

      if (!isContained) {
        console.warn('⚠️ Refusing to clean up non-external project:', projectPath);
        return;
      }

      console.log('🧹 Cleaning up project:', projectPath);
      await fs.rm(canonicalProjectPath, { recursive: true, force: true });
      console.log('✅ Project cleaned up');

      // Also clean up the Claude session directory if sessionId provided
      if (sessionId) {
        try {
          const sessionPath = path.join(os.homedir(), '.claude', 'sessions', sessionId);
          console.log('🧹 Cleaning up session directory:', sessionPath);
          await fs.rm(sessionPath, { recursive: true, force: true });
          console.log('✅ Session directory cleaned up');
        } catch (error) {
          console.error('⚠️ Failed to clean up session directory:', error.message);
        }
      }
    } catch (error) {
      console.error('❌ Failed to clean up project:', error);
    }
  }

  /**
   * SSE Stream Writer - the HTTP response as one audience of a registered run.
   *
   * The provider runtime no longer writes here directly: it writes to the
   * run's gateway writer, which remaps, sequences and buffers every event
   * and forwards it — as a JSON string, the way it reaches a websocket — to
   * each connection watching the run, this one included. The route's own
   * events (status, session-id, GitHub results, done) are objects.
   */
  class SSEStreamWriter {
    constructor(res) {
      this.res = res;
    }

    /** What the gateway writer checks before forwarding: open until the response has ended. */
    get readyState() {
      return this.res.writableEnded ? 3 : 1;
    }

    send(data) {
      if (this.res.writableEnded) {
        return;
      }

      this.res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
    }

    end() {
      if (!this.res.writableEnded) {
        this.res.write('data: {"type":"done"}\n\n');
        this.res.end();
      }
    }
  }

  /**
   * Non-streaming response collector - the same audience role, kept in
   * memory until the run ends.
   */
  class ResponseCollector {
    constructor() {
      this.messages = [];
    }

    readyState = 1;

    send(data) {
      // The run's events arrive as JSON strings; the route's own as objects.
      // Stored as objects either way so the filters below read one shape.
      let record = data;
      if (typeof data === 'string') {
        try {
          record = JSON.parse(data);
        } catch (e) {
          // Not JSON, keep as is
        }
      }
      this.messages.push(record);
    }

    end() {
      // Do nothing - we'll collect all messages
    }

    getMessages() {
      return this.messages;
    }

    /**
     * The assistant's replies, as the normalized `text` events the run
     * produced. (Earlier versions filtered a `claude-response` shape no
     * runtime has emitted since the providers were unified, so this was
     * always empty.)
     */
    getAssistantMessages() {
      return this.messages.filter((msg) => msg && msg.kind === 'text' && msg.role === 'assistant');
    }

    /**
     * The run's token usage, from the last context-window report the
     * runtime streamed (`status` / `token_budget`, which the Claude and Codex
     * runtimes emit per assistant message); zeros for a runtime that
     * reports none.
     */
    getTotalTokens() {
      let budget = null;
      for (const msg of this.messages) {
        if (msg && msg.kind === 'status' && msg.text === 'token_budget' && msg.tokenBudget) {
          budget = msg.tokenBudget;
        }
      }
      const inputTokens = budget?.inputTokens ?? 0;
      const outputTokens = budget?.outputTokens ?? 0;
      return {
        inputTokens,
        outputTokens,
        cacheReadTokens: budget?.cacheReadTokens ?? 0,
        cacheCreationTokens: budget?.cacheCreationTokens ?? 0,
        totalTokens: inputTokens + outputTokens
      };
    }
  }

  // ===============================
  // External API Endpoint
  // ===============================

  /**
   * POST /api/agent
   *
   * Trigger an AI agent to work on a project.
   * Supports automatic GitHub branch and pull request creation after successful completion.
   *
   * ================================================================================================
   * REQUEST BODY PARAMETERS
   * ================================================================================================
   *
   * @param {string} githubUrl - (Conditionally Required) GitHub repository URL to clone.
   *                             Supported formats:
   *                             - HTTPS: https://github.com/owner/repo
   *                             - HTTPS with .git: https://github.com/owner/repo.git
   *                             - SSH: git@github.com:owner/repo
   *                             - SSH with .git: git@github.com:owner/repo.git
   *
   * @param {string} projectPath - (Conditionally Required) Path to existing project OR destination for cloning.
   *                               Behavior depends on usage:
   *                               - If used alone: Must point to existing project directory
   *                               - If used with githubUrl: Target location for cloning
   *                               - If omitted with githubUrl: Auto-generates temporary path in ~/.claude/external-projects/
   *
   * @param {string} message - (Required) Task description for the AI agent. Used as:
   *                          - Instructions for the agent
   *                          - Source for auto-generated branch names (if createBranch=true and no branchName)
   *                          - Fallback for PR title if no commits are made
   *
   * @param {string} provider - (Optional) AI provider to use. Options: 'claude' | 'cursor' | 'codex' | 'opencode'
   *                           Default: 'claude'
   *
   * @param {boolean} stream - (Optional) Enable Server-Sent Events (SSE) streaming for real-time updates.
   *                          Default: true
   *                          - true: Returns text/event-stream with incremental updates
   *                          - false: Returns complete JSON response after completion
   *
   * @param {string} sessionId - (Optional) Continue an existing session: the id an earlier
   *                             response reported as `sessionId` / in its `session-id` event.
   *                             A session already mid-run is refused (409); an unknown id, 404.
   *                             Omitted: a new session is created for the run.
   *
   * @param {string} model - (Optional) Model identifier for providers.
   *
   *                        Claude models: 'default', 'sonnet', 'opus', 'haiku', 'sonnet[1m]', 'opus[1m]', 'fable'
   *                        Cursor models: 'gpt-5' (default), 'gpt-5.2', 'gpt-5.2-high', 'sonnet-4.5', 'opus-4.5',
   *                                       'composer-1', 'auto', 'gpt-5.1', 'gpt-5.1-high',
   *                                       'gpt-5.1-codex', 'gpt-5.1-codex-high', 'gpt-5.1-codex-max',
   *                                       'gpt-5.1-codex-max-high', 'opus-4.1', 'grok', and thinking variants
   *                        Codex models: 'gpt-5.4' (default), 'gpt-5.5', 'gpt-5.4-mini'
   *
   * @param {string} effort - (Optional) Reasoning effort for providers/models that support it.
   *                          Claude supports: 'low', 'medium', 'high', 'xhigh', 'max' depending on model.
   *                          Codex supports: 'low', 'medium', 'high', 'xhigh'.
   *                          'default' or omission lets the provider decide.
   *
   * @param {boolean} cleanup - (Optional) Auto-cleanup project directory after completion.
   *                           Default: true
   *                           Behavior:
   *                           - Only applies when cloning via githubUrl (not for existing projectPath)
   *                           - Deletes cloned repository after 5 seconds
   *                           - Also deletes associated Claude session directory
   *                           - Remote branch and PR remain on GitHub if created
   *
   * @param {string} githubToken - (Optional) GitHub Personal Access Token for authentication.
   *                              Overrides stored token from user settings.
   *                              Required for:
   *                              - Private repositories
   *                              - Branch/PR creation features
   *                              Token must have 'repo' scope for full functionality.
   *
   * @param {string} branchName - (Optional) Custom name for the Git branch.
   *                             If provided, createBranch is automatically set to true.
   *                             Validation rules (errors returned if violated):
   *                             - Cannot be empty or whitespace only
   *                             - Cannot start or end with dot (.)
   *                             - Cannot contain consecutive dots (..)
   *                             - Cannot contain spaces
   *                             - Cannot contain special characters: ~ ^ : ? * [ \
   *                             - Cannot contain @{
   *                             - Cannot start or end with forward slash (/)
   *                             - Cannot contain consecutive slashes (//)
   *                             - Cannot end with .lock
   *                             - Cannot contain ASCII control characters
   *                             Examples: 'feature/user-auth', 'bugfix/login-error', 'refactor/db-optimization'
   *
   * @param {boolean} createBranch - (Optional) Create a new Git branch after successful agent completion.
   *                                Default: false (or true if branchName is provided)
   *                                Behavior:
   *                                - Creates branch locally and pushes to remote
   *                                - If branch exists locally: Checks out existing branch (no error)
   *                                - If branch exists on remote: Uses existing branch (no error)
   *                                - Branch name: Custom (if branchName provided) or auto-generated from message
   *                                - Requires either githubUrl OR projectPath with GitHub remote
   *
   * @param {boolean} createPR - (Optional) Create a GitHub Pull Request after successful completion.
   *                            Default: false
   *                            Behavior:
   *                            - PR title: First commit message (or fallback to message parameter)
   *                            - PR description: Auto-generated from all commit messages
   *                            - Base branch: Always 'main' (currently hardcoded)
   *                            - If PR already exists: GitHub returns error with details
   *                            - Requires either githubUrl OR projectPath with GitHub remote
   *
   * ================================================================================================
   * PATH HANDLING BEHAVIOR
   * ================================================================================================
   *
   * Scenario 1: Only githubUrl provided
   *   Input:  { githubUrl: "https://github.com/owner/repo" }
   *   Action: Clones to auto-generated temporary path: ~/.claude/external-projects/<hash>/
   *   Cleanup: Yes (if cleanup=true)
   *
   * Scenario 2: Only projectPath provided
   *   Input:  { projectPath: "/home/user/my-project" }
   *   Action: Uses existing project at specified path
   *   Validation: Path must exist and be accessible
   *   Cleanup: No (never cleanup existing projects)
   *
   * Scenario 3: Both githubUrl and projectPath provided
   *   Input:  { githubUrl: "https://github.com/owner/repo", projectPath: "/custom/path" }
   *   Action: Clones githubUrl to projectPath location
   *   Validation:
   *     - If projectPath exists with git repo:
   *       - Compares remote URL with githubUrl
   *       - If URLs match: Reuses existing repo
   *       - If URLs differ: Returns error
   *   Cleanup: Yes (if cleanup=true)
   *
   * ================================================================================================
   * GITHUB BRANCH/PR CREATION REQUIREMENTS
   * ================================================================================================
   *
   * For createBranch or createPR to work, one of the following must be true:
   *
   * Option A: githubUrl provided
   *   - Repository URL directly specified
   *   - Works with both cloning and existing paths
   *
   * Option B: projectPath with GitHub remote
   *   - Project must be a Git repository
   *   - Must have 'origin' remote configured
   *   - Remote URL must point to github.com
   *   - System auto-detects GitHub URL via: git remote get-url origin
   *
   * Additional Requirements:
   *   - Valid GitHub token (from settings or githubToken parameter)
   *   - Token must have 'repo' scope for private repos
   *   - Project must have commits (for PR creation)
   *
   * ================================================================================================
   * VALIDATION & ERROR HANDLING
   * ================================================================================================
   *
   * Input Validations (400 Bad Request):
   *   - Either githubUrl OR projectPath must be provided (not neither)
   *   - message must be non-empty string
   *   - provider must be 'claude', 'cursor', 'codex', or 'opencode'
   *   - createBranch/createPR requires githubUrl OR projectPath (not neither)
   *   - branchName must pass Git naming rules (if provided)
   *
   * Runtime Validations (500 Internal Server Error or specific error in response):
   *   - projectPath must exist (if used alone)
   *   - GitHub URL format must be valid
   *   - Git remote URL must include github.com (for projectPath + branch/PR)
   *   - GitHub token must be available (for private repos and branch/PR)
   *   - Directory conflicts handled (existing path with different repo)
   *
   * Branch Name Validation Errors (returned in response, not HTTP error):
   *   Invalid names return: { branch: { error: "Invalid branch name: <reason>" } }
   *   Examples:
   *   - "my branch" → "Branch name cannot contain spaces"
   *   - ".feature" → "Branch name cannot start with a dot"
   *   - "feature.lock" → "Branch name cannot end with .lock"
   *
   * ================================================================================================
   * RESPONSE FORMATS
   * ================================================================================================
   *
   * Every run is registered with the chat run registry like a message sent
   * from the UI: it is on GET /api/providers/sessions/running while it goes,
   * a tab that opens the session subscribes to it live, and its events
   * reach this response the way they reach a tab — `sessionId` is the app
   * session id, each event carries a `seq`, and the provider's own
   * `session_created` is folded into the session row instead of forwarded.
   *
   * Streaming Response (stream=true):
   *   Content-Type: text/event-stream
   *   Events:
   *     - { type: "status", message: "...", projectPath: "..." }
   *     - { type: "session-id", sessionId: "..." }   // the app session id, usable as `sessionId` later
   *     - { kind: "text" | "tool_use" | ... , sessionId, seq, ... }   // the provider's normalized events
   *     - { kind: "complete", ... }
   *     - { type: "status", message: "Run aborted", aborted: true }   // only when a tab aborted the run; no branch/PR follows
   *     - { type: "github-branch", branch: { name: "...", url: "..." } }
   *     - { type: "github-pr", pullRequest: { number: 42, url: "..." } }
   *     - { type: "github-error", error: "..." }
   *     - { type: "done" }
   *
   * Non-Streaming Response (stream=false):
   *   Content-Type: application/json
   *   {
   *     success: true,          // false, with aborted: true, when a tab aborted the run
   *     sessionId: "session-123",          // the app session id; pass it back as `sessionId` to continue
   *     providerSessionId: "native-id",    // the provider's own id, for tooling that drives the CLI directly
   *     messages: [...],        // The assistant's replies: the run's normalized `text` events
   *     tokens: {
   *       inputTokens: 150,
   *       outputTokens: 50,
   *       cacheReadTokens: 0,
   *       cacheCreationTokens: 0,
   *       totalTokens: 200
   *     },
   *     projectPath: "/path/to/project",
   *     branch: {               // Only if createBranch=true
   *       name: "feature/xyz",
   *       url: "https://github.com/owner/repo/tree/feature/xyz"
   *     } | { error: "..." },
   *     pullRequest: {          // Only if createPR=true
   *       number: 42,
   *       url: "https://github.com/owner/repo/pull/42"
   *     } | { error: "..." }
   *   }
   *
   * Error Response:
   *   HTTP Status: 400, 401, 404 (unknown sessionId), 409 (session already mid-run), 500
   *   Content-Type: application/json
   *   { success: false, error: "Error description" }
   *
   * ================================================================================================
   * EXAMPLES
   * ================================================================================================
   *
   * Example 1: Clone and process with auto-cleanup
   *   POST /api/agent
   *   { "githubUrl": "https://github.com/user/repo", "message": "Fix bug" }
   *
   * Example 2: Use existing project with custom branch and PR
   *   POST /api/agent
   *   {
   *     "projectPath": "/home/user/project",
   *     "message": "Add feature",
   *     "branchName": "feature/new-feature",
   *     "createPR": true
   *   }
   *
   * Example 3: Clone to specific path with auto-generated branch
   *   POST /api/agent
   *   {
   *     "githubUrl": "https://github.com/user/repo",
   *     "projectPath": "/tmp/work",
   *     "message": "Refactor code",
   *     "createBranch": true,
   *     "cleanup": false
   *   }
   */
  router.post('/', validateExternalApiKey, async (req, res) => {
    const { githubUrl, projectPath, message, model, githubToken, branchName } = req.body;
    // Transport input is typed here, before anything binds it to a query:
    // the lookup below runs outside the try, where a throw would be an
    // unhandled rejection.
    if (req.body.sessionId !== undefined && req.body.sessionId !== null && typeof req.body.sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId must be a string' });
    }
    const sessionId = typeof req.body.sessionId === 'string' && req.body.sessionId.trim() ? req.body.sessionId.trim() : null;
    const requestedProvider = req.body.provider === undefined || req.body.provider === null ? null : req.body.provider;
    const effort = typeof req.body.effort === 'string' && req.body.effort.trim()
      ? req.body.effort.trim()
      : undefined;

    // Parse stream and cleanup as booleans (handle string "true"/"false" from curl)
    const stream = req.body.stream === undefined ? true : (req.body.stream === true || req.body.stream === 'true');
    const cleanup = req.body.cleanup === undefined ? true : (req.body.cleanup === true || req.body.cleanup === 'true');

    // If branchName is provided, automatically enable createBranch
    const createBranch = branchName ? true : (req.body.createBranch === true || req.body.createBranch === 'true');
    const createPR = req.body.createPR === true || req.body.createPR === 'true';

    // Validate inputs
    if (!githubUrl && !projectPath) {
      return res.status(400).json({ error: 'Either githubUrl or projectPath is required' });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    if (requestedProvider !== null && !['claude', 'cursor', 'codex', 'opencode'].includes(requestedProvider)) {
      return res.status(400).json({ error: 'provider must be "claude", "cursor", "codex", or "opencode"' });
    }

    // Validate GitHub branch/PR creation requirements
    // Allow branch/PR creation with projectPath as long as it has a GitHub remote
    if ((createBranch || createPR) && !githubUrl && !projectPath) {
      return res.status(400).json({ error: 'createBranch and createPR require either githubUrl or projectPath with a GitHub remote' });
    }

    // A run continues a session the caller names, by its app id or — for a
    // caller that stored what an earlier response called `sessionId` — the
    // provider-native one, which the row is also keyed by once indexed. The
    // row, not the request, says which provider the session belongs to, as
    // it does for a chat send; a request that names another is refused.
    let sessionRow = null;
    if (sessionId) {
      sessionRow = sessionGateway.getSessionById(sessionId) ?? sessionGateway.getSessionByProviderSessionId(sessionId);
      if (!sessionRow) {
        return res.status(404).json({ error: `Session "${sessionId}" was not found` });
      }
      if (requestedProvider !== null && requestedProvider !== sessionRow.provider) {
        return res.status(400).json({ error: `Session "${sessionRow.session_id}" belongs to provider "${sessionRow.provider}"` });
      }
      // Refused before any side effect — a clone per retry would pile up
      // under external-projects. startRun below still has the last word.
      if (runRegistry.isProcessing(sessionRow.session_id)) {
        return res.status(409).json({ error: `Session "${sessionRow.session_id}" already has a run in progress` });
      }
    }
    const provider = sessionRow?.provider ?? requestedProvider ?? 'claude';

    let finalProjectPath = null;
    let clonedProjectCreated = false;
    let writer = null;
    // The run as the chat socket registers one: on the running-sessions
    // list, subscribable from any tab, and completed on every exit path.
    let run = null;

    try {
      // Determine the final project path
      if (githubUrl) {
        // Clone repository (to projectPath if provided, otherwise generate path)
        const tokenToUse = githubToken || githubTokensDb.getActiveGithubToken(req.user.id);

        let targetPath;
        if (projectPath) {
          targetPath = projectPath;
        } else {
          // Generate a unique path for cloning
          const repoHash = crypto.createHash('md5').update(githubUrl + Date.now()).digest('hex');
          targetPath = path.join(os.homedir(), '.claude', 'external-projects', repoHash);
        }

        const clonedProject = await cloneGitHubRepo(githubUrl.trim(), tokenToUse, targetPath);
        finalProjectPath = clonedProject.path;
        clonedProjectCreated = clonedProject.created;
      } else {
        // Use existing project path
        finalProjectPath = normalizeProjectPath(path.resolve(projectPath));

        // Verify the path exists
        try {
          await fs.access(finalProjectPath);
        } catch (error) {
          throw new Error(`Project path does not exist: ${finalProjectPath}`);
        }
      }

      finalProjectPath = normalizeProjectPath(finalProjectPath);

      // A continued session runs where it lives, as a chat send does; a
      // request that resolved to another directory is not that session.
      if (sessionRow && sessionRow.project_path && normalizeProjectPath(sessionRow.project_path) !== finalProjectPath) {
        throw new Error(`Session "${sessionRow.session_id}" belongs to project ${sessionRow.project_path}, not ${finalProjectPath}`);
      }

      // Register project path in DB (or reuse existing active registration)
      const registrationResult = projectsDb.createProjectPath(finalProjectPath, null);
      if (registrationResult.outcome === 'active_conflict') {
        console.log('Project registration already exists for:', finalProjectPath);
      } else {
        console.log('Project registered:', registrationResult.project);
      }

      // A brand-new run gets its app session row first, as a chat send does:
      // the id is stable for the conversation, the sidebar can list it, and
      // the provider-native id is mapped onto it when the runtime announces it.
      const appSessionId = sessionRow
        ? sessionRow.session_id
        : sessionGateway.createAppSession(provider, finalProjectPath, message.trim()).sessionId;

      // Registered before any header goes out, so a session already mid-run
      // is refused with a plain 409 rather than an empty stream. The HTTP
      // response is the run's first audience; a tab that opens the session
      // subscribes as another, and replays what it missed.
      const audience = stream ? new SSEStreamWriter(res) : new ResponseCollector();
      run = runRegistry.startRun({
        appSessionId,
        provider,
        providerSessionId: sessionRow?.provider_session_id ?? null,
        connection: audience,
        userId: req.user.id,
      });
      if (!run) {
        if (cleanup && githubUrl && clonedProjectCreated) {
          cleanupProject(finalProjectPath, null);
        }
        return res.status(409).json({ error: `Session "${appSessionId}" already has a run in progress` });
      }
      writer = audience;

      if (stream) {
        // Set up SSE headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
      }

      // The route's own opening events. `session-id` is the app session id:
      // what the UI opens the conversation under, and what a later request
      // passes back as `sessionId` to continue it.
      writer.send({
        type: 'status',
        message: githubUrl ? 'Repository cloned and session started' : 'Session started',
        projectPath: finalProjectPath
      });
      writer.send({ type: 'session-id', sessionId: appSessionId });

      const codexModels = await providerModelsService.getProviderModels('codex');
      const opencodeModels = await providerModelsService.getProviderModels('opencode');

      // Start the appropriate session
      if (provider === 'claude') {
        console.log('🤖 Starting Claude SDK session');

        await queryClaudeSDK(message.trim(), {
          projectPath: finalProjectPath,
          cwd: finalProjectPath,
          sessionId: appSessionId,
          model: model,
          effort,
          permissionMode: 'bypassPermissions' // Bypass all permissions for API calls
        }, run.writer);

      } else if (provider === 'cursor') {
        console.log('🖱️ Starting Cursor CLI session');

        await spawnCursor(message.trim(), {
          projectPath: finalProjectPath,
          cwd: finalProjectPath,
          sessionId: appSessionId,
          model: model || undefined,
          skipPermissions: true // Bypass permissions for Cursor
        }, run.writer);
      } else if (provider === 'codex') {
        console.log('🤖 Starting Codex SDK session');

        await queryCodex(message.trim(), {
          projectPath: finalProjectPath,
          cwd: finalProjectPath,
          sessionId: appSessionId,
          model: model || codexModels.DEFAULT,
          effort,
          permissionMode: 'bypassPermissions'
        }, run.writer);
      } else if (provider === 'opencode') {
        console.log('Starting OpenCode CLI session');

        await spawnOpenCode(message.trim(), {
          projectPath: finalProjectPath,
          cwd: finalProjectPath,
          sessionId: appSessionId,
          model: model || opencodeModels.DEFAULT,
          effort,
          permissionMode: 'bypassPermissions' // Agent runs are non-interactive, like the other providers above
        }, run.writer);
      }

      // A tab can now abort the run (`chat.abort`), on which the runtime
      // returns as it does on completion. What the interrupted agent left
      // behind is not a result to branch or open a PR from.
      const aborted = run.events.some((event) => event.kind === 'complete' && event.aborted === true);
      if (aborted) {
        writer.send({ type: 'status', message: 'Run aborted', aborted: true });
      }

      // Handle GitHub branch and PR creation after successful agent completion
      let branchInfo = null;
      let prInfo = null;

      if (!aborted && (createBranch || createPR)) {
        try {
          console.log('🔄 Starting GitHub branch/PR creation workflow...');

          // Get GitHub token
          const tokenToUse = githubToken || githubTokensDb.getActiveGithubToken(req.user.id);

          if (!tokenToUse) {
            throw new Error('GitHub token required for branch/PR creation. Please configure a GitHub token in settings.');
          }

          // Initialize Octokit
          const octokit = new Octokit({ auth: tokenToUse });

          // Get GitHub URL - either from parameter or from git remote
          let repoUrl = githubUrl;
          if (!repoUrl) {
            console.log('🔍 Getting GitHub URL from git remote...');
            try {
              repoUrl = await getGitRemoteUrl(finalProjectPath);
              if (!repoUrl.includes('github.com')) {
                throw new Error('Project does not have a GitHub remote configured');
              }
              console.log(`✅ Found GitHub remote: ${repoUrl}`);
            } catch (error) {
              throw new Error(`Failed to get GitHub remote URL: ${error.message}`);
            }
          }

          // Parse GitHub URL to get owner and repo
          const { owner, repo } = parseGitHubUrl(repoUrl);
          console.log(`📦 Repository: ${owner}/${repo}`);

          // Use provided branch name or auto-generate from message
          const finalBranchName = branchName || autogenerateBranchName(message);
          if (branchName) {
            console.log(`🌿 Using provided branch name: ${finalBranchName}`);

            // Validate custom branch name
            const validation = validateBranchName(finalBranchName);
            if (!validation.valid) {
              throw new Error(`Invalid branch name: ${validation.error}`);
            }
          } else {
            console.log(`🌿 Auto-generated branch name: ${finalBranchName}`);
          }

          if (createBranch) {
            // Create and checkout the new branch locally
            console.log('🔄 Creating local branch...');
            const checkoutProcess = spawn('git', ['checkout', '-b', finalBranchName], {
              cwd: finalProjectPath,
              stdio: 'pipe'
            });

            await new Promise((resolve, reject) => {
              let stderr = '';
              checkoutProcess.stderr.on('data', (data) => { stderr += data.toString(); });
              checkoutProcess.on('close', (code) => {
                if (code === 0) {
                  console.log(`✅ Created and checked out local branch '${finalBranchName}'`);
                  resolve();
                } else {
                  // Branch might already exist locally, try to checkout
                  if (stderr.includes('already exists')) {
                    console.log(`ℹ️ Branch '${finalBranchName}' already exists locally, checking out...`);
                    const checkoutExisting = spawn('git', ['checkout', finalBranchName], {
                      cwd: finalProjectPath,
                      stdio: 'pipe'
                    });
                    checkoutExisting.on('close', (checkoutCode) => {
                      if (checkoutCode === 0) {
                        console.log(`✅ Checked out existing branch '${finalBranchName}'`);
                        resolve();
                      } else {
                        reject(new Error(`Failed to checkout existing branch: ${stderr}`));
                      }
                    });
                  } else {
                    reject(new Error(`Failed to create branch: ${stderr}`));
                  }
                }
              });
            });

            // Push the branch to remote
            console.log('🔄 Pushing branch to remote...');
            const pushProcess = spawn('git', ['push', '-u', 'origin', finalBranchName], {
              cwd: finalProjectPath,
              stdio: 'pipe'
            });

            await new Promise((resolve, reject) => {
              let stderr = '';
              let stdout = '';
              pushProcess.stdout.on('data', (data) => { stdout += data.toString(); });
              pushProcess.stderr.on('data', (data) => { stderr += data.toString(); });
              pushProcess.on('close', (code) => {
                if (code === 0) {
                  console.log(`✅ Pushed branch '${finalBranchName}' to remote`);
                  resolve();
                } else {
                  // Check if branch exists on remote but has different commits
                  if (stderr.includes('already exists') || stderr.includes('up-to-date')) {
                    console.log(`ℹ️ Branch '${finalBranchName}' already exists on remote, using existing branch`);
                    resolve();
                  } else {
                    reject(new Error(`Failed to push branch: ${stderr}`));
                  }
                }
              });
            });

            branchInfo = {
              name: finalBranchName,
              url: `https://github.com/${owner}/${repo}/tree/${finalBranchName}`
            };
          }

          if (createPR) {
            // Get commit messages to generate PR description
            console.log('🔄 Generating PR title and description...');
            const commitMessages = await getCommitMessages(finalProjectPath, 5);

            // Use the first commit message as the PR title, or fallback to the agent message
            const prTitle = commitMessages.length > 0 ? commitMessages[0] : message;

            // Generate PR body from commit messages
            let prBody = '## Changes\n\n';
            if (commitMessages.length > 0) {
              prBody += commitMessages.map(msg => `- ${msg}`).join('\n');
            } else {
              prBody += `Agent task: ${message}`;
            }
            prBody += '\n\n---\n*This pull request was automatically created by CloudCLI.ai Agent.*';

            console.log(`📝 PR Title: ${prTitle}`);

            // Create the pull request
            console.log('🔄 Creating pull request...');
            prInfo = await createGitHubPR(octokit, owner, repo, finalBranchName, prTitle, prBody, 'main');
          }

          // Send branch/PR info in response
          if (stream) {
            if (branchInfo) {
              writer.send({
                type: 'github-branch',
                branch: branchInfo
              });
            }
            if (prInfo) {
              writer.send({
                type: 'github-pr',
                pullRequest: prInfo
              });
            }
          }

        } catch (error) {
          console.error('❌ GitHub branch/PR creation error:', error);

          // Send error but don't fail the entire request
          if (stream) {
            writer.send({
              type: 'github-error',
              error: error.message
            });
          }
          // Store error info for non-streaming response
          if (!stream) {
            branchInfo = { error: error.message };
            prInfo = { error: error.message };
          }
        }
      }

      // Handle response based on streaming mode
      if (stream) {
        // Streaming mode: end the SSE stream
        writer.end();
      } else {
        // Non-streaming mode: send filtered messages and token summary as JSON
        const assistantMessages = writer.getAssistantMessages();
        const tokenSummary = writer.getTotalTokens();

        const response = {
          success: !aborted,
          ...(aborted ? { aborted: true } : {}),
          sessionId: appSessionId,
          // The provider-native id, for a caller that drives the CLI itself
          // (`claude --resume`); `sessionId` is what this API and the UI use.
          providerSessionId: run.writer.getSessionId(),
          messages: assistantMessages,
          tokens: tokenSummary,
          projectPath: finalProjectPath
        };

        // Add branch/PR info if created
        if (branchInfo) {
          response.branch = branchInfo;
        }
        if (prInfo) {
          response.pullRequest = prInfo;
        }

        res.json(response);
      }

      // Clean up if requested
      if (cleanup && githubUrl && clonedProjectCreated) {
        // Only cleanup if we cloned a repo (not for existing project paths)
        const sessionIdForCleanup = run.writer.getSessionId();
        setTimeout(() => {
          cleanupProject(finalProjectPath, sessionIdForCleanup);
        }, 5000);
      }

    } catch (error) {
      console.error('❌ External session error:', error);

      // Clean up on error
      if (finalProjectPath && cleanup && githubUrl && clonedProjectCreated) {
        const sessionIdForCleanup = run ? run.writer.getSessionId() : null;
        cleanupProject(finalProjectPath, sessionIdForCleanup);
      }

      if (stream) {
        // For streaming, send error event and stop
        if (!writer) {
          // Set up SSE headers if not already done
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          writer = new SSEStreamWriter(res);
        }

        if (!res.writableEnded) {
          writer.send({
            type: 'error',
            error: error.message,
            message: `Failed: ${error.message}`
          });
          writer.end();
        }
      } else if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    } finally {
      // Safety net, as for a chat send: a runtime that threw or resolved
      // without its terminal `complete` would leave the session listed as
      // running in every tab. Scoped to this run, so a run the session
      // started meanwhile is left alone.
      if (run) {
        runRegistry.completeRunIfCurrent(run, { exitCode: 1 });
      }
    }
  });

  return router;
}
