import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

export type OpenClaudeSession = {
  id: string;
  projectName: string;
  messageCount: number;
  lastModified: string;
  filePath: string;
};

export const OPENCLAUDE_PROJECTS_DIR = join(homedir(), '.openclaude', 'projects');

export async function parseOpenClaudeSessionDir(
  baseDir: string,
): Promise<OpenClaudeSession[]> {
  let projectDirs: string[];
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  const sessions: OpenClaudeSession[] = [];

  for (const projectName of projectDirs) {
    const projectPath = join(baseDir, projectName);

    let files: string[];
    try {
      const entries = await readdir(projectPath);
      files = entries.filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(projectPath, file);
      const id = basename(file, '.jsonl');

      try {
        const [content, fileStat] = await Promise.all([
          readFile(filePath, 'utf-8'),
          stat(filePath),
        ]);

        const lines = content.trim().split('\n').filter((l) => l.trim());

        sessions.push({
          id,
          projectName,
          messageCount: lines.length,
          lastModified: fileStat.mtime.toISOString(),
          filePath,
        });
      } catch {
        continue;
      }
    }
  }

  return sessions;
}
