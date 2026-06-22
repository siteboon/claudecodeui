/**
 * Tail-based session message loader — reads only the last N lines of a JSONL
 * file instead of scanning the entire 20-30MB file.
 *
 * Strategy: mmap the file via fs.stat + fs.read with offsets, scanning
 * backwards from EOF to find the requested number of message lines.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

interface AnyRecord {
  [key: string]: any;
}

/**
 * Read the last `numLines` lines from a file by scanning backwards from EOF.
 * Returns lines in file order (oldest first among the tail).
 */
async function tailLines(filePath: string, numLines: number): Promise<string[]> {
  const { size } = await fsp.stat(filePath);
  const CHUNK_SIZE = 8192; // 8KB chunks when scanning backwards

  const fd = await fsp.open(filePath, 'r');
  try {
    const result: Buffer[] = [];
    let offset = size;
    let linesFound = 0;
    let chunkCount = 0;

    while (offset > 0 && linesFound < numLines) {
      // Read a chunk from the end
      const readSize = Math.min(CHUNK_SIZE << chunkCount, CHUNK_SIZE << 16); // exponential backoff, max 256MB
      const step = Math.min(readSize, offset);
      const buffer = Buffer.alloc(step);
      const { bytesRead } = await fd.read(buffer, 0, step, offset - step);
      offset -= bytesRead;
      result.push(buffer.subarray(0, bytesRead));
      chunkCount++;

      // Count newlines in this chunk to track progress
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 10) { // \n
          linesFound++;
          if (linesFound >= numLines) break;
        }
      }
    }

    // If we also need lines from the very beginning (file started with content)
    if (offset > 0) {
      const remaining = Buffer.alloc(offset);
      const { bytesRead } = await fd.read(remaining, 0, offset, 0);
      result.push(remaining.subarray(0, bytesRead));
    }

    // Reverse to get file order, then split into lines
    const fullContent = Buffer.concat(result).toString('utf-8');
    const allLines = fullContent.split('\n').filter((l) => l.trim());
    // Take the last numLines
    return allLines.slice(-numLines);
  } finally {
    await fd.close();
  }
}

async function parseAgentTools(filePath: string): Promise<AnyRecord[]> {
  const tools: AnyRecord[] = [];
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as AnyRecord;
        if (entry.type === 'tool_use') {
          tools.push(entry);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Ignore agent file read errors
  }
  return tools;
}

/**
 * Load session messages using tail-based reading.
 * JSONL files are append-only and chronological, so the last N lines
 * are the most recent N entries.
 */
export async function loadSessionMessages({
  jsonLPath,
  providerSessionId,
  projectDir,
  agentFiles,
  limit,
  offset,
}: {
  jsonLPath: string;
  providerSessionId: string;
  projectDir: string;
  agentFiles: string[];
  limit: number | null;
  offset: number;
}): Promise<{ messages: AnyRecord[]; total: number; hasMore: boolean }> {
  // When limit is null (fetch all), cap at a reasonable number to prevent
  // loading the entire 20-30MB file. The frontend can paginate.
  const requestedLimit = limit ?? 5000;

  // We need (offset + limit) messages from the tail of the file.
  // Read extra to account for lines with different sessionId entries.
  const tailCount = Math.min((offset + requestedLimit) * 3, 50000);

  const lines = await tailLines(jsonLPath, tailCount);

  // Parse and filter for the correct session
  const messages: AnyRecord[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as AnyRecord;
      if (entry.sessionId === providerSessionId) {
        messages.push(entry);
      }
    } catch {
      // Skip malformed JSONL lines
    }
  }

  // Collect agent IDs
  const agentIds = new Set<string>();
  for (const message of messages) {
    const agentId = message.toolUseResult?.agentId;
    if (agentId) {
      agentIds.add(String(agentId));
    }
  }

  // Load agent tool files
  const agentToolsCache = new Map<string, AnyRecord[]>();
  for (const agentId of agentIds) {
    const agentFileName = `agent-${agentId}.jsonl`;
    if (!agentFiles.includes(agentFileName)) continue;
    const agentFilePath = path.join(projectDir, agentFileName);
    const tools = await parseAgentTools(agentFilePath);
    agentToolsCache.set(agentId, tools);
  }

  // Attach subagent tools to messages
  for (const message of messages) {
    const agentId = message.toolUseResult?.agentId;
    if (!agentId) continue;
    const agentTools = agentToolsCache.get(String(agentId));
    if (agentTools && agentTools.length > 0) {
      message.subagentTools = agentTools;
    }
  }

  // Sort by timestamp and reverse (newest first)
  messages.sort(
    (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime(),
  );
  const total = messages.length;
  messages.reverse();

  // Apply pagination
  if (limit !== null) {
    const slicedMessages = messages.slice(offset, offset + limit);
    return {
      messages: slicedMessages,
      total,
      hasMore: offset + limit < total,
    };
  }

  return {
    messages,
    total,
    hasMore: false,
  };
}
