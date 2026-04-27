/**
 * PROJECT DISCOVERY AND MANAGEMENT
 * ================================
 *
 * After the projectName → projectId migration, project and session listings
 * for `GET /api/projects` are sourced entirely from the database:
 *
 *   - `projects` table (via `projectsDb`) — the canonical list of projects and
 *     their absolute `project_path`.
 *   - `sessions` table (via `sessionsDb`) — every provider's sessions for a
 *     given project, keyed by `project_path`.
 *
 * Routes always address a project by its DB `projectId` and resolve the real
 * directory through `getProjectPathById` before touching disk.
 *
 * The filesystem-aware helpers kept in this module serve the remaining
 * features that still need on-disk data:
 *   - Session message reads for each provider (Claude/Codex/Gemini) for
 *     `GET /api/providers/sessions/:sessionId/messages`.
 *   - (Project row removal / JSONL cleanup is handled in
 *     `modules/projects/services/project-delete.service.ts`.)
 */

import fsSync, { promises as fs } from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';

import { projectsDb } from './modules/database/index.js';

/**
 * Resolve the absolute project path for a database `projectId`.
 *
 * After the projectName → projectId migration, every API route receives a
 * `projectId` (the primary key from the `projects` table) and must translate
 * it into the real directory on disk through this helper. Returns `null` when
 * the id doesn't match any row so callers can respond with a 404.
 */
async function getProjectPathById(projectId) {
  if (!projectId) {
    return null;
  }

  return projectsDb.getProjectPathById(projectId);
}

/**
 * Compute the Claude CLI project folder name for an absolute path.
 *
 * Claude stores its JSONL history per project under
 * `~/.claude/projects/<encoded-path>/`. The folder name is derived from the
 * absolute path by replacing every non-alphanumeric character (except `-`) with
 * `-`. Filesystem helpers like `getSessions`/`deleteSession` still work on that
 * folder name, so routes that receive a `projectId` compute it from the path
 * resolved through the DB instead of keeping the encoded name as an identifier.
 */
function claudeFolderNameFromPath(projectPath) {
  if (!projectPath) {
    return '';
  }

  return projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

async function getSessions(projectName, limit = 5, offset = 0) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    // agent-*.jsonl files contain session start data at this point. This needs to be revisited
    // periodically to make sure only accurate data is there and no new functionality is added there
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { sessions: [], hasMore: false, total: 0 };
    }

    // Sort files by modification time (newest first)
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );
    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    const allSessions = new Map();
    const allEntries = [];
    const uuidToSessionMap = new Map();

    // Collect all sessions and entries from all files
    for (const { file } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const result = await parseJsonlSessions(jsonlFile);

      result.sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });

      allEntries.push(...result.entries);

      // Early exit optimization for large projects
      if (allSessions.size >= (limit + offset) * 2 && allEntries.length >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }

    // Build UUID-to-session mapping for timeline detection
    allEntries.forEach(entry => {
      if (entry.uuid && entry.sessionId) {
        uuidToSessionMap.set(entry.uuid, entry.sessionId);
      }
    });

    // Group sessions by first user message ID
    const sessionGroups = new Map(); // firstUserMsgId -> { latestSession, allSessions[] }
    const sessionToFirstUserMsgId = new Map(); // sessionId -> firstUserMsgId

    // Find the first user message for each session
    allEntries.forEach(entry => {
      if (entry.sessionId && entry.type === 'user' && entry.parentUuid === null && entry.uuid) {
        // This is a first user message in a session (parentUuid is null)
        const firstUserMsgId = entry.uuid;

        if (!sessionToFirstUserMsgId.has(entry.sessionId)) {
          sessionToFirstUserMsgId.set(entry.sessionId, firstUserMsgId);

          const session = allSessions.get(entry.sessionId);
          if (session) {
            if (!sessionGroups.has(firstUserMsgId)) {
              sessionGroups.set(firstUserMsgId, {
                latestSession: session,
                allSessions: [session]
              });
            } else {
              const group = sessionGroups.get(firstUserMsgId);
              group.allSessions.push(session);

              // Update latest session if this one is more recent
              if (new Date(session.lastActivity) > new Date(group.latestSession.lastActivity)) {
                group.latestSession = session;
              }
            }
          }
        }
      }
    });

    // Collect all sessions that don't belong to any group (standalone sessions)
    const groupedSessionIds = new Set();
    sessionGroups.forEach(group => {
      group.allSessions.forEach(session => groupedSessionIds.add(session.id));
    });

    const standaloneSessionsArray = Array.from(allSessions.values())
      .filter(session => !groupedSessionIds.has(session.id));

    // Combine grouped sessions (only show latest from each group) + standalone sessions
    const latestFromGroups = Array.from(sessionGroups.values()).map(group => {
      const session = { ...group.latestSession };
      // Add metadata about grouping
      if (group.allSessions.length > 1) {
        session.isGrouped = true;
        session.groupSize = group.allSessions.length;
        session.groupSessions = group.allSessions.map(s => s.id);
      }
      return session;
    });
    const visibleSessions = [...latestFromGroups, ...standaloneSessionsArray]
      .filter(session => !session.summary.startsWith('{ "'))
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    const total = visibleSessions.length;
    const paginatedSessions = visibleSessions.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading sessions for project ${projectName}:`, error);
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath) {
  const sessions = new Map();
  const entries = [];
  const pendingSummaries = new Map(); // leafUuid -> summary for entries without sessionId
  const latestUserTextBySession = new Map();
  const latestAssistantTextBySession = new Map();

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);

          // Handle summary entries that don't have sessionId yet
          if (entry.type === 'summary' && entry.summary && !entry.sessionId && entry.leafUuid) {
            pendingSummaries.set(entry.leafUuid, entry.summary);
          }

          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: 'New Session',
                messageCount: 0,
                lastActivity: new Date(),
              });
            }

            const session = sessions.get(entry.sessionId);

            // Apply pending summary if this entry has a parentUuid that matches a pending summary
            if (session.summary === 'New Session' && entry.parentUuid && pendingSummaries.has(entry.parentUuid)) {
              session.summary = pendingSummaries.get(entry.parentUuid);
            }

            // Update summary from summary entries with sessionId
            if (entry.type === 'summary' && entry.summary) {
              session.summary = entry.summary;
            }

            // Track last user and assistant messages (skip system messages)
            if (entry.message?.role === 'user' && entry.message?.content) {
              const content = entry.message.content;

              // Extract text from array format if needed
              let textContent = content;
              if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
                textContent = content[0].text;
              }

              const isSystemMessage = typeof textContent === 'string' && (
                textContent.startsWith('<command-name>') ||
                textContent.startsWith('<command-message>') ||
                textContent.startsWith('<command-args>') ||
                textContent.startsWith('<local-command-stdout>') ||
                textContent.startsWith('<system-reminder>') ||
                textContent.startsWith('Caveat:') ||
                textContent.startsWith('This session is being continued from a previous') ||
                textContent.startsWith('Invalid API key') ||
                textContent.includes('{"subtasks":') || // Filter Task Master prompts
                textContent.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                textContent === 'Warmup' // Explicitly filter out "Warmup"
              );

              if (typeof textContent === 'string' && textContent.length > 0 && !isSystemMessage) {
                latestUserTextBySession.set(entry.sessionId, textContent);
              }
            } else if (entry.message?.role === 'assistant' && entry.message?.content) {
              // Skip API error messages using the isApiErrorMessage flag
              if (entry.isApiErrorMessage === true) {
                // Skip this message entirely
              } else {
                // Track last assistant text message
                let assistantText = null;

                if (Array.isArray(entry.message.content)) {
                  for (const part of entry.message.content) {
                    if (part.type === 'text' && part.text) {
                      assistantText = part.text;
                    }
                  }
                } else if (typeof entry.message.content === 'string') {
                  assistantText = entry.message.content;
                }

                // Additional filter for assistant messages with system content
                const isSystemAssistantMessage = typeof assistantText === 'string' && (
                  assistantText.startsWith('Invalid API key') ||
                  assistantText.includes('{"subtasks":') ||
                  assistantText.includes('CRITICAL: You MUST respond with ONLY a JSON')
                );

                if (assistantText && !isSystemAssistantMessage) {
                  latestAssistantTextBySession.set(entry.sessionId, assistantText);
                }
              }
            }

            session.messageCount++;

            if (entry.timestamp) {
              session.lastActivity = new Date(entry.timestamp);
            }
          }
        } catch (parseError) {
          // Skip malformed lines silently
        }
      }
    }

    // After processing all entries, set final summary based on last message if no summary exists
    for (const session of sessions.values()) {
      if (session.summary === 'New Session') {
        // Prefer last user message, fall back to last assistant message.
        const fallbackMessage = latestUserTextBySession.get(session.id) || latestAssistantTextBySession.get(session.id);
        if (fallbackMessage) {
          session.summary = fallbackMessage.length > 50 ? `${fallbackMessage.substring(0, 50)}...` : fallbackMessage;
        }
      }
    }

    // Filter out sessions that contain JSON responses (Task Master errors)
    const allSessions = Array.from(sessions.values());
    const filteredSessions = allSessions.filter(session => {
      const shouldFilter = session.summary.startsWith('{ "');
      if (shouldFilter) {
      }
      // Log a sample of summaries to debug
      if (Math.random() < 0.01) { // Log 1% of sessions
      }
      return !shouldFilter;
    });


    return {
      sessions: filteredSessions,
      entries: entries
    };

  } catch (error) {
    console.error('Error reading JSONL file:', error);
    return { sessions: [], entries: [] };
  }
}

/**
 * ID-based wrapper around `deleteSession`.
 *
 * Resolves the real Claude history folder via the DB-backed path, then defers
 * to the filesystem deletion routine. Callers should still clean up any DB
 * bookkeeping (e.g. the sessions table) at the route layer.
 */
async function deleteSessionById(projectId, sessionId) {
  const projectPath = await getProjectPathById(projectId);
  if (!projectPath) {
    throw new Error(`Unknown projectId: ${projectId}`);
  }

  const claudeFolderName = claudeFolderNameFromPath(projectPath);
  return deleteSession(claudeFolderName, sessionId);
}

// Delete a session from a project
async function deleteSession(projectName, sessionId) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      throw new Error('No session files found for this project');
    }

    // Check all JSONL files to find which one contains the session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      // Check if this file contains the session
      const hasSession = lines.some(line => {
        try {
          const data = JSON.parse(line);
          return data.sessionId === sessionId;
        } catch {
          return false;
        }
      });

      if (hasSession) {
        // Filter out all entries for this session
        const filteredLines = lines.filter(line => {
          try {
            const data = JSON.parse(line);
            return data.sessionId !== sessionId;
          } catch {
            return true; // Keep malformed lines
          }
        });

        // Write back the filtered content
        await fs.writeFile(jsonlFile, filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : ''));
        return true;
      }
    }

    throw new Error(`Session ${sessionId} not found in any files`);
  } catch (error) {
    console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}

function normalizeComparablePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const withoutLongPathPrefix = inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
  const normalized = path.normalize(withoutLongPathPrefix.trim());

  if (!normalized) {
    return '';
  }

  const resolved = path.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function findCodexJsonlFiles(dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findCodexJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }

  return files;
}

async function buildCodexSessionsIndex() {
  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  const sessionsByProject = new Map();

  try {
    await fs.access(codexSessionsDir);
  } catch (error) {
    return sessionsByProject;
  }

  const jsonlFiles = await findCodexJsonlFiles(codexSessionsDir);

  for (const filePath of jsonlFiles) {
    try {
      const sessionData = await parseCodexSessionFile(filePath);
      if (!sessionData || !sessionData.id) {
        continue;
      }

      const normalizedProjectPath = normalizeComparablePath(sessionData.cwd);
      if (!normalizedProjectPath) {
        continue;
      }

      const session = {
        id: sessionData.id,
        summary: sessionData.summary || 'Codex Session',
        messageCount: sessionData.messageCount || 0,
        lastActivity: sessionData.timestamp ? new Date(sessionData.timestamp) : new Date(),
        model: sessionData.model,
        filePath,
        provider: 'codex',
      };

      if (!sessionsByProject.has(normalizedProjectPath)) {
        sessionsByProject.set(normalizedProjectPath, []);
      }

      sessionsByProject.get(normalizedProjectPath).push(session);
    } catch (error) {
      console.warn(`Could not parse Codex session file ${filePath}:`, error.message);
    }
  }

  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  return sessionsByProject;
}

// Fetch Codex sessions for a given project path
async function getCodexSessions(projectPath, options = {}) {
  const { limit = 5, indexRef = null } = options;
  try {
    const normalizedProjectPath = normalizeComparablePath(projectPath);
    if (!normalizedProjectPath) {
      return [];
    }

    if (indexRef && !indexRef.sessionsByProject) {
      indexRef.sessionsByProject = await buildCodexSessionsIndex();
    }

    const sessionsByProject = indexRef?.sessionsByProject || await buildCodexSessionsIndex();
    const sessions = sessionsByProject.get(normalizedProjectPath) || [];

    // Return limited sessions for performance (0 = unlimited for deletion)
    return limit > 0 ? sessions.slice(0, limit) : [...sessions];

  } catch (error) {
    console.error('Error fetching Codex sessions:', error);
    return [];
  }
}

function isVisibleCodexUserMessage(payload) {
  if (!payload || payload.type !== 'user_message') {
    return false;
  }

  // Codex logs internal context (environment, instructions) as non-plain user_message kinds.
  if (payload.kind && payload.kind !== 'plain') {
    return false;
  }

  if (typeof payload.message !== 'string' || payload.message.trim().length === 0) {
    return false;
  }
  
  return true;
}

// Parse a Codex session JSONL file to extract metadata
async function parseCodexSessionFile(filePath) {
  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let sessionMeta = null;
    let lastTimestamp = null;
    let latestVisibleUserMessage = null;
    let messageCount = 0;

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);

          // Track timestamp
          if (entry.timestamp) {
            lastTimestamp = entry.timestamp;
          }

          // Extract session metadata
          if (entry.type === 'session_meta' && entry.payload) {
            sessionMeta = {
              id: entry.payload.id,
              cwd: entry.payload.cwd,
              model: entry.payload.model || entry.payload.model_provider,
              timestamp: entry.timestamp,
              git: entry.payload.git
            };
          }

          // Count visible user messages and extract summary from the latest plain user input.
          if (entry.type === 'event_msg' && isVisibleCodexUserMessage(entry.payload)) {
            messageCount++;
            if (entry.payload.message) {
              latestVisibleUserMessage = entry.payload.message;
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'assistant') {
            messageCount++;
          }

        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }

    if (sessionMeta) {
      return {
        ...sessionMeta,
        timestamp: lastTimestamp || sessionMeta.timestamp,
        summary: latestVisibleUserMessage ?
          (latestVisibleUserMessage.length > 50 ? latestVisibleUserMessage.substring(0, 50) + '...' : latestVisibleUserMessage) :
          'Codex Session',
        messageCount
      };
    }

    return null;

  } catch (error) {
    console.error('Error parsing Codex session file:', error);
    return null;
  }
}

async function deleteCodexSession(sessionId) {
  try {
    const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');

    const findJsonlFiles = async (dir) => {
      const files = [];
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...await findJsonlFiles(fullPath));
          } else if (entry.name.endsWith('.jsonl')) {
            files.push(fullPath);
          }
        }
      } catch (error) { }
      return files;
    };

    const jsonlFiles = await findJsonlFiles(codexSessionsDir);

    for (const filePath of jsonlFiles) {
      const sessionData = await parseCodexSessionFile(filePath);
      if (sessionData && sessionData.id === sessionId) {
        await fs.unlink(filePath);
        return true;
      }
    }

    throw new Error(`Codex session file not found for session ${sessionId}`);
  } catch (error) {
    console.error(`Error deleting Codex session ${sessionId}:`, error);
    throw error;
  }
}

// Only functions with consumers outside this module are exported. Folder-name
// based helpers (`getSessions`, `deleteSession`, etc.) are kept as internal
// implementation details of the id-based wrappers below.
export {
  deleteSessionById,
  getProjectPathById,
  claudeFolderNameFromPath,
  deleteCodexSession
};
