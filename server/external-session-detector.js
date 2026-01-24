/**
 * External Claude Session Detector
 *
 * Detects Claude CLI sessions running outside of this application.
 * This helps prevent conflicts when users have both the UI and CLI
 * running simultaneously on the same project.
 *
 * Detection methods:
 * 1. Process detection via pgrep/ps
 * 2. tmux session scanning
 * 3. Session lock file detection (.claude/session.lock)
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Cache to avoid repeated process scans
const detectionCache = new Map();
const CACHE_TTL = 5000; // 5 seconds

/**
 * Get the current process ID (for exclusion)
 */
const currentPid = process.pid;

/**
 * Detect external Claude processes
 * @returns {Array<{ pid: number, command: string, cwd: string | null }>}
 */
function detectClaudeProcesses() {
  const processes = [];

  if (os.platform() === "win32") {
    // Windows: use wmic or tasklist
    try {
      const result = spawnSync(
        "wmic",
        [
          "process",
          "where",
          "name like '%claude%'",
          "get",
          "processid,commandline",
        ],
        { encoding: "utf8", stdio: "pipe" },
      );

      if (result.status === 0) {
        const lines = result.stdout.trim().split("\n").slice(1); // Skip header
        for (const line of lines) {
          const match = line.match(/(\d+)\s*$/);
          if (match) {
            const pid = parseInt(match[1], 10);
            if (pid !== currentPid) {
              processes.push({ pid, command: line.trim(), cwd: null });
            }
          }
        }
      }
    } catch {
      // Ignore errors on Windows
    }
  } else {
    // Unix: use pgrep and ps
    try {
      // First, get PIDs of claude processes
      const pgrepResult = spawnSync("pgrep", ["-f", "claude"], {
        encoding: "utf8",
        stdio: "pipe",
      });

      if (pgrepResult.status === 0) {
        const pids = pgrepResult.stdout.trim().split("\n").filter(Boolean);

        for (const pidStr of pids) {
          const pid = parseInt(pidStr, 10);

          // Skip our own process and child processes
          if (pid === currentPid) continue;

          // Get command details
          const psResult = spawnSync("ps", ["-p", String(pid), "-o", "args="], {
            encoding: "utf8",
            stdio: "pipe",
          });

          if (psResult.status === 0) {
            const command = psResult.stdout.trim();

            // Filter out our own subprocesses (claude-sdk spawned by this app)
            // and only include standalone claude CLI invocations
            if (isExternalClaudeProcess(command)) {
              // Try to get working directory via lsof
              let cwd = null;
              try {
                const lsofResult = spawnSync(
                  "lsof",
                  ["-p", String(pid), "-Fn"],
                  {
                    encoding: "utf8",
                    stdio: "pipe",
                  },
                );
                if (lsofResult.status === 0) {
                  const cwdMatch = lsofResult.stdout.match(/n(\/[^\n]+)/);
                  if (cwdMatch) {
                    cwd = cwdMatch[1];
                  }
                }
              } catch {
                // lsof may not be available
              }

              processes.push({ pid, command, cwd });
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return processes;
}

/**
 * Check if a command is an external Claude process (not spawned by us)
 * @param {string} command - The process command line
 * @returns {boolean}
 */
function isExternalClaudeProcess(command) {
  // Skip node processes (SDK internals)
  if (command.startsWith("node ")) return false;

  // Skip our own server
  if (command.includes("claudecodeui/server")) return false;

  // Look for actual claude CLI invocations
  return (
    command.includes("claude ") ||
    command.includes("claude-code") ||
    command.match(/\/claude\s/) ||
    command.endsWith("/claude")
  );
}

/**
 * Detect tmux sessions that might be running Claude
 * @returns {Array<{ sessionName: string, windows: number, attached: boolean }>}
 */
function detectClaudeTmuxSessions() {
  const sessions = [];

  try {
    const result = spawnSync(
      "tmux",
      [
        "list-sessions",
        "-F",
        "#{session_name}:#{session_windows}:#{session_attached}",
      ],
      { encoding: "utf8", stdio: "pipe" },
    );

    if (result.status === 0) {
      const lines = result.stdout.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        const [sessionName, windows, attached] = line.split(":");

        // Skip our own sessions
        if (sessionName.startsWith("claudeui-")) continue;

        // Check if session might be running Claude
        // We can peek at the pane content or just check window titles
        if (mightBeClaudeSession(sessionName)) {
          sessions.push({
            sessionName,
            windows: parseInt(windows, 10),
            attached: attached === "1",
          });
        }
      }
    }
  } catch {
    // tmux not available or no server running
  }

  return sessions;
}

/**
 * Heuristic check if a tmux session might be running Claude
 * @param {string} sessionName - The session name
 * @returns {boolean}
 */
function mightBeClaudeSession(sessionName) {
  // Check common patterns
  const claudePatterns = ["claude", "ai", "chat", "code"];
  const lowerName = sessionName.toLowerCase();

  for (const pattern of claudePatterns) {
    if (lowerName.includes(pattern)) return true;
  }

  // Try to peek at the session's current command
  try {
    const result = spawnSync(
      "tmux",
      ["display-message", "-t", sessionName, "-p", "#{pane_current_command}"],
      { encoding: "utf8", stdio: "pipe" },
    );

    if (result.status === 0) {
      const currentCommand = result.stdout.trim().toLowerCase();
      if (currentCommand.includes("claude")) return true;
    }
  } catch {
    // Ignore
  }

  return false;
}

/**
 * Check for session lock files in a project directory
 * @param {string} projectPath - The project directory to check
 * @returns {{ exists: boolean, lockFile: string | null, content: object | null }}
 */
function checkSessionLockFile(projectPath) {
  const lockFile = path.join(projectPath, ".claude", "session.lock");

  try {
    if (fs.existsSync(lockFile)) {
      const content = fs.readFileSync(lockFile, "utf8");
      try {
        const lockData = JSON.parse(content);

        // Check if the lock is stale (process no longer exists)
        if (lockData.pid) {
          const isAlive = processExists(lockData.pid);
          if (!isAlive) {
            // Stale lock file, clean it up
            try {
              fs.unlinkSync(lockFile);
            } catch {
              // Ignore cleanup errors
            }
            return { exists: false, lockFile: null, content: null };
          }
        }

        return { exists: true, lockFile, content: lockData };
      } catch {
        // Invalid JSON, treat as text lock
        return { exists: true, lockFile, content: { raw: content } };
      }
    }
  } catch {
    // Cannot read lock file
  }

  return { exists: false, lockFile: null, content: null };
}

/**
 * Check if a process exists
 * @param {number} pid - Process ID
 * @returns {boolean}
 */
function processExists(pid) {
  try {
    // Sending signal 0 checks if process exists without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Main detection function - detect all external Claude sessions
 * @param {string} projectPath - The project directory to check
 * @returns {{ hasExternalSession: boolean, processes: Array, tmuxSessions: Array, lockFile: object }}
 */
function detectExternalClaude(projectPath) {
  // Check cache
  const cacheKey = projectPath || "__global__";
  const cached = detectionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  const result = {
    hasExternalSession: false,
    processes: [],
    tmuxSessions: [],
    lockFile: { exists: false, lockFile: null, content: null },
  };

  // Detect processes
  result.processes = detectClaudeProcesses();
  if (projectPath) {
    // Filter to processes in this project
    result.processes = result.processes.filter(
      (p) => !p.cwd || p.cwd.startsWith(projectPath),
    );
  }

  // Detect tmux sessions
  result.tmuxSessions = detectClaudeTmuxSessions();

  // Check lock file
  if (projectPath) {
    result.lockFile = checkSessionLockFile(projectPath);
  }

  // Determine if there's an external session
  result.hasExternalSession =
    result.processes.length > 0 ||
    result.tmuxSessions.length > 0 ||
    result.lockFile.exists;

  // Cache the result
  detectionCache.set(cacheKey, {
    timestamp: Date.now(),
    result,
  });

  return result;
}

/**
 * Clear the detection cache
 */
function clearCache() {
  detectionCache.clear();
}

/**
 * Create a session lock file for this application
 * @param {string} projectPath - The project directory
 * @param {string} sessionId - The session ID
 * @returns {boolean}
 */
function createSessionLock(projectPath, sessionId) {
  const claudeDir = path.join(projectPath, ".claude");
  const lockFile = path.join(claudeDir, "session.lock");

  try {
    // Ensure .claude directory exists
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    const lockData = {
      pid: process.pid,
      sessionId,
      createdAt: new Date().toISOString(),
      app: "claudecodeui",
    };

    fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));
    return true;
  } catch (err) {
    console.error(
      "[ExternalSessionDetector] Failed to create lock file:",
      err.message,
    );
    return false;
  }
}

/**
 * Remove a session lock file
 * @param {string} projectPath - The project directory
 * @returns {boolean}
 */
function removeSessionLock(projectPath) {
  const lockFile = path.join(projectPath, ".claude", "session.lock");

  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
    return true;
  } catch {
    return false;
  }
}

export {
  detectExternalClaude,
  detectClaudeProcesses,
  detectClaudeTmuxSessions,
  checkSessionLockFile,
  createSessionLock,
  removeSessionLock,
  clearCache,
};
