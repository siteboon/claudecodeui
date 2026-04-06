/**
 * @module ccud/handlers/claude
 * Claude CLI session management handler for claude/* RPC methods.
 * Spawns the claude CLI as a child process with --output-format stream-json,
 * relays structured output as JSON-RPC notifications via the transport.
 */
import { spawn, execFile } from 'child_process';
import { createReadStream } from 'fs';
import { readdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { promisify } from 'util';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);
const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

/** @type {Map<string, { process: import('child_process').ChildProcess, cwd: string }>} */
const activeSessions = new Map();

async function findProjectDirForSession(sessionId, cwd) {
  let fallbackProjectDir = null;

  // Fast path: try the directory derived from cwd first
  if (cwd) {
    const dirName = cwd.replace(/\//g, '-');
    const candidateDir = path.join(claudeProjectsDir, dirName);
    try {
      const files = await readdir(candidateDir);
      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'));
      for (const file of jsonlFiles) {
        const content = await readFile(path.join(candidateDir, file), 'utf8');
        if (content.includes(sessionId)) {
          return candidateDir;
        }
      }
    } catch {
      // Directory doesn't exist, fall through to full scan
    }
  }

  try {
    const projectEntries = await readdir(claudeProjectsDir, { withFileTypes: true });

    for (const entry of projectEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const projectDir = path.join(claudeProjectsDir, entry.name);
      let files = [];

      try {
        files = await readdir(projectDir);
      } catch {
        continue;
      }

      const jsonlFiles = files.filter((file) => file.endsWith('.jsonl') && !file.startsWith('agent-'));
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        let matchedSession = false;

        try {
          for await (const line of rl) {
            if (!line.trim()) {
              continue;
            }

            try {
              const parsed = JSON.parse(line);
              if (parsed.sessionId !== sessionId) {
                continue;
              }

              matchedSession = true;
              if (!cwd || parsed.cwd === cwd) {
                return projectDir;
              }
            } catch {
              // Skip malformed lines while scanning for the matching session.
            }
          }
        } finally {
          rl.close();
        }

        if (matchedSession && !fallbackProjectDir) {
          fallbackProjectDir = projectDir;
        }
      }
    }
  } catch {
    return null;
  }

  return fallbackProjectDir;
}

async function parseAgentTools(filePath) {
  const tools = [];

  try {
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line);
        if (entry.message?.role === 'assistant' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content) {
            if (part.type === 'tool_use') {
              tools.push({
                toolId: part.id,
                toolName: part.name,
                toolInput: part.input,
                timestamp: entry.timestamp,
              });
            }
          }
        }

        if (entry.message?.role === 'user' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content) {
            if (part.type === 'tool_result') {
              const tool = tools.find((candidate) => candidate.toolId === part.tool_use_id);
              if (tool) {
                tool.toolResult = {
                  content: typeof part.content === 'string'
                    ? part.content
                    : Array.isArray(part.content)
                      ? part.content.map((content) => content.text || '').join('\n')
                      : JSON.stringify(part.content),
                  isError: Boolean(part.is_error),
                };
              }
            }
          }
        }
      } catch {
        // Skip malformed lines.
      }
    }
  } catch (error) {
    console.warn(`Error parsing agent file ${filePath}:`, error.message);
  }

  return tools;
}

async function loadSessionMessages(sessionId, cwd, limit = null, offset = 0) {
  try {
    const projectDir = await findProjectDirForSession(sessionId, cwd);
    if (!projectDir) {
      return limit === null ? [] : {
        messages: [],
        total: 0,
        hasMore: false,
        offset,
        limit,
      };
    }

    const files = await readdir(projectDir);
    const jsonlFiles = files.filter((file) => file.endsWith('.jsonl') && !file.startsWith('agent-'));
    const agentFiles = files.filter((file) => file.endsWith('.jsonl') && file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return limit === null ? [] : {
        messages: [],
        total: 0,
        hasMore: false,
        offset,
        limit,
      };
    }

    const messages = [];
    const agentToolsCache = new Map();

    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const fileStream = createReadStream(jsonlFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        try {
          const entry = JSON.parse(line);
          if (entry.sessionId === sessionId) {
            messages.push(entry);
          }
        } catch {
          // Skip malformed lines from concurrently-written JSONL files.
        }
      }
    }

    const agentIds = new Set();
    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        agentIds.add(message.toolUseResult.agentId);
      }
    }

    for (const agentId of agentIds) {
      const agentFileName = `agent-${agentId}.jsonl`;
      if (agentFiles.includes(agentFileName)) {
        const agentFilePath = path.join(projectDir, agentFileName);
        const tools = await parseAgentTools(agentFilePath);
        agentToolsCache.set(agentId, tools);
      }
    }

    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        const agentTools = agentToolsCache.get(message.toolUseResult.agentId);
        if (agentTools && agentTools.length > 0) {
          message.subagentTools = agentTools;
        }
      }
    }

    const sortedMessages = messages.sort((a, b) =>
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0),
    );

    if (limit === null) {
      return sortedMessages;
    }

    const total = sortedMessages.length;
    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;

    return {
      messages: sortedMessages.slice(startIndex, endIndex),
      total,
      hasMore: startIndex > 0,
      offset,
      limit,
    };
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return limit === null ? [] : {
      messages: [],
      total: 0,
      hasMore: false,
      offset,
      limit,
    };
  }
}

/**
 * List sessions for a project directory by scanning JSONL files.
 * The Claude CLI stores sessions in ~/.claude/projects/<dir-name>/ where
 * <dir-name> is the cwd with '/' replaced by '-'.
 * @param {string} cwd - The project working directory
 * @returns {Promise<Array<{id: string, title: string, created: string, updated: string}>>}
 */
async function listSessions(cwd) {
  const sessions = new Map();

  try {
    // Claude CLI directory naming: /home/ubuntu/foo → -home-ubuntu-foo
    const dirName = cwd.replace(/\//g, '-');
    const projectDir = path.join(claudeProjectsDir, dirName);

    let files;
    try {
      files = await readdir(projectDir);
    } catch {
      return [];
    }

    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'));
    if (jsonlFiles.length === 0) return [];

    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const fileStream = createReadStream(jsonlFile);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      try {
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (!parsed.sessionId) continue;

            const ts = parsed.timestamp || null;

            if (!sessions.has(parsed.sessionId)) {
              sessions.set(parsed.sessionId, {
                id: parsed.sessionId,
                title: null,
                lastUserMessage: null,
                lastAssistantMessage: null,
                messageCount: 0,
                created: ts || new Date().toISOString(),
                updated: ts || new Date().toISOString(),
              });
            }

            const session = sessions.get(parsed.sessionId);
            if (ts && ts > session.updated) session.updated = ts;
            if (ts && ts < session.created) session.created = ts;
            session.messageCount++;

            // Explicit summary entry (highest priority)
            if (parsed.type === 'summary' && parsed.summary) {
              session.title = parsed.summary;
            }

            // Track last user message (skip system messages)
            if (parsed.type === 'user' && parsed.message?.content) {
              const content = parsed.message.content;
              let text = null;
              if (typeof content === 'string') {
                text = content;
              } else if (Array.isArray(content) && content.length > 0) {
                const textBlock = content.find((b) => b.type === 'text' && b.text);
                if (textBlock) text = textBlock.text;
              }
              if (text && !text.startsWith('<command-name>') &&
                  !text.startsWith('<system-reminder>') &&
                  !text.startsWith('Caveat:') &&
                  text !== 'Warmup') {
                session.lastUserMessage = text;
              }
            }

            // Track last assistant message as fallback
            if (parsed.type === 'assistant' && parsed.message?.content) {
              const content = parsed.message.content;
              let text = null;
              if (typeof content === 'string') {
                text = content;
              } else if (Array.isArray(content)) {
                for (const part of content) {
                  if (part.type === 'text' && part.text) text = part.text;
                }
              }
              if (text) session.lastAssistantMessage = text;
            }
          } catch { /* skip malformed */ }
        }
      } finally {
        rl.close();
      }
    }
  } catch {
    return [];
  }

  // Apply naming: summary entry > last user message > last assistant message
  // Matches local session naming in server/projects.js
  const result = [];
  for (const session of sessions.values()) {
    if (!session.title) {
      const msg = session.lastUserMessage || session.lastAssistantMessage;
      session.title = msg
        ? (msg.length > 50 ? msg.substring(0, 50) + '...' : msg)
        : 'New Session';
    }
    result.push({
      id: session.id,
      title: session.title,
      created: session.created,
      updated: session.updated,
      messageCount: session.messageCount,
    });
  }

  return result.sort((a, b) => new Date(b.updated) - new Date(a.updated));
}

async function deleteSessionMessages(sessionId, cwd) {
  const projectDir = await findProjectDirForSession(sessionId, cwd);
  if (!projectDir) {
    throw new Error(`Session ${sessionId} not found in any files`);
  }

  const files = await readdir(projectDir);
  const jsonlFiles = files.filter((file) => file.endsWith('.jsonl'));

  if (jsonlFiles.length === 0) {
    throw new Error('No session files found for this project');
  }

  for (const file of jsonlFiles) {
    const jsonlFile = path.join(projectDir, file);
    const content = await readFile(jsonlFile, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim());

    const hasSession = lines.some((line) => {
      try {
        return JSON.parse(line).sessionId === sessionId;
      } catch {
        return false;
      }
    });

    if (hasSession) {
      const filteredLines = lines.filter((line) => {
        try {
          return JSON.parse(line).sessionId !== sessionId;
        } catch {
          return true;
        }
      });

      await writeFile(
        jsonlFile,
        filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : ''),
        'utf8',
      );
      return true;
    }
  }

  throw new Error(`Session ${sessionId} not found in any files`);
}

/**
 * Check if the claude CLI is available on the system PATH.
 * @returns {Promise<boolean>}
 */
async function isClaudeAvailable() {
  try {
    await execFileAsync('command', ['-v', 'claude'], { shell: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle all claude/* JSON-RPC methods.
 *
 * Supported methods:
 * - claude/start: Start a Claude CLI session (spawns child process)
 * - claude/input: Send text input to a running session's stdin
 * - claude/abort: Kill a running session
 * - claude/list-sessions: List existing Claude sessions in a directory
 * - claude/get-session-messages: Load persisted JSONL entries for a session
 * - claude/delete-session: Delete persisted JSONL entries for a session
 * - claude/get-token-usage: Read token usage from the latest assistant message in session JSONL
 *
 * @param {string} method - The RPC method name (e.g., 'claude/start')
 * @param {object} params - Method parameters
 * @param {object} transport - The stdio transport for sending notifications
 * @returns {Promise<object>} Result object or error object with { error: { code, message } }
 */
export async function handleClaude(method, params, transport) {
  switch (method) {
    case 'claude/start': {
      const available = await isClaudeAvailable();
      if (!available) {
        return {
          error: {
            code: -32000,
            message: 'Claude Code CLI not found on remote host. Install it with: npm install -g @anthropic-ai/claude-code',
          },
        };
      }

      const sessionId = params.sessionId || crypto.randomUUID();

      const args = ['--output-format', 'stream-json', '--verbose'];
      if (params.resume && params.sessionId) {
        args.push('--resume', params.sessionId);
      } else if (params.sessionId) {
        // Pin the session ID so the server-side UUID matches the CLI's session
        args.push('--session-id', params.sessionId);
      }
      if (params.options?.model) {
        args.push('--model', params.options.model);
      }
      if (params.options?.permissionMode) {
        args.push('--permission-mode', params.options.permissionMode);
      }
      if (params.command) {
        args.push('-p', params.command);
      }

      let proc;
      try {
        proc = spawn('claude', args, {
          cwd: params.cwd,
          env: { ...process.env, TERM: 'dumb' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        return {
          error: {
            code: -32000,
            message: 'Failed to spawn Claude CLI: ' + err.message,
          },
        };
      }

      activeSessions.set(sessionId, { process: proc, cwd: params.cwd });

      // Accumulate response text from assistant/message events so we can
      // include it in the exit notification as a fallback. This protects
      // against notifications being lost when the stdout pipe is congested
      // by large concurrent responses (e.g., fs/readdir).
      let accumulatedText = '';

      // Safe send helper — transport may be closed during daemon shutdown
      const safeSend = (msg) => {
        try { transport.send(msg); } catch { /* stdout closed during shutdown */ }
      };

      // Parse stdout as newline-delimited JSON (stream-json format)
      let buffer = '';
      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete last line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            // Capture text from assistant/message events
            if ((event.type === 'assistant' || event.type === 'message') && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  accumulatedText += block.text;
                }
              }
            }
            // Also capture from result event if present
            if (event.type === 'result' && typeof event.result === 'string') {
              if (!accumulatedText) accumulatedText = event.result;
            }

            safeSend({
              jsonrpc: '2.0',
              method: 'claude/output',
              params: { sessionId, event },
            });
          } catch {
            // Non-JSON output -- send as raw text
            safeSend({
              jsonrpc: '2.0',
              method: 'claude/output',
              params: { sessionId, event: { type: 'raw', text: line } },
            });
          }
        }
      });

      // Relay stderr as notifications
      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) {
          safeSend({
            jsonrpc: '2.0',
            method: 'claude/output',
            params: { sessionId, event: { type: 'stderr', text } },
          });
        }
      });

      // Handle process exit — include accumulated text as fallback
      proc.on('exit', (code, signal) => {
        activeSessions.delete(sessionId);
        safeSend({
          jsonrpc: '2.0',
          method: 'claude/output',
          params: { sessionId, event: { type: 'exit', code, signal, accumulatedText: accumulatedText || null } },
        });
      });

      // Handle spawn errors (ENOENT, EACCES, etc.)
      proc.on('error', (err) => {
        activeSessions.delete(sessionId);
        safeSend({
          jsonrpc: '2.0',
          method: 'claude/output',
          params: { sessionId, event: { type: 'exit', code: 1, signal: null, error: err.message } },
        });
      });

      return { sessionId, started: true };
    }

    case 'claude/input': {
      const session = activeSessions.get(params.sessionId);
      if (!session) {
        return { error: { code: -32000, message: 'Session not found' } };
      }
      try {
        session.process.stdin.write(params.text + '\n');
      } catch (err) {
        return { error: { code: -32000, message: 'Failed to write to stdin: ' + err.message } };
      }
      return { sent: true };
    }

    case 'claude/abort': {
      const session = activeSessions.get(params.sessionId);
      if (session) {
        session.process.kill('SIGTERM');
        // Fallback to SIGKILL after 5 seconds
        const killTimer = setTimeout(() => {
          try {
            session.process.kill('SIGKILL');
          } catch {
            // Process may already be dead
          }
        }, 5000);
        session.process.on('exit', () => clearTimeout(killTimer));
        activeSessions.delete(params.sessionId);
      }
      return { aborted: true };
    }

    case 'claude/list-sessions': {
      try {
        const sessions = await listSessions(params.cwd);
        return { sessions };
      } catch {
        return { sessions: [], error: 'Failed to list sessions' };
      }
    }

    case 'claude/get-session-messages': {
      return await loadSessionMessages(
        params.sessionId,
        params.cwd,
        params.limit ?? null,
        params.offset ?? 0,
      );
    }

    case 'claude/delete-session': {
      try {
        await deleteSessionMessages(params.sessionId, params.cwd);
        return { deleted: true };
      } catch (error) {
        return {
          error: {
            code: -32000,
            message: error.message || 'Failed to delete session',
          },
        };
      }
    }

    case 'claude/get-token-usage': {
      const emptyUsage = {
        used: 0,
        total: 160000,
        breakdown: { input: 0, cacheCreation: 0, cacheRead: 0 },
      };

      try {
        const projectDir = await findProjectDirForSession(params.sessionId, params.cwd);
        if (!projectDir) {
          return emptyUsage;
        }

        const files = await readdir(projectDir);
        const jsonlFiles = files.filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'));

        for (const file of jsonlFiles) {
          const filePath = path.join(projectDir, file);
          const content = await readFile(filePath, 'utf8');
          const lines = content.split('\n').filter((line) => line.trim());

          // Scan from the end to find the latest assistant message with usage data
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const entry = JSON.parse(lines[i]);
              if (entry.sessionId !== params.sessionId) continue;
              if (entry.message?.role !== 'assistant' || !entry.message?.usage) continue;

              const usage = entry.message.usage;
              const inputTokens = usage.input_tokens || 0;
              const cacheCreation = usage.cache_creation_input_tokens || 0;
              const cacheRead = usage.cache_read_input_tokens || 0;

              return {
                used: inputTokens + cacheCreation + cacheRead,
                total: 160000,
                breakdown: {
                  input: inputTokens,
                  cacheCreation,
                  cacheRead,
                },
              };
            } catch {
              // Skip malformed lines
            }
          }
        }

        return emptyUsage;
      } catch (error) {
        console.error(`Error reading token usage for session ${params.sessionId}:`, error);
        return emptyUsage;
      }
    }

    case 'claude/search-conversations': {
      const { cwd, query, limit: maxResults = 50 } = params;
      if (!cwd || !query) {
        return { error: { code: -32602, message: 'Missing required params: cwd, query' } };
      }

      const dirName = cwd.replace(/\//g, '-');
      const projectDir = path.join(claudeProjectsDir, dirName);

      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const words = query.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        return { results: [], totalMatches: 0, query };
      }

      const wordPatterns = words.map((w) =>
        new RegExp('(?<!\\p{L})' + escapeRegex(w) + '(?!\\p{L})', 'iu'),
      );

      let files;
      try {
        files = await readdir(projectDir);
      } catch {
        return { results: [], totalMatches: 0, query };
      }

      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'));
      if (jsonlFiles.length === 0) {
        return { results: [], totalMatches: 0, query };
      }

      // sessionId -> { matches: [], lastUserMessage: string|null }
      const sessionData = new Map();
      let totalMatches = 0;

      for (const file of jsonlFiles) {
        if (totalMatches >= maxResults) break;

        const jsonlFile = path.join(projectDir, file);
        const fileStream = createReadStream(jsonlFile);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        try {
          for await (const line of rl) {
            if (totalMatches >= maxResults) break;
            if (!line.trim()) continue;

            let entry;
            try {
              entry = JSON.parse(line);
            } catch {
              continue;
            }

            if (!entry.sessionId) continue;

            const role = entry.type === 'user' ? 'user'
              : entry.type === 'assistant' ? 'assistant'
                : null;
            if (!role) continue;

            // Extract text from message content
            const content = entry.message?.content;
            let text = null;
            if (typeof content === 'string') {
              text = content;
            } else if (Array.isArray(content)) {
              const textParts = [];
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  textParts.push(block.text);
                }
              }
              if (textParts.length > 0) text = textParts.join(' ');
            }
            if (!text) continue;

            // Track last user message per session (skip system messages)
            if (role === 'user') {
              const isSystem = text.startsWith('<command-name>') ||
                text.startsWith('<system-reminder>') ||
                text.startsWith('Caveat:') ||
                text === 'Warmup' ||
                text.startsWith('Warmup');
              if (!isSystem) {
                if (!sessionData.has(entry.sessionId)) {
                  sessionData.set(entry.sessionId, { matches: [], lastUserMessage: null });
                }
                sessionData.get(entry.sessionId).lastUserMessage = text;
              }
            }

            // Skip system messages for search matching
            if (text.startsWith('<command-name>') ||
                text.startsWith('<system-reminder>') ||
                text.startsWith('Caveat:') ||
                text === 'Warmup' ||
                text.startsWith('Warmup')) {
              continue;
            }

            // AND logic: every word must appear in the text
            const allMatch = wordPatterns.every((pattern) => pattern.test(text));
            if (!allMatch) continue;

            if (!sessionData.has(entry.sessionId)) {
              sessionData.set(entry.sessionId, { matches: [], lastUserMessage: null });
            }
            const session = sessionData.get(entry.sessionId);

            // Max 2 matches per session
            if (session.matches.length >= 2) continue;

            // Build 150-char snippet centered on the first matched word
            const firstMatch = wordPatterns[0].exec(text);
            const matchPos = firstMatch ? firstMatch.index : 0;
            const snippetLength = 150;
            const halfSnippet = Math.floor(snippetLength / 2);

            let snippetStart = Math.max(0, matchPos - halfSnippet);
            let snippetEnd = Math.min(text.length, snippetStart + snippetLength);
            if (snippetEnd - snippetStart < snippetLength && snippetStart > 0) {
              snippetStart = Math.max(0, snippetEnd - snippetLength);
            }

            let snippet = text.substring(snippetStart, snippetEnd);
            const prefix = snippetStart > 0 ? '...' : '';
            const suffix = snippetEnd < text.length ? '...' : '';
            snippet = prefix + snippet + suffix;

            // Compute highlight positions within the snippet
            const highlights = [];
            for (const pattern of wordPatterns) {
              const globalPattern = new RegExp(pattern.source, 'giu');
              let match;
              while ((match = globalPattern.exec(snippet)) !== null) {
                highlights.push({ start: match.index, end: match.index + match[0].length });
              }
            }

            // Sort and merge overlapping highlights
            highlights.sort((a, b) => a.start - b.start || a.end - b.end);
            const merged = [];
            for (const h of highlights) {
              if (merged.length > 0 && h.start <= merged[merged.length - 1].end) {
                merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, h.end);
              } else {
                merged.push({ ...h });
              }
            }

            session.matches.push({
              role,
              snippet,
              highlights: merged,
              timestamp: entry.timestamp || null,
              provider: 'claude',
              messageUuid: entry.uuid || null,
            });
            totalMatches++;
          }
        } finally {
          rl.close();
        }
      }

      // Build results array
      const results = [];
      for (const [sessionId, data] of sessionData) {
        if (data.matches.length === 0) continue;
        const summary = data.lastUserMessage
          ? (data.lastUserMessage.length > 50
            ? data.lastUserMessage.substring(0, 50) + '...'
            : data.lastUserMessage)
          : 'New Session';
        results.push({
          sessionId,
          provider: 'claude',
          sessionSummary: summary,
          matches: data.matches,
        });
      }

      return { results, totalMatches, query };
    }

    default:
      return { error: { code: -32601, message: 'Method not found: ' + method } };
  }
}

/**
 * Kill all active Claude sessions and clear the session map.
 * Called during daemon shutdown to release resources.
 */
export function cleanupAllClaudeSessions() {
  for (const [sessionId, session] of activeSessions) {
    try {
      session.process.kill('SIGTERM');
    } catch {
      // Process may already be dead
    }
    activeSessions.delete(sessionId);
  }
}
