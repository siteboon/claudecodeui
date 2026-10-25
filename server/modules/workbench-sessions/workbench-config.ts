import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { homeDataDir } from '@/modules/workbench-sessions/workbench-sessions.service.js';

/**
 * Machine-local settings (never synced): per-project run scripts and .env copy lists.
 * Lives in `~/.workbench/config.json`, outside every repository.
 */
export type WorkbenchConfig = {
  runScripts: Record<string, string>;
};

const configPath = () => path.join(homeDataDir(), 'config.json');

export async function readConfig(): Promise<WorkbenchConfig> {
  try {
    const parsed = JSON.parse(await readFile(configPath(), 'utf8')) as Partial<WorkbenchConfig>;
    return { runScripts: parsed.runScripts && typeof parsed.runScripts === 'object' ? parsed.runScripts : {} };
  } catch {
    return { runScripts: {} };
  }
}

export async function getRunScript(projectPath: string): Promise<string> {
  return (await readConfig()).runScripts[projectPath] ?? '';
}

export async function setRunScript(projectPath: string, command: string): Promise<void> {
  const config = await readConfig();
  const trimmed = command.trim();
  if (trimmed) config.runScripts[projectPath] = trimmed;
  else delete config.runScripts[projectPath];
  await mkdir(path.dirname(configPath()), { recursive: true });
  const temp = `${configPath()}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(temp, configPath());
}
