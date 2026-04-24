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
 *     `GET /api/sessions/:sessionId/messages`.
 *   - Conversation search (`searchConversations`) which scans JSONL history.
 *   - Destructive project cleanup (`deleteProjectById` -> `deleteProject`)
 *     which removes Claude/Cursor/Codex artifacts on disk.
 *   - Manual project registration (`addProjectManually`) which syncs to
 *     ~/.claude/project-config.json for backwards compatibility.
 */

import fsSync, { promises as fs } from 'fs';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';
import os from 'os';

import { generateDisplayName } from '@/modules/projects';

import sessionManager from './sessionManager.js';
import { projectsDb, sessionsDb } from './modules/database/index.js';

// Import TaskMaster detection functions
async function detectTaskMasterFolder(projectPath) {
  try {
    const taskMasterPath = path.join(projectPath, '.taskmaster');

    // Check if .taskmaster directory exists
    try {
      const stats = await fs.stat(taskMasterPath);
      if (!stats.isDirectory()) {
        return {
          hasTaskmaster: false,
          reason: '.taskmaster exists but is not a directory'
        };
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          hasTaskmaster: false,
          reason: '.taskmaster directory not found'
        };
      }
      throw error;
    }

    // Check for key TaskMaster files
    const keyFiles = [
      'tasks/tasks.json',
      'config.json'
    ];

    const fileStatus = {};
    let hasEssentialFiles = true;

    for (const file of keyFiles) {
      const filePath = path.join(taskMasterPath, file);
      try {
        await fs.access(filePath);
        fileStatus[file] = true;
      } catch (error) {
        fileStatus[file] = false;
        if (file === 'tasks/tasks.json') {
          hasEssentialFiles = false;
        }
      }
    }

    // Parse tasks.json if it exists for metadata
    let taskMetadata = null;
    if (fileStatus['tasks/tasks.json']) {
      try {
        const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
        const tasksContent = await fs.readFile(tasksPath, 'utf8');
        const tasksData = JSON.parse(tasksContent);

        // Handle both tagged and legacy formats
        let tasks = [];
        if (tasksData.tasks) {
          // Legacy format
          tasks = tasksData.tasks;
        } else {
          // Tagged format - get tasks from all tags
          Object.values(tasksData).forEach(tagData => {
            if (tagData.tasks) {
              tasks = tasks.concat(tagData.tasks);
            }
          });
        }

        // Calculate task statistics
        const stats = tasks.reduce((acc, task) => {
          acc.total++;
          acc[task.status] = (acc[task.status] || 0) + 1;

          // Count subtasks
          if (task.subtasks) {
            task.subtasks.forEach(subtask => {
              acc.subtotalTasks++;
              acc.subtasks = acc.subtasks || {};
              acc.subtasks[subtask.status] = (acc.subtasks[subtask.status] || 0) + 1;
            });
          }

          return acc;
        }, {
          total: 0,
          subtotalTasks: 0,
          pending: 0,
          'in-progress': 0,
          done: 0,
          review: 0,
          deferred: 0,
          cancelled: 0,
          subtasks: {}
        });

        taskMetadata = {
          taskCount: stats.total,
          subtaskCount: stats.subtotalTasks,
          completed: stats.done || 0,
          pending: stats.pending || 0,
          inProgress: stats['in-progress'] || 0,
          review: stats.review || 0,
          completionPercentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
          lastModified: (await fs.stat(tasksPath)).mtime.toISOString()
        };
      } catch (parseError) {
        console.warn('Failed to parse tasks.json:', parseError.message);
        taskMetadata = { error: 'Failed to parse tasks.json' };
      }
    }

    return {
      hasTaskmaster: true,
      hasEssentialFiles,
      files: fileStatus,
      metadata: taskMetadata,
      path: taskMasterPath
    };

  } catch (error) {
    console.error('Error detecting TaskMaster folder:', error);
    return {
      hasTaskmaster: false,
      reason: `Error checking directory: ${error.message}`
    };
  }
}

function normalizeTaskMasterInfo(taskMasterResult = null) {
  const hasTaskmaster = Boolean(taskMasterResult?.hasTaskmaster);
  const hasEssentialFiles = Boolean(taskMasterResult?.hasEssentialFiles);

  return {
    hasTaskmaster,
    hasEssentialFiles,
    metadata: taskMasterResult?.metadata ?? null,
    status: hasTaskmaster && hasEssentialFiles ? 'configured' : 'not-configured'
  };
}

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

/**
 * TaskMaster details for a project, addressed by DB `projectId`.
 *
 * Resolves the project path through the DB and inspects the `.taskmaster`
 * folder on disk for metadata the TaskMaster panel displays.
 */
async function getProjectTaskMasterById(projectId) {
  const projectPath = await getProjectPathById(projectId);
  if (!projectPath) {
    return null;
  }

  const taskMasterResult = await detectTaskMasterFolder(projectPath);

  return {
    projectId,
    projectPath,
    taskmaster: normalizeTaskMasterInfo(taskMasterResult)
  };
}

// Cache for extracted project directories
const projectDirectoryCache = new Map();

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
}

// Load project configuration file
async function loadProjectConfig() {
  const configPath = path.join(os.homedir(), '.claude', 'project-config.json');
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    // Return empty config if file doesn't exist
    return {};
  }
}

// Save project configuration file
async function saveProjectConfig(config) {
  const claudeDir = path.join(os.homedir(), '.claude');
  const configPath = path.join(claudeDir, 'project-config.json');

  // Ensure the .claude directory exists
  try {
    await fs.mkdir(claudeDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// Resolve a Claude-encoded folder name back to an absolute project directory
// by inspecting cached metadata and JSONL `cwd` fields. Used only by the
// legacy name-based helpers below (`getSessions`, `deleteProject`, etc.) and
// by the conversation search; id-based routes use `getProjectPathById`.
async function extractProjectDirectory(projectName) {
  // Check cache first
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }

  // Check project config for originalPath (manually added projects via UI or platform)
  // This handles projects with dashes in their directory names correctly

  const config = await loadProjectConfig();
  if (config[projectName]?.originalPath) {
    const originalPath = config[projectName].originalPath;
    projectDirectoryCache.set(projectName, originalPath);
    return originalPath;
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
  const cwdCounts = new Map();
  let latestTimestamp = 0;
  let latestCwd = null;
  let extractedPath;

  try {
    // Check if the project directory exists
    await fs.access(projectDir);

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      // Fall back to decoded project name if no sessions
      extractedPath = projectName.replace(/-/g, '/');
    } else {
      // Process all JSONL files to collect cwd values
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);

              if (entry.cwd) {
                // Count occurrences of each cwd
                cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);

                // Track the most recent cwd
                const timestamp = new Date(entry.timestamp || 0).getTime();
                if (timestamp > latestTimestamp) {
                  latestTimestamp = timestamp;
                  latestCwd = entry.cwd;
                }
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }
      }

      // Determine the best cwd to use
      if (cwdCounts.size === 0) {
        // No cwd found, fall back to decoded project name
        extractedPath = projectName.replace(/-/g, '/');
      } else if (cwdCounts.size === 1) {
        // Only one cwd, use it
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // Multiple cwd values - prefer the most recent one if it has reasonable usage
        const mostRecentCount = cwdCounts.get(latestCwd) || 0;
        const maxCount = Math.max(...cwdCounts.values());

        // Use most recent if it has at least 25% of the max count
        if (mostRecentCount >= maxCount * 0.25) {
          extractedPath = latestCwd;
        } else {
          // Otherwise use the most frequently used cwd
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              extractedPath = cwd;
              break;
            }
          }
        }

        // Fallback (shouldn't reach here)
        if (!extractedPath) {
          extractedPath = latestCwd || projectName.replace(/-/g, '/');
        }
      }
    }

    // Cache the result
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;

  } catch (error) {
    // If the directory doesn't exist, just use the decoded project name
    if (error.code === 'ENOENT') {
      extractedPath = projectName.replace(/-/g, '/');
    } else {
      console.error(`Error extracting project directory for ${projectName}:`, error);
      // Fall back to decoded project name for other errors
      extractedPath = projectName.replace(/-/g, '/');
    }

    // Cache the fallback result too
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;
  }
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

// Parse an agent JSONL file and extract tool uses
async function parseAgentTools(filePath) {
  const tools = [];

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
          // Look for assistant messages with tool_use
          if (entry.message?.role === 'assistant' && Array.isArray(entry.message?.content)) {
            for (const part of entry.message.content) {
              if (part.type === 'tool_use') {
                tools.push({
                  toolId: part.id,
                  toolName: part.name,
                  toolInput: part.input,
                  timestamp: entry.timestamp
                });
              }
            }
          }
          // Look for tool results
          if (entry.message?.role === 'user' && Array.isArray(entry.message?.content)) {
            for (const part of entry.message.content) {
              if (part.type === 'tool_result') {
                // Find the matching tool and add result
                const tool = tools.find(t => t.toolId === part.tool_use_id);
                if (tool) {
                  tool.toolResult = {
                    content: typeof part.content === 'string' ? part.content :
                      Array.isArray(part.content) ? part.content.map(c => c.text || '').join('\n') :
                        JSON.stringify(part.content),
                    isError: Boolean(part.is_error)
                  };
                }
              }
            }
          }
        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }
  } catch (error) {
    console.warn(`Error parsing agent file ${filePath}:`, error.message);
  }

  return tools;
}

// Get messages for a specific session with pagination support
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    // agent-*.jsonl files contain subagent tool history - we'll process them separately
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
    const agentFiles = files.filter(file => file.endsWith('.jsonl') && file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { messages: [], total: 0, hasMore: false };
    }

    const messages = [];
    // Map of agentId -> tools for subagent tool grouping
    const agentToolsCache = new Map();

    // Process all JSONL files to find messages for this session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const fileStream = fsSync.createReadStream(jsonlFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sessionId) {
              messages.push(entry);
            }
          } catch (parseError) {
            // Silently skip malformed JSONL lines (common with concurrent writes)
          }
        }
      }
    }

    // Collect agentIds from Task tool results
    const agentIds = new Set();
    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        agentIds.add(message.toolUseResult.agentId);
      }
    }

    // Load agent tools for each agentId found
    for (const agentId of agentIds) {
      const agentFileName = `agent-${agentId}.jsonl`;
      if (agentFiles.includes(agentFileName)) {
        const agentFilePath = path.join(projectDir, agentFileName);
        const tools = await parseAgentTools(agentFilePath);
        agentToolsCache.set(agentId, tools);
      }
    }

    // Attach agent tools to their parent Task messages
    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        const agentId = message.toolUseResult.agentId;
        const agentTools = agentToolsCache.get(agentId);
        if (agentTools && agentTools.length > 0) {
          message.subagentTools = agentTools;
        }
      }
    }
    // Sort messages by timestamp
    const sortedMessages = messages.sort((a, b) =>
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );

    const total = sortedMessages.length;

    // If no limit is specified, return all messages (backward compatibility)
    if (limit === null) {
      return sortedMessages;
    }

    // Apply pagination - for recent messages, we need to slice from the end
    // offset 0 should give us the most recent messages
    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;
    const paginatedMessages = sortedMessages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    return {
      messages: paginatedMessages,
      total,
      hasMore,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return limit === null ? [] : { messages: [], total: 0, hasMore: false };
  }
}

/**
 * ID-based wrapper around `getSessions`.
 *
 * Resolves a `projectId` to the underlying Claude JSONL folder name (via the
 * DB-backed project path) and defers to the legacy filesystem reader. Keeps
 * the previous pagination shape so the sidebar's "Load more sessions" UI keeps
 * working after the migration.
 */
async function getSessionsById(projectId, limit = 5, offset = 0) {
  const projectPath = await getProjectPathById(projectId);
  if (!projectPath) {
    return { sessions: [], hasMore: false, total: 0 };
  }

  // Claude stores history under ~/.claude/projects/<encoded-path>/; derive the
  // folder name from the absolute path the DB gave us.
  const claudeFolderName = claudeFolderNameFromPath(projectPath);
  return getSessions(claudeFolderName, limit, offset);
}

// Rename a project's display name
async function renameProject(projectName, newDisplayName) {
  const config = await loadProjectConfig();

  if (!newDisplayName || newDisplayName.trim() === '') {
    // Remove custom name if empty, will fall back to auto-generated
    if (config[projectName]) {
      delete config[projectName].displayName;
    }
  } else {
    // Set custom display name, preserving other properties (manuallyAdded, originalPath)
    config[projectName] = {
      ...config[projectName],
      displayName: newDisplayName.trim()
    };
  }

  await saveProjectConfig(config);
  return true;
}

/**
 * ID-based wrapper around `renameProject`.
 *
 * Writes the new display name to the `projects.custom_project_name` column
 * (the source of truth for the DB-driven getProjects() response) and also
 * keeps the legacy project-config.json in sync for backwards compatibility
 * with any code that still reads it.
 */
async function renameProjectById(projectId, newDisplayName) {
  const projectPath = await getProjectPathById(projectId);
  if (!projectPath) {
    throw new Error(`Unknown projectId: ${projectId}`);
  }

  const trimmed = typeof newDisplayName === 'string' ? newDisplayName.trim() : '';
  // Persist on the DB row so getProjects() immediately reflects the change.
  projectsDb.updateCustomProjectNameById(projectId, trimmed.length > 0 ? trimmed : null);

  // Keep the legacy file-based project config in lockstep so historic readers
  // that still consult project-config.json don't diverge.
  const claudeFolderName = claudeFolderNameFromPath(projectPath);
  try {
    await renameProject(claudeFolderName, trimmed);
  } catch (error) {
    console.warn(`[projects] Legacy renameProject sync failed for ${projectId}:`, error.message);
  }

  return true;
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

// Check if a project is empty (has no sessions)
async function isProjectEmpty(projectName) {
  try {
    const sessionsResult = await getSessions(projectName, 1, 0);
    return sessionsResult.total === 0;
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Remove a project from the UI.
// When deleteData=true, also delete session/memory files on disk (destructive).
async function deleteProject(projectName, force = false, deleteData = false) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty && !force) {
      throw new Error('Cannot delete project with existing sessions');
    }

    const config = await loadProjectConfig();

    // Destructive path: delete underlying data when explicitly requested
    if (deleteData) {
      let projectPath = config[projectName]?.path || config[projectName]?.originalPath;
      if (!projectPath) {
        projectPath = await extractProjectDirectory(projectName);
      }

      // Remove the Claude project directory (session logs, memory, subagent data)
      await fs.rm(projectDir, { recursive: true, force: true });

      // Delete Codex sessions associated with this project
      if (projectPath) {
        try {
          const codexSessions = await getCodexSessions(projectPath, { limit: 0 });
          for (const session of codexSessions) {
            try {
              await deleteCodexSession(session.id);
            } catch (err) {
              console.warn(`Failed to delete Codex session ${session.id}:`, err.message);
            }
          }
        } catch (err) {
          console.warn('Failed to delete Codex sessions:', err.message);
        }

        // Delete Cursor sessions directory if it exists
        try {
          const hash = crypto.createHash('md5').update(projectPath).digest('hex');
          const cursorProjectDir = path.join(os.homedir(), '.cursor', 'chats', hash);
          await fs.rm(cursorProjectDir, { recursive: true, force: true });
        } catch (err) {
          // Cursor dir may not exist, ignore
        }
      }
    }

    // Always remove from project config
    delete config[projectName];
    await saveProjectConfig(config);

    return true;
  } catch (error) {
    console.error(`Error removing project ${projectName}:`, error);
    throw error;
  }
}

/**
 * ID-based wrapper around `deleteProject`.
 *
 * Resolves the project path via the DB, defers destructive filesystem cleanup
 * to `deleteProject`, then removes the row from the `projects` table so the
 * DB-driven GET /api/projects response no longer lists it.
 */
async function deleteProjectById(projectId, force = false, deleteData = false) {
  const projectPath = await getProjectPathById(projectId);
  if (!projectPath) {
    throw new Error(`Unknown projectId: ${projectId}`);
  }

  const claudeFolderName = claudeFolderNameFromPath(projectPath);
  try {
    await deleteProject(claudeFolderName, force, deleteData);
  } catch (error) {
    // If the legacy Claude folder doesn't exist anymore we still want to drop
    // the DB row; rethrow otherwise so callers can surface the failure.
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  // Drop the DB row so the DB-driven GET /api/projects stops listing it.
  projectsDb.deleteProjectById(projectId);
  return true;
}

// Add a project manually to the config (without creating folders)
async function addProjectManually(projectPath, displayName = null) {
  const absolutePath = path.resolve(projectPath);

  try {
    // Check if the path exists
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  // Generate project name (encode path for use as directory name)
  const projectName = absolutePath.replace(/[\\/:\s~_]/g, '-');

  // Check if project already exists in config
  const config = await loadProjectConfig();
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  if (config[projectName]) {
    throw new Error(`Project already configured for path: ${absolutePath}`);
  }

  // Allow adding projects even if the directory exists - this enables tracking
  // existing Claude Code or Cursor projects in the UI

  // Add to config as manually added project
  config[projectName] = {
    manuallyAdded: true,
    originalPath: absolutePath
  };

  if (displayName) {
    config[projectName].displayName = displayName;
  }

  await saveProjectConfig(config);


  return {
    name: projectName,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    sessions: [],
    cursorSessions: []
  };
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

// Get messages for a specific Codex session
async function getCodexSessionMessages(sessionId, limit = null, offset = 0) {
  try {
    const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');

    // Find the session file by searching for the session ID
    const findSessionFile = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = await findSessionFile(fullPath);
            if (found) return found;
          } else if (entry.name.includes(sessionId) && entry.name.endsWith('.jsonl')) {
            return fullPath;
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
      return null;
    };

    const sessionFilePath = await findSessionFile(codexSessionsDir);

    if (!sessionFilePath) {
      console.warn(`Codex session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }

    const messages = [];
    let tokenUsage = null;
    const fileStream = fsSync.createReadStream(sessionFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    // Helper to extract text from Codex content array
    const extractText = (content) => {
      if (!Array.isArray(content)) return content;
      return content
        .map(item => {
          if (item.type === 'input_text' || item.type === 'output_text') {
            return item.text;
          }
          if (item.type === 'text') {
            return item.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    };

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);

          // Extract token usage from token_count events (keep latest)
          if (entry.type === 'event_msg' && entry.payload?.type === 'token_count' && entry.payload?.info) {
            const info = entry.payload.info;
            if (info.total_token_usage) {
              tokenUsage = {
                used: info.total_token_usage.total_tokens || 0,
                total: info.model_context_window || 200000
              };
            }
          }
          
          // Use event_msg.user_message for user-visible inputs.
          if (entry.type === 'event_msg' && isVisibleCodexUserMessage(entry.payload)) {
            messages.push({
              type: 'user',
              timestamp: entry.timestamp,
              message: {
                role: 'user',
                content: entry.payload.message
              }
            });
          }

          // response_item.message may include internal prompts for non-assistant roles.
          // Keep only assistant output from response_item.
          if (
            entry.type === 'response_item' &&
            entry.payload?.type === 'message' &&
            entry.payload.role === 'assistant'
          ) {
            const content = entry.payload.content;
            const textContent = extractText(content);

            // Only add if there's actual content
            if (textContent?.trim()) {
              messages.push({
                type: 'assistant',
                timestamp: entry.timestamp,
                message: {
                  role: 'assistant',
                  content: textContent
                }
              });
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'reasoning') {
            const summaryText = entry.payload.summary
              ?.map(s => s.text)
              .filter(Boolean)
              .join('\n');
            if (summaryText?.trim()) {
              messages.push({
                type: 'thinking',
                timestamp: entry.timestamp,
                message: {
                  role: 'assistant',
                  content: summaryText
                }
              });
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'function_call') {
            let toolName = entry.payload.name;
            let toolInput = entry.payload.arguments;

            // Map Codex tool names to Claude equivalents
            if (toolName === 'shell_command') {
              toolName = 'Bash';
              try {
                const args = JSON.parse(entry.payload.arguments);
                toolInput = JSON.stringify({ command: args.command });
              } catch (e) {
                // Keep original if parsing fails
              }
            }

            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: toolName,
              toolInput: toolInput,
              toolCallId: entry.payload.call_id
            });
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'function_call_output') {
            messages.push({
              type: 'tool_result',
              timestamp: entry.timestamp,
              toolCallId: entry.payload.call_id,
              output: entry.payload.output
            });
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call') {
            const toolName = entry.payload.name || 'custom_tool';
            const input = entry.payload.input || '';

            if (toolName === 'apply_patch') {
              // Parse Codex patch format and convert to Claude Edit format
              const fileMatch = input.match(/\*\*\* Update File: (.+)/);
              const filePath = fileMatch ? fileMatch[1].trim() : 'unknown';

              // Extract old and new content from patch
              const lines = input.split('\n');
              const oldLines = [];
              const newLines = [];

              for (const line of lines) {
                if (line.startsWith('-') && !line.startsWith('---')) {
                  oldLines.push(line.substring(1));
                } else if (line.startsWith('+') && !line.startsWith('+++')) {
                  newLines.push(line.substring(1));
                }
              }

              messages.push({
                type: 'tool_use',
                timestamp: entry.timestamp,
                toolName: 'Edit',
                toolInput: JSON.stringify({
                  file_path: filePath,
                  old_string: oldLines.join('\n'),
                  new_string: newLines.join('\n')
                }),
                toolCallId: entry.payload.call_id
              });
            } else {
              messages.push({
                type: 'tool_use',
                timestamp: entry.timestamp,
                toolName: toolName,
                toolInput: input,
                toolCallId: entry.payload.call_id
              });
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call_output') {
            messages.push({
              type: 'tool_result',
              timestamp: entry.timestamp,
              toolCallId: entry.payload.call_id,
              output: entry.payload.output || ''
            });
          }

        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }

    // Sort by timestamp
    messages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

    const total = messages.length;

    // Apply pagination if limit is specified
    if (limit !== null) {
      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      const paginatedMessages = messages.slice(startIndex, endIndex);
      const hasMore = startIndex > 0;

      return {
        messages: paginatedMessages,
        total,
        hasMore,
        offset,
        limit,
        tokenUsage
      };
    }

    return { messages, tokenUsage };

  } catch (error) {
    console.error(`Error reading Codex session messages for ${sessionId}:`, error);
    return { messages: [], total: 0, hasMore: false };
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

async function searchConversations(query, limit = 50, onProjectResult = null, signal = null) {
  const safeQuery = typeof query === 'string' ? query.trim() : '';
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 200));
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const config = await loadProjectConfig();
  const results = [];
  let totalMatches = 0;
  const words = safeQuery.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return { results: [], totalMatches: 0, query: safeQuery };

  const isAborted = () => signal?.aborted === true;

  const isSystemMessage = (textContent) => {
    return typeof textContent === 'string' && (
      textContent.startsWith('<command-name>') ||
      textContent.startsWith('<command-message>') ||
      textContent.startsWith('<command-args>') ||
      textContent.startsWith('<local-command-stdout>') ||
      textContent.startsWith('<system-reminder>') ||
      textContent.startsWith('Caveat:') ||
      textContent.startsWith('This session is being continued from a previous') ||
      textContent.startsWith('Invalid API key') ||
      textContent.includes('{"subtasks":') ||
      textContent.includes('CRITICAL: You MUST respond with ONLY a JSON') ||
      textContent === 'Warmup'
    );
  };

  const extractText = (content) => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(part => part.type === 'text' && part.text)
        .map(part => part.text)
        .join(' ');
    }
    return '';
  };

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordPatterns = words.map(w => new RegExp(`(?<!\\p{L})${escapeRegex(w)}(?!\\p{L})`, 'u'));
  const allWordsMatch = (textLower) => {
    return wordPatterns.every(p => p.test(textLower));
  };

  const buildSnippet = (text, textLower, snippetLen = 150) => {
    let firstIndex = -1;
    let firstWordLen = 0;
    for (const w of words) {
      const re = new RegExp(`(?<!\\p{L})${escapeRegex(w)}(?!\\p{L})`, 'u');
      const m = re.exec(textLower);
      if (m && (firstIndex === -1 || m.index < firstIndex)) {
        firstIndex = m.index;
        firstWordLen = w.length;
      }
    }
    if (firstIndex === -1) firstIndex = 0;
    const halfLen = Math.floor(snippetLen / 2);
    let start = Math.max(0, firstIndex - halfLen);
    let end = Math.min(text.length, firstIndex + halfLen + firstWordLen);
    let snippet = text.slice(start, end).replace(/\n/g, ' ');
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    snippet = prefix + snippet + suffix;
    const snippetLower = snippet.toLowerCase();
    const highlights = [];
    for (const word of words) {
      const re = new RegExp(`(?<!\\p{L})${escapeRegex(word)}(?!\\p{L})`, 'gu');
      let match;
      while ((match = re.exec(snippetLower)) !== null) {
        highlights.push({ start: match.index, end: match.index + word.length });
      }
    }
    highlights.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const h of highlights) {
      const last = merged[merged.length - 1];
      if (last && h.start <= last.end) {
        last.end = Math.max(last.end, h.end);
      } else {
        merged.push({ ...h });
      }
    }
    return { snippet, highlights: merged };
  };

  try {
    await fs.access(claudeDir);
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    const projectDirs = entries.filter(e => e.isDirectory());
    let scannedProjects = 0;
    const totalProjects = projectDirs.length;

    for (const projectEntry of projectDirs) {
      if (totalMatches >= safeLimit || isAborted()) break;

      const projectName = projectEntry.name;
      const projectDir = path.join(claudeDir, projectName);
      const displayName = config[projectName]?.displayName
        || await generateDisplayName(projectName);

      let files;
      try {
        files = await fs.readdir(projectDir);
      } catch {
        continue;
      }

      const jsonlFiles = files.filter(
        file => file.endsWith('.jsonl') && !file.startsWith('agent-')
      );

      // Also include the DB `projectId` so the frontend (which now identifies
      // projects by `projectId`) can match search results to the
      // currently-loaded project list without a second round-trip.
      let searchProjectId = null;
      try {
        const resolvedPath = await extractProjectDirectory(projectName);
        const dbRow = projectsDb.getProjectPath(resolvedPath);
        if (dbRow?.project_id) {
          searchProjectId = dbRow.project_id;
        }
      } catch {
        // Best-effort: if we cannot resolve the projectId, the result is still
        // usable on the backend but the frontend will skip the auto-select.
      }

      const projectResult = {
        projectId: searchProjectId,
        projectName,
        projectDisplayName: displayName,
        sessions: []
      };

      for (const file of jsonlFiles) {
        if (totalMatches >= safeLimit || isAborted()) break;

        const filePath = path.join(projectDir, file);
        const sessionMatches = new Map();
        const sessionSummaries = new Map();
        const pendingSummaries = new Map();
        const sessionLastMessages = new Map();
        let currentSessionId = null;

        try {
          const fileStream = fsSync.createReadStream(filePath);
          const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
          });

          for await (const line of rl) {
            if (totalMatches >= safeLimit || isAborted()) break;
            if (!line.trim()) continue;

            let entry;
            try {
              entry = JSON.parse(line);
            } catch {
              continue;
            }

            if (entry.sessionId) {
              currentSessionId = entry.sessionId;
            }
            if (entry.type === 'summary' && entry.summary) {
              const sid = entry.sessionId || currentSessionId;
              if (sid) {
                sessionSummaries.set(sid, entry.summary);
              } else if (entry.leafUuid) {
                pendingSummaries.set(entry.leafUuid, entry.summary);
              }
            }

            // Apply pending summary via parentUuid
            if (entry.parentUuid && currentSessionId && !sessionSummaries.has(currentSessionId)) {
              const pending = pendingSummaries.get(entry.parentUuid);
              if (pending) sessionSummaries.set(currentSessionId, pending);
            }

            // Track last user/assistant message for fallback title
            if (entry.message?.content && currentSessionId && !entry.isApiErrorMessage) {
              const role = entry.message.role;
              if (role === 'user' || role === 'assistant') {
                const text = extractText(entry.message.content);
                if (text && !isSystemMessage(text)) {
                  if (!sessionLastMessages.has(currentSessionId)) {
                    sessionLastMessages.set(currentSessionId, {});
                  }
                  const msgs = sessionLastMessages.get(currentSessionId);
                  if (role === 'user') msgs.user = text;
                  else msgs.assistant = text;
                }
              }
            }

            if (!entry.message?.content) continue;
            if (entry.message.role !== 'user' && entry.message.role !== 'assistant') continue;
            if (entry.isApiErrorMessage) continue;

            const text = extractText(entry.message.content);
            if (!text || isSystemMessage(text)) continue;

            const textLower = text.toLowerCase();
            if (!allWordsMatch(textLower)) continue;

            const sessionId = entry.sessionId || currentSessionId || file.replace('.jsonl', '');
            if (!sessionMatches.has(sessionId)) {
              sessionMatches.set(sessionId, []);
            }

            const matches = sessionMatches.get(sessionId);
            if (matches.length < 2) {
              const { snippet, highlights } = buildSnippet(text, textLower);
              matches.push({
                role: entry.message.role,
                snippet,
                highlights,
                timestamp: entry.timestamp || null,
                provider: 'claude',
                messageUuid: entry.uuid || null
              });
              totalMatches++;
            }
          }
        } catch {
          continue;
        }

        for (const [sessionId, matches] of sessionMatches) {
          projectResult.sessions.push({
            sessionId,
            provider: 'claude',
            sessionSummary: sessionSummaries.get(sessionId) || (() => {
              const msgs = sessionLastMessages.get(sessionId);
              const lastMsg = msgs?.user || msgs?.assistant;
              return lastMsg ? (lastMsg.length > 50 ? lastMsg.substring(0, 50) + '...' : lastMsg) : 'New Session';
            })(),
            matches
          });
        }
      }

      // Search Codex sessions for this project
      try {
        const actualProjectDir = await extractProjectDirectory(projectName);
        if (actualProjectDir && !isAborted() && totalMatches < safeLimit) {
          await searchCodexSessionsForProject(
            actualProjectDir, projectResult, words, allWordsMatch, extractText, isSystemMessage,
            buildSnippet, safeLimit, () => totalMatches, (n) => { totalMatches += n; }, isAborted
          );
        }
      } catch {
        // Skip codex search errors
      }

      // Search Gemini sessions for this project
      try {
        const actualProjectDir = await extractProjectDirectory(projectName);
        if (actualProjectDir && !isAborted() && totalMatches < safeLimit) {
          await searchGeminiSessionsForProject(
            actualProjectDir, projectResult, words, allWordsMatch,
            buildSnippet, safeLimit, () => totalMatches, (n) => { totalMatches += n; }
          );
        }
      } catch {
        // Skip gemini search errors
      }

      scannedProjects++;
      if (projectResult.sessions.length > 0) {
        results.push(projectResult);
        if (onProjectResult) {
          onProjectResult({ projectResult, totalMatches, scannedProjects, totalProjects });
        }
      } else if (onProjectResult && scannedProjects % 10 === 0) {
        onProjectResult({ projectResult: null, totalMatches, scannedProjects, totalProjects });
      }
    }
  } catch {
    // claudeDir doesn't exist
  }

  return { results, totalMatches, query: safeQuery };
}

async function searchCodexSessionsForProject(
  projectPath, projectResult, words, allWordsMatch, extractText, isSystemMessage,
  buildSnippet, limit, getTotalMatches, addMatches, isAborted
) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) return;
  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  try {
    await fs.access(codexSessionsDir);
  } catch {
    return;
  }

  const jsonlFiles = await findCodexJsonlFiles(codexSessionsDir);

  for (const filePath of jsonlFiles) {
    if (getTotalMatches() >= limit || isAborted()) break;

    try {
      const fileStream = fsSync.createReadStream(filePath);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      // First pass: read session_meta to check project path match
      let sessionMeta = null;
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'session_meta' && entry.payload) {
            sessionMeta = entry.payload;
            break;
          }
        } catch { continue; }
      }

      // Skip sessions that don't belong to this project
      if (!sessionMeta) continue;
      const sessionProjectPath = normalizeComparablePath(sessionMeta.cwd);
      if (sessionProjectPath !== normalizedProjectPath) continue;

      // Second pass: re-read file to find matching messages
      const fileStream2 = fsSync.createReadStream(filePath);
      const rl2 = readline.createInterface({ input: fileStream2, crlfDelay: Infinity });
      let latestUserMessageText = null;
      const matches = [];

      for await (const line of rl2) {
        if (getTotalMatches() >= limit || isAborted()) break;
        if (!line.trim()) continue;

        let entry;
        try { entry = JSON.parse(line); } catch { continue; }

        let text = null;
        let role = null;

        if (entry.type === 'event_msg' && entry.payload?.type === 'user_message' && entry.payload.message) {
          text = entry.payload.message;
          role = 'user';
          latestUserMessageText = text;
        } else if (entry.type === 'response_item' && entry.payload?.type === 'message') {
          const contentParts = entry.payload.content || [];
          if (entry.payload.role === 'user') {
            text = contentParts
              .filter(p => p.type === 'input_text' && p.text)
              .map(p => p.text)
              .join(' ');
            role = 'user';
            if (text) latestUserMessageText = text;
          } else if (entry.payload.role === 'assistant') {
            text = contentParts
              .filter(p => p.type === 'output_text' && p.text)
              .map(p => p.text)
              .join(' ');
            role = 'assistant';
          }
        }

        if (!text || !role) continue;
        const textLower = text.toLowerCase();
        if (!allWordsMatch(textLower)) continue;

        if (matches.length < 2) {
          const { snippet, highlights } = buildSnippet(text, textLower);
          matches.push({ role, snippet, highlights, timestamp: entry.timestamp || null, provider: 'codex' });
          addMatches(1);
        }
      }

      if (matches.length > 0) {
        projectResult.sessions.push({
          sessionId: sessionMeta.id,
          provider: 'codex',
          sessionSummary: latestUserMessageText
            ? (latestUserMessageText.length > 50 ? latestUserMessageText.substring(0, 50) + '...' : latestUserMessageText)
            : 'Codex Session',
          matches
        });
      }
    } catch {
      continue;
    }
  }
}

async function searchGeminiSessionsForProject(
  projectPath, projectResult, words, allWordsMatch,
  buildSnippet, limit, getTotalMatches, addMatches
) {
  // 1) Search in-memory sessions (created via UI)
  for (const [sessionId, session] of sessionManager.sessions) {
    if (getTotalMatches() >= limit) break;
    if (session.projectPath !== projectPath) continue;

    const matches = [];
    for (const msg of session.messages) {
      if (getTotalMatches() >= limit) break;
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;

      const text = typeof msg.content === 'string' ? msg.content
        : Array.isArray(msg.content) ? msg.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
        : '';
      if (!text) continue;

      const textLower = text.toLowerCase();
      if (!allWordsMatch(textLower)) continue;

      if (matches.length < 2) {
        const { snippet, highlights } = buildSnippet(text, textLower);
        matches.push({
          role: msg.role, snippet, highlights,
          timestamp: msg.timestamp ? msg.timestamp.toISOString() : null,
          provider: 'gemini'
        });
        addMatches(1);
      }
    }

    if (matches.length > 0) {
      const firstUserMsg = session.messages.find(m => m.role === 'user');
      const summary = firstUserMsg?.content
        ? (typeof firstUserMsg.content === 'string'
          ? (firstUserMsg.content.length > 50 ? firstUserMsg.content.substring(0, 50) + '...' : firstUserMsg.content)
          : 'Gemini Session')
        : 'Gemini Session';

      projectResult.sessions.push({
        sessionId,
        provider: 'gemini',
        sessionSummary: summary,
        matches
      });
    }
  }

  // 2) Search Gemini CLI sessions on disk (~/.gemini/tmp/<project>/chats/*.json)
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) return;

  const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
  try {
    await fs.access(geminiTmpDir);
  } catch {
    return;
  }

  const trackedSessionIds = new Set();
  for (const [sid] of sessionManager.sessions) {
    trackedSessionIds.add(sid);
  }

  let projectDirs;
  try {
    projectDirs = await fs.readdir(geminiTmpDir);
  } catch {
    return;
  }

  for (const projectDir of projectDirs) {
    if (getTotalMatches() >= limit) break;

    const projectRootFile = path.join(geminiTmpDir, projectDir, '.project_root');
    let projectRoot;
    try {
      projectRoot = (await fs.readFile(projectRootFile, 'utf8')).trim();
    } catch {
      continue;
    }

    if (normalizeComparablePath(projectRoot) !== normalizedProjectPath) continue;

    const chatsDir = path.join(geminiTmpDir, projectDir, 'chats');
    let chatFiles;
    try {
      chatFiles = await fs.readdir(chatsDir);
    } catch {
      continue;
    }

    for (const chatFile of chatFiles) {
      if (getTotalMatches() >= limit) break;
      if (!chatFile.endsWith('.json')) continue;

      try {
        const filePath = path.join(chatsDir, chatFile);
        const data = await fs.readFile(filePath, 'utf8');
        const session = JSON.parse(data);
        if (!session.messages || !Array.isArray(session.messages)) continue;

        const cliSessionId = session.sessionId || chatFile.replace('.json', '');
        if (trackedSessionIds.has(cliSessionId)) continue;

        const matches = [];
        let firstUserText = null;

        for (const msg of session.messages) {
          if (getTotalMatches() >= limit) break;

          const role = msg.type === 'user' ? 'user'
            : (msg.type === 'gemini' || msg.type === 'assistant') ? 'assistant'
            : null;
          if (!role) continue;

          let text = '';
          if (typeof msg.content === 'string') {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            text = msg.content
              .filter(p => p.text)
              .map(p => p.text)
              .join(' ');
          }
          if (!text) continue;

          if (role === 'user' && !firstUserText) firstUserText = text;

          const textLower = text.toLowerCase();
          if (!allWordsMatch(textLower)) continue;

          if (matches.length < 2) {
            const { snippet, highlights } = buildSnippet(text, textLower);
            matches.push({
              role, snippet, highlights,
              timestamp: msg.timestamp || null,
              provider: 'gemini'
            });
            addMatches(1);
          }
        }

        if (matches.length > 0) {
          const summary = firstUserText
            ? (firstUserText.length > 50 ? firstUserText.substring(0, 50) + '...' : firstUserText)
            : 'Gemini CLI Session';

          projectResult.sessions.push({
            sessionId: cliSessionId,
            provider: 'gemini',
            sessionSummary: summary,
            matches
          });
        }
      } catch {
        continue;
      }
    }
  }
}

async function getGeminiCliSessionMessages(sessionId) {
  const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
  let projectDirs;
  try {
    projectDirs = await fs.readdir(geminiTmpDir);
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    const chatsDir = path.join(geminiTmpDir, projectDir, 'chats');
    let chatFiles;
    try {
      chatFiles = await fs.readdir(chatsDir);
    } catch {
      continue;
    }

    for (const chatFile of chatFiles) {
      if (!chatFile.endsWith('.json')) continue;
      try {
        const filePath = path.join(chatsDir, chatFile);
        const data = await fs.readFile(filePath, 'utf8');
        const session = JSON.parse(data);
        const fileSessionId = session.sessionId || chatFile.replace('.json', '');
        if (fileSessionId !== sessionId) continue;

        return (session.messages || []).map(msg => {
          const role = msg.type === 'user' ? 'user'
            : (msg.type === 'gemini' || msg.type === 'assistant') ? 'assistant'
            : msg.type;

          let content = '';
          if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = msg.content.filter(p => p.text).map(p => p.text).join('\n');
          }

          return {
            type: 'message',
            message: { role, content },
            timestamp: msg.timestamp || null
          };
        });
      } catch {
        continue;
      }
    }
  }

  return [];
}

// Only functions with consumers outside this module are exported. Folder-name
// based helpers (`getSessions`, `renameProject`, `deleteSession`, etc.) are
// kept as internal implementation details of the id-based wrappers below.
export {
  getSessionsById,
  getSessionMessages,
  renameProjectById,
  deleteSessionById,
  deleteProjectById,
  addProjectManually,
  getProjectTaskMasterById,
  getProjectPathById,
  claudeFolderNameFromPath,
  clearProjectDirectoryCache,
  getCodexSessionMessages,
  deleteCodexSession,
  getGeminiCliSessionMessages,
  searchConversations
};
