import express from "express";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

const router = express.Router();

router.get("/claude/status", async (req, res) => {
  try {
    const credentialsResult = await checkClaudeCredentials();

    if (credentialsResult.authenticated) {
      return res.json({
        authenticated: true,
        email: credentialsResult.email || "Authenticated",
        method: "credentials_file",
      });
    }

    return res.json({
      authenticated: false,
      email: null,
      error: credentialsResult.error || "Not authenticated",
    });
  } catch (error) {
    console.error("Error checking Claude auth status:", error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message,
    });
  }
});

router.get("/cursor/status", async (req, res) => {
  try {
    const result = await checkCursorStatus();

    res.json({
      authenticated: result.authenticated,
      email: result.email,
      error: result.error,
    });
  } catch (error) {
    console.error("Error checking Cursor auth status:", error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message,
    });
  }
});

router.get("/codex/status", async (req, res) => {
  try {
    const result = await checkCodexCredentials();

    res.json({
      authenticated: result.authenticated,
      email: result.email,
      error: result.error,
    });
  } catch (error) {
    console.error("Error checking Codex auth status:", error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message,
    });
  }
});

async function checkClaudeCredentials() {
  // On macOS, Claude Code stores credentials in the Keychain, not a file
  if (process.platform === "darwin") {
    const keychainResult = await checkMacOSKeychain();
    if (keychainResult.authenticated) {
      return keychainResult;
    }
  }

  // Fall back to file-based credentials (Linux, Windows, or if keychain check fails)
  try {
    const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
    const content = await fs.readFile(credPath, "utf8");
    const creds = JSON.parse(content);

    const oauth = creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      const isExpired = oauth.expiresAt && Date.now() >= oauth.expiresAt;

      if (!isExpired) {
        return {
          authenticated: true,
          email: creds.email || creds.user || null,
          method: "credentials_file",
        };
      }
    }

    return {
      authenticated: false,
      email: null,
    };
  } catch (error) {
    return {
      authenticated: false,
      email: null,
    };
  }
}

// Check macOS Keychain for Claude credentials
function checkMacOSKeychain() {
  return new Promise((resolve) => {
    // Claude Code uses "claude.ai" as the service name for OAuth tokens
    // Try multiple possible service names that Claude might use
    const serviceNames = [
      "claude.ai",
      "Claude",
      "claude-code",
      "anthropic.com",
    ];

    let attempts = 0;
    const tryNextService = () => {
      if (attempts >= serviceNames.length) {
        resolve({ authenticated: false, email: null });
        return;
      }

      const serviceName = serviceNames[attempts];
      attempts++;

      const childProcess = spawn("security", [
        "find-generic-password",
        "-s",
        serviceName,
        "-w", // Output only the password
      ]);

      let stdout = "";
      let stderr = "";

      childProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      childProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      childProcess.on("close", (code) => {
        if (code === 0 && stdout.trim()) {
          // Found a credential - try to parse it as JSON (Claude stores OAuth data as JSON)
          try {
            const creds = JSON.parse(stdout.trim());
            // Check if it looks like valid OAuth data
            if (creds.accessToken || creds.claudeAiOauth?.accessToken) {
              const oauth = creds.claudeAiOauth || creds;
              const isExpired =
                oauth.expiresAt && Date.now() >= oauth.expiresAt;

              if (!isExpired) {
                resolve({
                  authenticated: true,
                  email: creds.email || oauth.email || "Keychain Auth",
                  method: "macos_keychain",
                });
                return;
              }
            }
          } catch {
            // Not JSON - might still be valid if it's just a token string
            // Consider it authenticated if we got any non-empty value
            resolve({
              authenticated: true,
              email: "Keychain Auth",
              method: "macos_keychain",
            });
            return;
          }
        }
        // Try next service name
        tryNextService();
      });

      childProcess.on("error", () => {
        // Try next service name
        tryNextService();
      });
    };

    tryNextService();
  });
}

function checkCursorStatus() {
  return new Promise((resolve) => {
    let processCompleted = false;

    const timeout = setTimeout(() => {
      if (!processCompleted) {
        processCompleted = true;
        if (childProcess) {
          childProcess.kill();
        }
        resolve({
          authenticated: false,
          email: null,
          error: "Command timeout",
        });
      }
    }, 5000);

    let childProcess;
    try {
      childProcess = spawn("cursor-agent", ["status"]);
    } catch (err) {
      clearTimeout(timeout);
      processCompleted = true;
      resolve({
        authenticated: false,
        email: null,
        error: "Cursor CLI not found or not installed",
      });
      return;
    }

    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    childProcess.on("close", (code) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      if (code === 0) {
        const emailMatch = stdout.match(
          /Logged in as ([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        );

        if (emailMatch) {
          resolve({
            authenticated: true,
            email: emailMatch[1],
            output: stdout,
          });
        } else if (stdout.includes("Logged in")) {
          resolve({
            authenticated: true,
            email: "Logged in",
            output: stdout,
          });
        } else {
          resolve({
            authenticated: false,
            email: null,
            error: "Not logged in",
          });
        }
      } else {
        resolve({
          authenticated: false,
          email: null,
          error: stderr || "Not logged in",
        });
      }
    });

    childProcess.on("error", (err) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      resolve({
        authenticated: false,
        email: null,
        error: "Cursor CLI not found or not installed",
      });
    });
  });
}

async function checkCodexCredentials() {
  try {
    const authPath = path.join(os.homedir(), ".codex", "auth.json");
    const content = await fs.readFile(authPath, "utf8");
    const auth = JSON.parse(content);

    // Tokens are nested under 'tokens' key
    const tokens = auth.tokens || {};

    // Check for valid tokens (id_token or access_token)
    if (tokens.id_token || tokens.access_token) {
      // Try to extract email from id_token JWT payload
      let email = "Authenticated";
      if (tokens.id_token) {
        try {
          // JWT is base64url encoded: header.payload.signature
          const parts = tokens.id_token.split(".");
          if (parts.length >= 2) {
            // Decode the payload (second part)
            const payload = JSON.parse(
              Buffer.from(parts[1], "base64url").toString("utf8"),
            );
            email = payload.email || payload.user || "Authenticated";
          }
        } catch {
          // If JWT decoding fails, use fallback
          email = "Authenticated";
        }
      }

      return {
        authenticated: true,
        email,
      };
    }

    // Also check for OPENAI_API_KEY as fallback auth method
    if (auth.OPENAI_API_KEY) {
      return {
        authenticated: true,
        email: "API Key Auth",
      };
    }

    return {
      authenticated: false,
      email: null,
      error: "No valid tokens found",
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        authenticated: false,
        email: null,
        error: "Codex not configured",
      };
    }
    return {
      authenticated: false,
      email: null,
      error: error.message,
    };
  }
}

export default router;
