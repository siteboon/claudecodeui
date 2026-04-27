import fsSync, { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { projectsDb } from '@/modules/database/index.js';
import { generateDisplayName } from '@/modules/projects/index.js';
import sessionManager from '@/sessionManager.js';

type AnyRecord = Record<string, any>;

type SearchSnippetHighlight = {
  start: number;
  end: number;
};

type SessionConversationMatch = {
  role: string;
  snippet: string;
  highlights: SearchSnippetHighlight[];
  timestamp: string | null;
  provider: 'claude' | 'codex' | 'gemini';
  messageUuid?: string | null;
};

type SessionConversationResult = {
  sessionId: string;
  provider: 'claude' | 'codex' | 'gemini';
  sessionSummary: string;
  matches: SessionConversationMatch[];
};

type ProjectConversationResult = {
  projectId: string | null;
  projectName: string;
  projectDisplayName: string;
  sessions: SessionConversationResult[];
};

export type SessionConversationSearchProgressUpdate = {
  projectResult: ProjectConversationResult | null;
  totalMatches: number;
  scannedProjects: number;
  totalProjects: number;
};

type SearchSessionConversationsInput = {
  query: string;
  limit: number;
  signal?: AbortSignal;
  onProgress?: (update: SessionConversationSearchProgressUpdate) => void;
};

const projectDirectoryCache = new Map<string, string>();

async function loadProjectConfig(): Promise<Record<string, AnyRecord>> {
  const configPath = path.join(os.homedir(), '.claude', 'project-config.json');
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData) as Record<string, AnyRecord>;
  } catch {
    return {};
  }
}

async function extractProjectDirectory(projectName: string): Promise<string> {
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName) as string;
  }

  const config = await loadProjectConfig();
  if (config[projectName]?.originalPath) {
    const originalPath = String(config[projectName].originalPath);
    projectDirectoryCache.set(projectName, originalPath);
    return originalPath;
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
  const cwdCounts = new Map<string, number>();
  let latestTimestamp = 0;
  let latestCwd: string | null = null;
  let extractedPath: string;

  try {
    await fs.access(projectDir);

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter((file) => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      extractedPath = projectName.replace(/-/g, '/');
    } else {
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) {
            continue;
          }

          try {
            const entry = JSON.parse(line) as AnyRecord;
            if (!entry.cwd) {
              continue;
            }

            const cwd = String(entry.cwd);
            cwdCounts.set(cwd, (cwdCounts.get(cwd) || 0) + 1);

            const timestamp = new Date(entry.timestamp || 0).getTime();
            if (timestamp > latestTimestamp) {
              latestTimestamp = timestamp;
              latestCwd = cwd;
            }
          } catch {
            // Skip malformed lines.
          }
        }
      }

      if (cwdCounts.size === 0) {
        extractedPath = projectName.replace(/-/g, '/');
      } else if (cwdCounts.size === 1) {
        extractedPath = Array.from(cwdCounts.keys())[0] as string;
      } else {
        const latestCount = latestCwd ? (cwdCounts.get(latestCwd) || 0) : 0;
        const maxCount = Math.max(...cwdCounts.values());

        if (latestCount >= maxCount * 0.25 && latestCwd) {
          extractedPath = latestCwd;
        } else {
          let mostFrequentPath = '';
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              mostFrequentPath = cwd;
              break;
            }
          }

          extractedPath = mostFrequentPath || latestCwd || projectName.replace(/-/g, '/');
        }
      }
    }

    projectDirectoryCache.set(projectName, extractedPath);
    return extractedPath;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      extractedPath = projectName.replace(/-/g, '/');
    } else {
      console.error(`Error extracting project directory for ${projectName}:`, error);
      extractedPath = projectName.replace(/-/g, '/');
    }

    projectDirectoryCache.set(projectName, extractedPath);
    return extractedPath;
  }
}

function normalizeComparablePath(inputPath: string): string {
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

async function findCodexJsonlFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

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
  } catch {
    // Skip directories we can't read.
  }

  return files;
}

async function searchCodexSessionsForProject(
  projectPath: string,
  projectResult: ProjectConversationResult,
  allWordsMatch: (textLower: string) => boolean,
  buildSnippet: (text: string, textLower: string) => { snippet: string; highlights: SearchSnippetHighlight[] },
  limit: number,
  getTotalMatches: () => number,
  addMatches: (count: number) => void,
  isAborted: () => boolean,
): Promise<void> {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) {
    return;
  }

  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  try {
    await fs.access(codexSessionsDir);
  } catch {
    return;
  }

  const jsonlFiles = await findCodexJsonlFiles(codexSessionsDir);

  for (const filePath of jsonlFiles) {
    if (getTotalMatches() >= limit || isAborted()) {
      break;
    }

    try {
      const fileStream = fsSync.createReadStream(filePath);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      let sessionMeta: AnyRecord | null = null;
      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        try {
          const entry = JSON.parse(line) as AnyRecord;
          if (entry.type === 'session_meta' && entry.payload) {
            sessionMeta = entry.payload as AnyRecord;
            break;
          }
        } catch {
          // Skip malformed lines.
        }
      }

      if (!sessionMeta) {
        continue;
      }

      const sessionProjectPath = normalizeComparablePath(String(sessionMeta.cwd || ''));
      if (sessionProjectPath !== normalizedProjectPath) {
        continue;
      }

      const fileStream2 = fsSync.createReadStream(filePath);
      const rl2 = readline.createInterface({ input: fileStream2, crlfDelay: Infinity });
      let latestUserMessageText: string | null = null;
      const matches: SessionConversationMatch[] = [];

      for await (const line of rl2) {
        if (getTotalMatches() >= limit || isAborted()) {
          break;
        }
        if (!line.trim()) {
          continue;
        }

        let entry: AnyRecord;
        try {
          entry = JSON.parse(line) as AnyRecord;
        } catch {
          continue;
        }

        let text: string | null = null;
        let role: string | null = null;

        if (entry.type === 'event_msg' && entry.payload?.type === 'user_message' && entry.payload.message) {
          text = String(entry.payload.message);
          role = 'user';
          latestUserMessageText = text;
        } else if (entry.type === 'response_item' && entry.payload?.type === 'message') {
          const contentParts = Array.isArray(entry.payload.content) ? entry.payload.content : [];
          if (entry.payload.role === 'user') {
            text = contentParts
              .filter((part: AnyRecord) => part.type === 'input_text' && part.text)
              .map((part: AnyRecord) => String(part.text))
              .join(' ');
            role = 'user';
            if (text) {
              latestUserMessageText = text;
            }
          } else if (entry.payload.role === 'assistant') {
            text = contentParts
              .filter((part: AnyRecord) => part.type === 'output_text' && part.text)
              .map((part: AnyRecord) => String(part.text))
              .join(' ');
            role = 'assistant';
          }
        }

        if (!text || !role) {
          continue;
        }

        const textLower = text.toLowerCase();
        if (!allWordsMatch(textLower)) {
          continue;
        }

        if (matches.length < 2) {
          const { snippet, highlights } = buildSnippet(text, textLower);
          matches.push({
            role,
            snippet,
            highlights,
            timestamp: entry.timestamp ? String(entry.timestamp) : null,
            provider: 'codex',
          });
          addMatches(1);
        }
      }

      if (matches.length > 0) {
        projectResult.sessions.push({
          sessionId: String(sessionMeta.id || ''),
          provider: 'codex',
          sessionSummary: latestUserMessageText
            ? (latestUserMessageText.length > 50 ? `${latestUserMessageText.substring(0, 50)}...` : latestUserMessageText)
            : 'Codex Session',
          matches,
        });
      }
    } catch {
      // Skip unreadable or malformed files.
    }
  }
}

async function searchGeminiSessionsForProject(
  projectPath: string,
  projectResult: ProjectConversationResult,
  allWordsMatch: (textLower: string) => boolean,
  buildSnippet: (text: string, textLower: string) => { snippet: string; highlights: SearchSnippetHighlight[] },
  limit: number,
  getTotalMatches: () => number,
  addMatches: (count: number) => void,
): Promise<void> {
  for (const [sessionId, session] of sessionManager.sessions as Map<string, AnyRecord>) {
    if (getTotalMatches() >= limit) {
      break;
    }
    if (session.projectPath !== projectPath) {
      continue;
    }

    const matches: SessionConversationMatch[] = [];
    const sourceMessages = Array.isArray(session.messages) ? session.messages : [];

    for (const msg of sourceMessages) {
      if (getTotalMatches() >= limit) {
        break;
      }
      if (msg.role !== 'user' && msg.role !== 'assistant') {
        continue;
      }

      const text = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((part: AnyRecord) => part.type === 'text').map((part: AnyRecord) => String(part.text)).join(' ')
          : '';
      if (!text) {
        continue;
      }

      const textLower = text.toLowerCase();
      if (!allWordsMatch(textLower)) {
        continue;
      }

      if (matches.length < 2) {
        const { snippet, highlights } = buildSnippet(text, textLower);
        matches.push({
          role: String(msg.role),
          snippet,
          highlights,
          timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : null,
          provider: 'gemini',
        });
        addMatches(1);
      }
    }

    if (matches.length > 0) {
      const firstUserMessage = sourceMessages.find((msg: AnyRecord) => msg.role === 'user');
      const summary = firstUserMessage?.content
        ? (typeof firstUserMessage.content === 'string'
          ? (firstUserMessage.content.length > 50 ? `${firstUserMessage.content.substring(0, 50)}...` : firstUserMessage.content)
          : 'Gemini Session')
        : 'Gemini Session';

      projectResult.sessions.push({
        sessionId,
        provider: 'gemini',
        sessionSummary: summary,
        matches,
      });
    }
  }

  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) {
    return;
  }

  const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
  try {
    await fs.access(geminiTmpDir);
  } catch {
    return;
  }

  const trackedSessionIds = new Set<string>();
  for (const [sid] of sessionManager.sessions as Map<string, AnyRecord>) {
    trackedSessionIds.add(String(sid));
  }

  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(geminiTmpDir);
  } catch {
    return;
  }

  for (const projectDir of projectDirs) {
    if (getTotalMatches() >= limit) {
      break;
    }

    const projectRootFile = path.join(geminiTmpDir, projectDir, '.project_root');
    let projectRoot = '';
    try {
      projectRoot = (await fs.readFile(projectRootFile, 'utf8')).trim();
    } catch {
      continue;
    }

    if (normalizeComparablePath(projectRoot) !== normalizedProjectPath) {
      continue;
    }

    const chatsDir = path.join(geminiTmpDir, projectDir, 'chats');
    let chatFiles: string[];
    try {
      chatFiles = await fs.readdir(chatsDir);
    } catch {
      continue;
    }

    for (const chatFile of chatFiles) {
      if (getTotalMatches() >= limit) {
        break;
      }
      if (!chatFile.endsWith('.json')) {
        continue;
      }

      try {
        const filePath = path.join(chatsDir, chatFile);
        const data = await fs.readFile(filePath, 'utf8');
        const session = JSON.parse(data) as AnyRecord;
        if (!session.messages || !Array.isArray(session.messages)) {
          continue;
        }

        const cliSessionId = String(session.sessionId || chatFile.replace('.json', ''));
        if (trackedSessionIds.has(cliSessionId)) {
          continue;
        }

        const matches: SessionConversationMatch[] = [];
        let firstUserText: string | null = null;

        for (const msg of session.messages as AnyRecord[]) {
          if (getTotalMatches() >= limit) {
            break;
          }

          const role = msg.type === 'user'
            ? 'user'
            : (msg.type === 'gemini' || msg.type === 'assistant')
              ? 'assistant'
              : null;
          if (!role) {
            continue;
          }

          let text = '';
          if (typeof msg.content === 'string') {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            text = msg.content
              .filter((part: AnyRecord) => part.text)
              .map((part: AnyRecord) => String(part.text))
              .join(' ');
          }

          if (!text) {
            continue;
          }
          if (role === 'user' && !firstUserText) {
            firstUserText = text;
          }

          const textLower = text.toLowerCase();
          if (!allWordsMatch(textLower)) {
            continue;
          }

          if (matches.length < 2) {
            const { snippet, highlights } = buildSnippet(text, textLower);
            matches.push({
              role,
              snippet,
              highlights,
              timestamp: msg.timestamp ? String(msg.timestamp) : null,
              provider: 'gemini',
            });
            addMatches(1);
          }
        }

        if (matches.length > 0) {
          const summary = firstUserText
            ? (firstUserText.length > 50 ? `${firstUserText.substring(0, 50)}...` : firstUserText)
            : 'Gemini CLI Session';

          projectResult.sessions.push({
            sessionId: cliSessionId,
            provider: 'gemini',
            sessionSummary: summary,
            matches,
          });
        }
      } catch {
        // Skip unreadable or malformed files.
      }
    }
  }
}

export async function searchConversations(
  query: string,
  limit = 50,
  onProjectResult: ((update: SessionConversationSearchProgressUpdate) => void) | null = null,
  signal: AbortSignal | null = null,
): Promise<{ results: ProjectConversationResult[]; totalMatches: number; query: string }> {
  const safeQuery = typeof query === 'string' ? query.trim() : '';
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 200));
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const config = await loadProjectConfig();
  const results: ProjectConversationResult[] = [];
  let totalMatches = 0;
  const words = safeQuery.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return { results: [], totalMatches: 0, query: safeQuery };
  }

  const isAborted = () => signal?.aborted === true;

  const isSystemMessage = (textContent: string): boolean => {
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

  const extractText = (content: unknown): string => {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter((part: AnyRecord) => part.type === 'text' && part.text)
        .map((part: AnyRecord) => String(part.text))
        .join(' ');
    }
    return '';
  };

  const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordPatterns = words.map((word) => new RegExp(`(?<!\\p{L})${escapeRegex(word)}(?!\\p{L})`, 'u'));
  const allWordsMatch = (textLower: string): boolean => wordPatterns.every((pattern) => pattern.test(textLower));

  const buildSnippet = (
    text: string,
    textLower: string,
    snippetLen = 150,
  ): { snippet: string; highlights: SearchSnippetHighlight[] } => {
    let firstIndex = -1;
    let firstWordLen = 0;
    for (const word of words) {
      const regex = new RegExp(`(?<!\\p{L})${escapeRegex(word)}(?!\\p{L})`, 'u');
      const match = regex.exec(textLower);
      if (match && (firstIndex === -1 || match.index < firstIndex)) {
        firstIndex = match.index;
        firstWordLen = word.length;
      }
    }

    if (firstIndex === -1) {
      firstIndex = 0;
    }

    const halfLen = Math.floor(snippetLen / 2);
    const start = Math.max(0, firstIndex - halfLen);
    const end = Math.min(text.length, firstIndex + halfLen + firstWordLen);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    const snippet = `${prefix}${text.slice(start, end).replace(/\n/g, ' ')}${suffix}`;

    const snippetLower = snippet.toLowerCase();
    const highlights: SearchSnippetHighlight[] = [];
    for (const word of words) {
      const regex = new RegExp(`(?<!\\p{L})${escapeRegex(word)}(?!\\p{L})`, 'gu');
      let match: RegExpExecArray | null;
      match = regex.exec(snippetLower);
      while (match !== null) {
        highlights.push({ start: match.index, end: match.index + word.length });
        match = regex.exec(snippetLower);
      }
    }

    highlights.sort((left, right) => left.start - right.start);
    const merged: SearchSnippetHighlight[] = [];
    for (const highlight of highlights) {
      const previous = merged[merged.length - 1];
      if (previous && highlight.start <= previous.end) {
        previous.end = Math.max(previous.end, highlight.end);
      } else {
        merged.push({ ...highlight });
      }
    }

    return { snippet, highlights: merged };
  };

  try {
    await fs.access(claudeDir);
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    const projectDirs = entries.filter((entry) => entry.isDirectory());
    let scannedProjects = 0;
    const totalProjects = projectDirs.length;

    for (const projectEntry of projectDirs) {
      if (totalMatches >= safeLimit || isAborted()) {
        break;
      }

      const projectName = projectEntry.name;
      const projectDir = path.join(claudeDir, projectName);
      const projectDisplayName = config[projectName]?.displayName
        ? String(config[projectName].displayName)
        : await generateDisplayName(projectName);

      let files: string[];
      try {
        files = await fs.readdir(projectDir);
      } catch {
        continue;
      }

      const jsonlFiles = files.filter(
        (file) => file.endsWith('.jsonl') && !file.startsWith('agent-'),
      );

      let searchProjectId: string | null = null;
      try {
        const resolvedPath = await extractProjectDirectory(projectName);
        const dbRow = projectsDb.getProjectPath(resolvedPath);
        if (dbRow?.project_id) {
          searchProjectId = String(dbRow.project_id);
        }
      } catch {
        // Best-effort project id resolution.
      }

      const projectResult: ProjectConversationResult = {
        projectId: searchProjectId,
        projectName,
        projectDisplayName,
        sessions: [],
      };

      for (const file of jsonlFiles) {
        if (totalMatches >= safeLimit || isAborted()) {
          break;
        }

        const filePath = path.join(projectDir, file);
        const sessionMatches = new Map<string, SessionConversationMatch[]>();
        const sessionSummaries = new Map<string, string>();
        const pendingSummaries = new Map<string, string>();
        const sessionLastMessages = new Map<string, { user?: string; assistant?: string }>();
        let currentSessionId: string | null = null;

        try {
          const fileStream = fsSync.createReadStream(filePath);
          const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
          });

          for await (const line of rl) {
            if (totalMatches >= safeLimit || isAborted()) {
              break;
            }
            if (!line.trim()) {
              continue;
            }

            let entry: AnyRecord;
            try {
              entry = JSON.parse(line) as AnyRecord;
            } catch {
              continue;
            }

            if (entry.sessionId) {
              currentSessionId = String(entry.sessionId);
            }

            if (entry.type === 'summary' && entry.summary) {
              const summary = String(entry.summary);
              const sid = entry.sessionId
                ? String(entry.sessionId)
                : currentSessionId;
              if (sid) {
                sessionSummaries.set(sid, summary);
              } else if (entry.leafUuid) {
                pendingSummaries.set(String(entry.leafUuid), summary);
              }
            }

            if (entry.parentUuid && currentSessionId && !sessionSummaries.has(currentSessionId)) {
              const pendingSummary = pendingSummaries.get(String(entry.parentUuid));
              if (pendingSummary) {
                sessionSummaries.set(currentSessionId, pendingSummary);
              }
            }

            if (entry.message?.content && currentSessionId && !entry.isApiErrorMessage) {
              const role = entry.message.role;
              if (role === 'user' || role === 'assistant') {
                const text = extractText(entry.message.content);
                if (text && !isSystemMessage(text)) {
                  if (!sessionLastMessages.has(currentSessionId)) {
                    sessionLastMessages.set(currentSessionId, {});
                  }

                  const messages = sessionLastMessages.get(currentSessionId) as {
                    user?: string;
                    assistant?: string;
                  };
                  if (role === 'user') {
                    messages.user = text;
                  } else {
                    messages.assistant = text;
                  }
                }
              }
            }

            if (!entry.message?.content) {
              continue;
            }
            if (entry.message.role !== 'user' && entry.message.role !== 'assistant') {
              continue;
            }
            if (entry.isApiErrorMessage) {
              continue;
            }

            const text = extractText(entry.message.content);
            if (!text || isSystemMessage(text)) {
              continue;
            }

            const textLower = text.toLowerCase();
            if (!allWordsMatch(textLower)) {
              continue;
            }

            const resolvedSessionId = entry.sessionId
              ? String(entry.sessionId)
              : currentSessionId || file.replace('.jsonl', '');
            if (!sessionMatches.has(resolvedSessionId)) {
              sessionMatches.set(resolvedSessionId, []);
            }

            const matches = sessionMatches.get(resolvedSessionId) as SessionConversationMatch[];
            if (matches.length < 2) {
              const { snippet, highlights } = buildSnippet(text, textLower);
              matches.push({
                role: String(entry.message.role),
                snippet,
                highlights,
                timestamp: entry.timestamp ? String(entry.timestamp) : null,
                provider: 'claude',
                messageUuid: entry.uuid ? String(entry.uuid) : null,
              });
              totalMatches += 1;
            }
          }
        } catch {
          // Skip unreadable or malformed files.
        }

        for (const [sessionId, matches] of sessionMatches.entries()) {
          const lastMessages = sessionLastMessages.get(sessionId);
          const fallback = lastMessages?.user || lastMessages?.assistant;
          projectResult.sessions.push({
            sessionId,
            provider: 'claude',
            sessionSummary: sessionSummaries.get(sessionId)
              || (fallback ? (fallback.length > 50 ? `${fallback.substring(0, 50)}...` : fallback) : 'New Session'),
            matches,
          });
        }
      }

      try {
        const actualProjectDir = await extractProjectDirectory(projectName);
        if (actualProjectDir && !isAborted() && totalMatches < safeLimit) {
          await searchCodexSessionsForProject(
            actualProjectDir,
            projectResult,
            allWordsMatch,
            buildSnippet,
            safeLimit,
            () => totalMatches,
            (count) => { totalMatches += count; },
            isAborted,
          );
        }
      } catch {
        // Skip codex search errors.
      }

      try {
        const actualProjectDir = await extractProjectDirectory(projectName);
        if (actualProjectDir && !isAborted() && totalMatches < safeLimit) {
          await searchGeminiSessionsForProject(
            actualProjectDir,
            projectResult,
            allWordsMatch,
            buildSnippet,
            safeLimit,
            () => totalMatches,
            (count) => { totalMatches += count; },
          );
        }
      } catch {
        // Skip gemini search errors.
      }

      scannedProjects += 1;
      if (projectResult.sessions.length > 0) {
        results.push(projectResult);
        onProjectResult?.({ projectResult, totalMatches, scannedProjects, totalProjects });
      } else if (onProjectResult && scannedProjects % 10 === 0) {
        onProjectResult({ projectResult: null, totalMatches, scannedProjects, totalProjects });
      }
    }
  } catch {
    // ~/.claude/projects does not exist.
  }

  return { results, totalMatches, query: safeQuery };
}

/**
 * Application service for session-conversation search.
 *
 * Provider routes call this service so route handlers stay focused on
 * request parsing/response formatting, while search execution remains
 * centralized in one place.
 */
export const sessionConversationsSearchService = {
  /**
   * Streams progress updates while the search scans provider session logs.
   */
  async search(input: SearchSessionConversationsInput): Promise<void> {
    await searchConversations(
      input.query,
      input.limit,
      input.onProgress ?? null,
      input.signal ?? null,
    );
  },
};
