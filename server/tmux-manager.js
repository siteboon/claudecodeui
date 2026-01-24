/**
 * tmux Session Manager
 *
 * Manages tmux sessions for multi-client shell sharing.
 * Each Claude Code UI session can be backed by a tmux session,
 * allowing multiple clients to connect to the same shell.
 *
 * Session naming convention: claudeui-{projectHash}-{sessionId}
 */

const { execFileSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const os = require("os");

// tmux availability cache
let tmuxAvailable = null;
let tmuxVersion = null;

/**
 * Check if tmux is installed and available
 * @returns {{ available: boolean, version?: string, error?: string }}
 */
function checkTmuxAvailable() {
  if (tmuxAvailable !== null) {
    return { available: tmuxAvailable, version: tmuxVersion };
  }

  try {
    const result = spawnSync("tmux", ["-V"], { encoding: "utf8" });
    if (result.status === 0) {
      tmuxAvailable = true;
      tmuxVersion = result.stdout.trim();
      return { available: true, version: tmuxVersion };
    }
    throw new Error("tmux command failed");
  } catch {
    tmuxAvailable = false;
    const installHint =
      os.platform() === "darwin"
        ? "brew install tmux"
        : "apt install tmux or yum install tmux";
    return {
      available: false,
      error: `tmux not found. Install with: ${installHint}`,
    };
  }
}

/**
 * Generate a short hash from a project path for session naming
 * @param {string} projectPath - The project directory path
 * @returns {string} - A short hash (first 8 chars)
 */
function hashProjectPath(projectPath) {
  return crypto.createHash("md5").update(projectPath).digest("hex").slice(0, 8);
}

/**
 * Generate a tmux session name from project and session info
 * @param {string} projectPath - The project directory path
 * @param {string} sessionId - The Claude/Cursor session ID
 * @returns {string} - tmux session name
 */
function generateTmuxSessionName(projectPath, sessionId) {
  const projectHash = hashProjectPath(projectPath);
  // tmux session names can't contain periods or colons
  const cleanSessionId = sessionId.replace(/[.:]/g, "-");
  return `claudeui-${projectHash}-${cleanSessionId}`;
}

/**
 * Check if a tmux session exists
 * @param {string} tmuxSessionName - The tmux session name
 * @returns {boolean}
 */
function sessionExists(tmuxSessionName) {
  try {
    const result = spawnSync("tmux", ["has-session", "-t", tmuxSessionName], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Create a new tmux session
 * @param {string} projectPath - Working directory for the session
 * @param {string} sessionId - The Claude/Cursor session ID
 * @param {object} options - Additional options
 * @param {number} options.cols - Terminal columns
 * @param {number} options.rows - Terminal rows
 * @param {string} options.shell - Shell to use (default: user's shell or bash)
 * @returns {{ success: boolean, tmuxSessionName?: string, error?: string }}
 */
function createTmuxSession(projectPath, sessionId, options = {}) {
  const tmuxCheck = checkTmuxAvailable();
  if (!tmuxCheck.available) {
    return { success: false, error: tmuxCheck.error };
  }

  const tmuxSessionName = generateTmuxSessionName(projectPath, sessionId);

  // Check if session already exists
  if (sessionExists(tmuxSessionName)) {
    return { success: true, tmuxSessionName, existed: true };
  }

  const { cols = 80, rows = 24 } = options;
  const shell = options.shell || process.env.SHELL || "/bin/bash";

  try {
    // Create detached tmux session with specified dimensions
    // -d: detached, -s: session name, -c: start directory, -x/-y: dimensions
    const result = spawnSync(
      "tmux",
      [
        "new-session",
        "-d",
        "-s",
        tmuxSessionName,
        "-c",
        projectPath,
        "-x",
        String(cols),
        "-y",
        String(rows),
      ],
      {
        encoding: "utf8",
        stdio: "pipe",
        env: {
          ...process.env,
          SHELL: shell,
        },
      },
    );

    if (result.status !== 0) {
      throw new Error(result.stderr || "Failed to create tmux session");
    }

    console.log(`[TmuxManager] Created session: ${tmuxSessionName}`);
    return { success: true, tmuxSessionName, existed: false };
  } catch (err) {
    console.error(`[TmuxManager] Failed to create session:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Attach to an existing tmux session using a PTY
 * @param {string} tmuxSessionName - The tmux session name
 * @param {object} pty - node-pty module reference
 * @param {object} options - PTY options
 * @returns {{ pty: IPty, attached: boolean } | null}
 */
function attachToTmuxSession(tmuxSessionName, pty, options = {}) {
  const tmuxCheck = checkTmuxAvailable();
  if (!tmuxCheck.available) {
    console.error("[TmuxManager] tmux not available");
    return null;
  }

  if (!sessionExists(tmuxSessionName)) {
    console.error(`[TmuxManager] Session does not exist: ${tmuxSessionName}`);
    return null;
  }

  const { cols = 80, rows = 24 } = options;

  try {
    // Create PTY that attaches to tmux session
    const ptyProcess = pty.spawn(
      "tmux",
      ["attach-session", "-t", tmuxSessionName],
      {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.env.HOME,
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
      },
    );

    console.log(`[TmuxManager] Attached to session: ${tmuxSessionName}`);
    return { pty: ptyProcess, attached: true };
  } catch (err) {
    console.error(`[TmuxManager] Failed to attach:`, err.message);
    return null;
  }
}

/**
 * List all Claude Code UI tmux sessions
 * @returns {Array<{ name: string, projectHash: string, sessionId: string, windows: number, attached: boolean, created: Date }>}
 */
function listClaudeSessions() {
  const tmuxCheck = checkTmuxAvailable();
  if (!tmuxCheck.available) {
    return [];
  }

  try {
    // Get all sessions with format: name:windows:attached:created
    const result = spawnSync(
      "tmux",
      [
        "list-sessions",
        "-F",
        "#{session_name}:#{session_windows}:#{session_attached}:#{session_created}",
      ],
      { encoding: "utf8", stdio: "pipe" },
    );

    if (result.status !== 0) {
      return [];
    }

    const sessions = [];
    const lines = result.stdout.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const [name, windows, attached, created] = line.split(":");

      // Only include claudeui sessions
      if (!name.startsWith("claudeui-")) {
        continue;
      }

      // Parse session name: claudeui-{projectHash}-{sessionId}
      const parts = name.replace("claudeui-", "").split("-");
      const projectHash = parts[0];
      const sessionId = parts.slice(1).join("-");

      sessions.push({
        name,
        projectHash,
        sessionId,
        windows: parseInt(windows, 10),
        attached: attached === "1",
        created: new Date(parseInt(created, 10) * 1000),
      });
    }

    return sessions;
  } catch {
    // No sessions or tmux server not running
    return [];
  }
}

/**
 * Kill a tmux session
 * @param {string} tmuxSessionName - The session name to kill
 * @returns {boolean} - True if session was killed
 */
function killSession(tmuxSessionName) {
  try {
    const result = spawnSync("tmux", ["kill-session", "-t", tmuxSessionName], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (result.status === 0) {
      console.log(`[TmuxManager] Killed session: ${tmuxSessionName}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Send keys to a tmux session (for input broadcasting)
 * @param {string} tmuxSessionName - The session name
 * @param {string} keys - The keys to send
 * @returns {boolean}
 */
function sendKeysToSession(tmuxSessionName, keys) {
  try {
    // Use send-keys with literal flag (-l)
    const result = spawnSync(
      "tmux",
      ["send-keys", "-t", tmuxSessionName, "-l", keys],
      {
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Resize a tmux session window
 * @param {string} tmuxSessionName - The session name
 * @param {number} cols - New columns
 * @param {number} rows - New rows
 * @returns {boolean}
 */
function resizeSession(tmuxSessionName, cols, rows) {
  try {
    const result = spawnSync(
      "tmux",
      [
        "resize-window",
        "-t",
        tmuxSessionName,
        "-x",
        String(cols),
        "-y",
        String(rows),
      ],
      {
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Get session info
 * @param {string} tmuxSessionName - The session name
 * @returns {{ windows: number, attached: number, created: Date } | null}
 */
function getSessionInfo(tmuxSessionName) {
  try {
    const result = spawnSync(
      "tmux",
      [
        "display-message",
        "-t",
        tmuxSessionName,
        "-p",
        "#{session_windows}:#{session_attached}:#{session_created}",
      ],
      { encoding: "utf8", stdio: "pipe" },
    );

    if (result.status !== 0) {
      return null;
    }

    const [windows, attached, created] = result.stdout.trim().split(":");

    return {
      windows: parseInt(windows, 10),
      attached: parseInt(attached, 10),
      created: new Date(parseInt(created, 10) * 1000),
    };
  } catch {
    return null;
  }
}

/**
 * Clean up old/stale tmux sessions
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 24 hours)
 * @returns {number} - Number of sessions cleaned up
 */
function cleanupStaleSessions(maxAgeMs = 24 * 60 * 60 * 1000) {
  const sessions = listClaudeSessions();
  const now = Date.now();
  let cleaned = 0;

  for (const session of sessions) {
    // Only clean up sessions that are not attached and are old
    if (!session.attached && now - session.created.getTime() > maxAgeMs) {
      if (killSession(session.name)) {
        cleaned++;
      }
    }
  }

  return cleaned;
}

module.exports = {
  checkTmuxAvailable,
  hashProjectPath,
  generateTmuxSessionName,
  sessionExists,
  createTmuxSession,
  attachToTmuxSession,
  listClaudeSessions,
  killSession,
  sendKeysToSession,
  resizeSession,
  getSessionInfo,
  cleanupStaleSessions,
};
