/**
 * PROJECT DISCOVERY AND MANAGEMENT SYSTEM
 * ========================================
 * 
 * This module manages project discovery for both Claude CLI and Cursor CLI sessions.
 * 
 * ## Architecture Overview
 * 
 * 1. **Claude Projects** (stored in ~/.claude/projects/)
 *    - Each project is a directory named with the project path encoded (/ replaced with -)
 *    - Contains .jsonl files with conversation history including 'cwd' field
 *    - Project metadata stored in ~/.claude/project-config.json
 * 
 * 2. **Cursor Projects** (stored in ~/.cursor/chats/)
 *    - Each project directory is named with MD5 hash of the absolute project path
 *    - Example: /Users/john/myproject -> MD5 -> a1b2c3d4e5f6...
 *    - Contains session directories with SQLite databases (store.db)
 *    - Project path is NOT stored in the database - only in the MD5 hash
 * 
 * ## Project Discovery Strategy
 * 
 * 1. **Claude Projects Discovery**:
 *    - Scan ~/.claude/projects/ directory for Claude project folders
 *    - Extract actual project path from .jsonl files (cwd field)
 *    - Fall back to decoded directory name if no sessions exist
 * 
 * 2. **Cursor Sessions Discovery**:
 *    - For each KNOWN project (from Claude or manually added)
 *    - Compute MD5 hash of the project's absolute path
 *    - Check if ~/.cursor/chats/{md5_hash}/ directory exists
 *    - Read session metadata from SQLite store.db files
 * 
 * 3. **Manual Project Addition**:
 *    - Users can manually add project paths via UI
 *    - Stored in ~/.claude/project-config.json with 'manuallyAdded' flag
 *    - Allows discovering Cursor sessions for projects without Claude sessions
 * 
 * ## Critical Limitations
 * 
 * - **CANNOT discover Cursor-only projects**: From a quick check, there was no mention of
 *   the cwd of each project. if someone has the time, you can try to reverse engineer it.
 * 
 * - **Project relocation breaks history**: If a project directory is moved or renamed,
 *   the MD5 hash changes, making old Cursor sessions inaccessible unless the old
 *   path is known and manually added.
 * 
 * ## Error Handling
 * 
 * - Missing ~/.claude directory is handled gracefully with automatic creation
 * - ENOENT errors are caught and handled without crashing
 * - Empty arrays returned when no projects/sessions exist
 * 
 * ## Caching Strategy
 * 
 * - Project directory extraction is cached to minimize file I/O
 * - Cache is cleared when project configuration changes
 * - Session data is fetched on-demand, not cached
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import os from 'os';

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

// Generate better display name from path
async function generateDisplayName(projectName, actualProjectDir = null) {
  // Use actual project directory if provided, otherwise decode from project name
  let projectPath = actualProjectDir || projectName.replace(/-/g, '/');
  
  // Try to read package.json from the project path
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);
    
    // Return the name from package.json if it exists
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch (error) {
    // Fall back to path-based naming if package.json doesn't exist or can't be read
  }
  
  // If it starts with /, it's an absolute path
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    // Return only the last folder name
    return parts[parts.length - 1] || projectPath;
  }
  
  return projectPath;
}

// Extract the actual project directory from JSONL sessions (with caching)
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

async function getProjects(progressCallback = null) {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const config = await loadProjectConfig();
  const projects = [];
  const existingProjects = new Set();
  let totalProjects = 0;
  let processedProjects = 0;
  let directories = [];

  try {
    // Check if the .claude/projects directory exists
    await fs.access(claudeDir);

    // First, get existing Claude projects from the file system
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    directories = entries.filter(e => e.isDirectory());

    // Build set of existing project names for later
    directories.forEach(e => existingProjects.add(e.name));

    // Count manual projects not already in directories
    const manualProjectsCount = Object.entries(config)
      .filter(([name, cfg]) => cfg.manuallyAdded && !existingProjects.has(name))
      .length;

    totalProjects = directories.length + manualProjectsCount;

    for (const entry of directories) {
        processedProjects++;

        // Emit progress
        if (progressCallback) {
          progressCallback({
            phase: 'loading',
            current: processedProjects,
            total: totalProjects,
            currentProject: entry.name
          });
        }

        const projectPath = path.join(claudeDir, entry.name);
        
        // Extract actual project directory from JSONL sessions
        const actualProjectDir = await extractProjectDirectory(entry.name);
        
        // Get display name from config or generate one
        const customName = config[entry.name]?.displayName;
        const autoDisplayName = await generateDisplayName(entry.name, actualProjectDir);
        const fullPath = actualProjectDir;
        
        const project = {
          name: entry.name,
          path: actualProjectDir,
          displayName: customName || autoDisplayName,
          fullPath: fullPath,
          isCustomName: !!customName,
          sessions: []
        };
        
        // Try to get sessions for this project (just first 5 for performance)
        try {
          const sessionResult = await getSessions(entry.name, 5, 0);
          project.sessions = sessionResult.sessions || [];
          project.sessionMeta = {
            hasMore: sessionResult.hasMore,
            total: sessionResult.total
          };
        } catch (e) {
          console.warn(`Could not load sessions for project ${entry.name}:`, e.message);
        }
        
        // Also fetch Cursor sessions for this project
        try {
          project.cursorSessions = await getCursorSessions(actualProjectDir);
        } catch (e) {
          console.warn(`Could not load Cursor sessions for project ${entry.name}:`, e.message);
          project.cursorSessions = [];
        }

        // Also fetch Codex sessions for this project
        try {
          project.codexSessions = await getCodexSessions(actualProjectDir);
        } catch (e) {
          console.warn(`Could not load Codex sessions for project ${entry.name}:`, e.message);
          project.codexSessions = [];
        }

        // Add TaskMaster detection
        try {
          const taskMasterResult = await detectTaskMasterFolder(actualProjectDir);
          project.taskmaster = {
            hasTaskmaster: taskMasterResult.hasTaskmaster,
            hasEssentialFiles: taskMasterResult.hasEssentialFiles,
            metadata: taskMasterResult.metadata,
            status: taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles ? 'configured' : 'not-configured'
          };
        } catch (e) {
          console.warn(`Could not detect TaskMaster for project ${entry.name}:`, e.message);
          project.taskmaster = {
            hasTaskmaster: false,
            hasEssentialFiles: false,
            metadata: null,
            status: 'error'
          };
        }

      projects.push(project);
    }
  } catch (error) {
    // If the directory doesn't exist (ENOENT), that's okay - just continue with empty projects
    if (error.code !== 'ENOENT') {
      console.error('Error reading projects directory:', error);
    }
    // Calculate total for manual projects only (no directories exist)
    totalProjects = Object.entries(config)
      .filter(([name, cfg]) => cfg.manuallyAdded)
      .length;
  }
  
  // Add manually configured projects that don't exist as folders yet
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!existingProjects.has(projectName) && projectConfig.manuallyAdded) {
      processedProjects++;

      // Emit progress for manual projects
      if (progressCallback) {
        progressCallback({
          phase: 'loading',
          current: processedProjects,
          total: totalProjects,
          currentProject: projectName
        });
      }

      // Use the original path if available, otherwise extract from potential sessions
      let actualProjectDir = projectConfig.originalPath;
      
      if (!actualProjectDir) {
        try {
          actualProjectDir = await extractProjectDirectory(projectName);
        } catch (error) {
          // Fall back to decoded project name
          actualProjectDir = projectName.replace(/-/g, '/');
        }
      }
      
              const project = {
          name: projectName,
          path: actualProjectDir,
          displayName: projectConfig.displayName || await generateDisplayName(projectName, actualProjectDir),
          fullPath: actualProjectDir,
          isCustomName: !!projectConfig.displayName,
          isManuallyAdded: true,
          sessions: [],
          cursorSessions: [],
          codexSessions: []
        };

      // Try to fetch Cursor sessions for manual projects too
      try {
        project.cursorSessions = await getCursorSessions(actualProjectDir);
      } catch (e) {
        console.warn(`Could not load Cursor sessions for manual project ${projectName}:`, e.message);
      }

      // Try to fetch Codex sessions for manual projects too
      try {
        project.codexSessions = await getCodexSessions(actualProjectDir);
      } catch (e) {
        console.warn(`Could not load Codex sessions for manual project ${projectName}:`, e.message);
      }

      // Add TaskMaster detection for manual projects
      try {
        const taskMasterResult = await detectTaskMasterFolder(actualProjectDir);
        
        // Determine TaskMaster status
        let taskMasterStatus = 'not-configured';
        if (taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles) {
          taskMasterStatus = 'taskmaster-only'; // We don't check MCP for manual projects in bulk
        }
        
        project.taskmaster = {
          status: taskMasterStatus,
          hasTaskmaster: taskMasterResult.hasTaskmaster,
          hasEssentialFiles: taskMasterResult.hasEssentialFiles,
          metadata: taskMasterResult.metadata
        };
      } catch (error) {
        console.warn(`TaskMaster detection failed for manual project ${projectName}:`, error.message);
        project.taskmaster = {
          status: 'error',
          hasTaskmaster: false,
          hasEssentialFiles: false,
          error: error.message
        };
      }
      
      projects.push(project);
    }
  }

  // Emit completion after all projects (including manual) are processed
  if (progressCallback) {
    progressCallback({
      phase: 'complete',
      current: totalProjects,
      total: totalProjects
    });
  }

  return projects;
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
                cwd: entry.cwd || '',
                lastUserMessage: null,
                lastAssistantMessage: null
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
                session.lastUserMessage = textContent;
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
                  session.lastAssistantMessage = assistantText;
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
        // Prefer last user message, fall back to last assistant message
        const lastMessage = session.lastUserMessage || session.lastAssistantMessage;
        if (lastMessage) {
          session.summary = lastMessage.length > 50 ? lastMessage.substring(0, 50) + '...' : lastMessage;
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

// Get messages for a specific session with pagination support
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    // agent-*.jsonl files contain session start data at this point. This needs to be revisited
    // periodically to make sure only accurate data is there and no new functionality is added there
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
    
    if (jsonlFiles.length === 0) {
      return { messages: [], total: 0, hasMore: false };
    }
    
    const messages = [];
    
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
            console.warn('Error parsing line:', parseError.message);
          }
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

// Rename a project's display name
async function renameProject(projectName, newDisplayName) {
  const config = await loadProjectConfig();
  
  if (!newDisplayName || newDisplayName.trim() === '') {
    // Remove custom name if empty, will fall back to auto-generated
    delete config[projectName];
  } else {
    // Set custom display name
    config[projectName] = {
      displayName: newDisplayName.trim()
    };
  }
  
  await saveProjectConfig(config);
  return true;
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

// Delete a project (force=true to delete even with sessions)
async function deleteProject(projectName, force = false) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty && !force) {
      throw new Error('Cannot delete project with existing sessions');
    }

    const config = await loadProjectConfig();
    let projectPath = config[projectName]?.path || config[projectName]?.originalPath;

    // Fallback to extractProjectDirectory if projectPath is not in config
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }

    // Remove the project directory (includes all Claude sessions)
    await fs.rm(projectDir, { recursive: true, force: true });

    // Delete all Codex sessions associated with this project
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

    // Remove from project config
    delete config[projectName];
    await saveProjectConfig(config);

    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
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
    isManuallyAdded: true,
    sessions: [],
    cursorSessions: []
  };
}

// Fetch Cursor sessions for a given project path
async function getCursorSessions(projectPath) {
  try {
    // Calculate cwdID hash for the project path (Cursor uses MD5 hash)
    const cwdId = crypto.createHash('md5').update(projectPath).digest('hex');
    const cursorChatsPath = path.join(os.homedir(), '.cursor', 'chats', cwdId);
    
    // Check if the directory exists
    try {
      await fs.access(cursorChatsPath);
    } catch (error) {
      // No sessions for this project
      return [];
    }
    
    // List all session directories
    const sessionDirs = await fs.readdir(cursorChatsPath);
    const sessions = [];
    
    for (const sessionId of sessionDirs) {
      const sessionPath = path.join(cursorChatsPath, sessionId);
      const storeDbPath = path.join(sessionPath, 'store.db');
      
      try {
        // Check if store.db exists
        await fs.access(storeDbPath);
        
        // Capture store.db mtime as a reliable fallback timestamp
        let dbStatMtimeMs = null;
        try {
          const stat = await fs.stat(storeDbPath);
          dbStatMtimeMs = stat.mtimeMs;
        } catch (_) {}

        // Open SQLite database
        const db = await open({
          filename: storeDbPath,
          driver: sqlite3.Database,
          mode: sqlite3.OPEN_READONLY
        });
        
        // Get metadata from meta table
        const metaRows = await db.all(`
          SELECT key, value FROM meta
        `);
        
        // Parse metadata
        let metadata = {};
        for (const row of metaRows) {
          if (row.value) {
            try {
              // Try to decode as hex-encoded JSON
              const hexMatch = row.value.toString().match(/^[0-9a-fA-F]+$/);
              if (hexMatch) {
                const jsonStr = Buffer.from(row.value, 'hex').toString('utf8');
                metadata[row.key] = JSON.parse(jsonStr);
              } else {
                metadata[row.key] = row.value.toString();
              }
            } catch (e) {
              metadata[row.key] = row.value.toString();
            }
          }
        }
        
        // Get message count
        const messageCountResult = await db.get(`
          SELECT COUNT(*) as count FROM blobs
        `);
        
        await db.close();
        
        // Extract session info
        const sessionName = metadata.title || metadata.sessionTitle || 'Untitled Session';
        
        // Determine timestamp - prefer createdAt from metadata, fall back to db file mtime
        let createdAt = null;
        if (metadata.createdAt) {
          createdAt = new Date(metadata.createdAt).toISOString();
        } else if (dbStatMtimeMs) {
          createdAt = new Date(dbStatMtimeMs).toISOString();
        } else {
          createdAt = new Date().toISOString();
        }
        
        sessions.push({
          id: sessionId,
          name: sessionName,
          createdAt: createdAt,
          lastActivity: createdAt, // For compatibility with Claude sessions
          messageCount: messageCountResult.count || 0,
          projectPath: projectPath
        });
        
      } catch (error) {
        console.warn(`Could not read Cursor session ${sessionId}:`, error.message);
      }
    }
    
    // Sort sessions by creation time (newest first)
    sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Return only the first 5 sessions for performance
    return sessions.slice(0, 5);
    
  } catch (error) {
    console.error('Error fetching Cursor sessions:', error);
    return [];
  }
}


// Fetch Codex sessions for a given project path
async function getCodexSessions(projectPath, options = {}) {
  const { limit = 5 } = options;
  try {
    const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
    const sessions = [];

    // Check if the directory exists
    try {
      await fs.access(codexSessionsDir);
    } catch (error) {
      // No Codex sessions directory
      return [];
    }

    // Recursively find all .jsonl files in the sessions directory
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
      } catch (error) {
        // Skip directories we can't read
      }
      return files;
    };

    const jsonlFiles = await findJsonlFiles(codexSessionsDir);

    // Process each file to find sessions matching the project path
    for (const filePath of jsonlFiles) {
      try {
        const sessionData = await parseCodexSessionFile(filePath);

        // Check if this session matches the project path
        // Handle Windows long paths with \\?\ prefix
        const sessionCwd = sessionData?.cwd || '';
        const cleanSessionCwd = sessionCwd.startsWith('\\\\?\\') ? sessionCwd.slice(4) : sessionCwd;
        const cleanProjectPath = projectPath.startsWith('\\\\?\\') ? projectPath.slice(4) : projectPath;

        if (sessionData && (sessionData.cwd === projectPath || cleanSessionCwd === cleanProjectPath || path.relative(cleanSessionCwd, cleanProjectPath) === '')) {
          sessions.push({
            id: sessionData.id,
            summary: sessionData.summary || 'Codex Session',
            messageCount: sessionData.messageCount || 0,
            lastActivity: sessionData.timestamp ? new Date(sessionData.timestamp) : new Date(),
            cwd: sessionData.cwd,
            model: sessionData.model,
            filePath: filePath,
            provider: 'codex'
          });
        }
      } catch (error) {
        console.warn(`Could not parse Codex session file ${filePath}:`, error.message);
      }
    }

    // Sort sessions by last activity (newest first)
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    // Return limited sessions for performance (0 = unlimited for deletion)
    return limit > 0 ? sessions.slice(0, limit) : sessions;

  } catch (error) {
    console.error('Error fetching Codex sessions:', error);
    return [];
  }
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
    let lastUserMessage = null;
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

          // Count messages and extract user messages for summary
          if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
            messageCount++;
            if (entry.payload.message) {
              lastUserMessage = entry.payload.message;
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
        summary: lastUserMessage ?
          (lastUserMessage.length > 50 ? lastUserMessage.substring(0, 50) + '...' : lastUserMessage) :
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

          // Extract messages from response_item
          if (entry.type === 'response_item' && entry.payload?.type === 'message') {
            const content = entry.payload.content;
            const role = entry.payload.role || 'assistant';
            const textContent = extractText(content);

            // Skip system context messages (environment_context)
            if (textContent?.includes('<environment_context>')) {
              continue;
            }

            // Only add if there's actual content
            if (textContent?.trim()) {
              messages.push({
                type: role === 'user' ? 'user' : 'assistant',
                timestamp: entry.timestamp,
                message: {
                  role: role,
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
      } catch (error) {}
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

export {
  getProjects,
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  deleteSession,
  isProjectEmpty,
  deleteProject,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache,
  getCodexSessions,
  getCodexSessionMessages,
  deleteCodexSession
};
