import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

import { findFilesRecursivelyCreatedAfter, readObjectRecord } from '@/shared/utils.js';

export type CodexTranscriptMeta = {
  sessionId: string;
  projectPath: string;
  threadSource?: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
};

export async function readCodexTranscriptMeta(filePath: string): Promise<CodexTranscriptMeta | null> {
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const entry = readObjectRecord(parsed);
      const payload = readObjectRecord(entry?.payload);
      if (entry?.type !== 'session_meta' || !payload) continue;

      const sessionId = typeof payload.id === 'string' ? payload.id : undefined;
      const projectPath = typeof payload.cwd === 'string' ? payload.cwd : undefined;
      if (!sessionId || !projectPath) return null;

      const source = readObjectRecord(payload.source);
      const subagent = readObjectRecord(source?.subagent);
      const threadSpawn = readObjectRecord(subagent?.thread_spawn);

      return {
        sessionId,
        projectPath,
        threadSource: typeof payload.thread_source === 'string' ? payload.thread_source : undefined,
        parentThreadId:
          typeof payload.parent_thread_id === 'string'
            ? payload.parent_thread_id
            : typeof threadSpawn?.parent_thread_id === 'string'
              ? threadSpawn.parent_thread_id
              : undefined,
        agentNickname: typeof payload.agent_nickname === 'string' ? payload.agent_nickname : undefined,
        agentRole: typeof payload.agent_role === 'string' ? payload.agent_role : undefined,
      };
    }
  } catch {
    return null;
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return null;
}

export async function isCodexSubagentTranscript(filePath: string): Promise<boolean> {
  return (await readCodexTranscriptMeta(filePath))?.threadSource === 'subagent';
}

export async function findCodexSubagentTranscriptFiles(
  parentThreadId: string,
  rootDir = path.join(os.homedir(), '.codex', 'sessions'),
): Promise<string[]> {
  const files = await findFilesRecursivelyCreatedAfter(rootDir, '.jsonl', null);
  const matches: string[] = [];

  for (const filePath of files) {
    const meta = await readCodexTranscriptMeta(filePath);
    if (meta?.threadSource === 'subagent' && meta.parentThreadId === parentThreadId) {
      matches.push(filePath);
    }
  }

  return matches.sort();
}
