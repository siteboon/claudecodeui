import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';

const yamlScalar = (value: unknown): string => {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return JSON.stringify(String(value));
};

const parseYamlScalar = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed === 'null') {
    return null;
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
    || (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed.replace(/\s+#.*$/, '').trim();
};

const getIndent = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0;

const parseYamlArray = (
  lines: string[],
  startIndex: number,
  indent: number,
): { value: unknown[]; nextIndex: number } => {
  const value: unknown[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (getIndent(line) !== indent || !line.trimStart().startsWith('- ')) {
      break;
    }
    value.push(parseYamlScalar(line.trimStart().slice(2)));
    index += 1;
  }
  return { value, nextIndex: index };
};

const parseYamlMap = (
  lines: string[],
  startIndex: number,
  indent: number,
): { value: Record<string, unknown>; nextIndex: number } => {
  const value: Record<string, unknown> = {};
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const currentIndent = getIndent(line);
    if (currentIndent < indent) {
      break;
    }
    if (currentIndent > indent) {
      index += 1;
      continue;
    }
    const match = line.slice(indent).match(/^([^:#]+):(?:\s*(.*))?$/);
    if (!match) {
      index += 1;
      continue;
    }

    const key = match[1].trim();
    const raw = match[2]?.trim() ?? '';
    if (raw) {
      value[key] = parseYamlScalar(raw);
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1];
    if (nextLine && getIndent(nextLine) > indent && nextLine.trimStart().startsWith('- ')) {
      const parsed = parseYamlArray(lines, index + 1, getIndent(nextLine));
      value[key] = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    const parsed = parseYamlMap(lines, index + 1, indent + 2);
    value[key] = parsed.value;
    index = parsed.nextIndex;
  }
  return { value, nextIndex: index };
};

const readYamlConfig = async (filePath: string): Promise<string> => {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return '';
    }
    throw error;
  }
};

const readMcpServers = async (filePath: string): Promise<Record<string, unknown>> => {
  const content = await readYamlConfig(filePath);
  const lines = content.split(/\r?\n/);
  const sectionIndex = lines.findIndex((line) => /^mcp_servers\s*:\s*$/.test(line));
  if (sectionIndex === -1) {
    return {};
  }
  const parsed = parseYamlMap(lines, sectionIndex + 1, 2);
  return readObjectRecord(parsed.value) ?? {};
};

const serializeYamlMap = (value: Record<string, unknown>, indent = 0): string[] => {
  const lines: string[] = [];
  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue === undefined) {
      continue;
    }
    const prefix = `${' '.repeat(indent)}${key}:`;
    if (Array.isArray(rawValue)) {
      lines.push(prefix);
      for (const item of rawValue) {
        lines.push(`${' '.repeat(indent + 2)}- ${yamlScalar(item)}`);
      }
      continue;
    }
    const nested = readObjectRecord(rawValue);
    if (nested) {
      lines.push(prefix);
      lines.push(...serializeYamlMap(nested, indent + 2));
      continue;
    }
    lines.push(`${prefix} ${yamlScalar(rawValue)}`);
  }
  return lines;
};

const replaceMcpServersSection = (content: string, servers: Record<string, unknown>): string => {
  const lines = content.split(/\r?\n/);
  const sectionIndex = lines.findIndex((line) => /^mcp_servers\s*:\s*$/.test(line));
  const serialized = ['mcp_servers:', ...serializeYamlMap(servers, 2)];

  if (sectionIndex === -1) {
    const prefix = content.trimEnd();
    return `${prefix ? `${prefix}\n\n` : ''}${serialized.join('\n')}\n`;
  }

  let endIndex = sectionIndex + 1;
  while (endIndex < lines.length) {
    const line = lines[endIndex];
    if (line.trim() && getIndent(line) === 0) {
      break;
    }
    endIndex += 1;
  }

  lines.splice(sectionIndex, endIndex - sectionIndex, ...serialized);
  return `${lines.join('\n').trimEnd()}\n`;
};

const writeMcpServers = async (filePath: string, servers: Record<string, unknown>): Promise<void> => {
  const content = await readYamlConfig(filePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, replaceMcpServersSection(content, servers), 'utf8');
};

export class HermesMcpProvider extends McpProvider {
  constructor() {
    super('hermes', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = scope === 'user'
      ? path.join(os.homedir(), '.hermes', 'config.yaml')
      : path.join(workspacePath, '.hermes', 'config.yaml');
    return readMcpServers(filePath);
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = scope === 'user'
      ? path.join(os.homedir(), '.hermes', 'config.yaml')
      : path.join(workspacePath, '.hermes', 'config.yaml');
    await writeMcpServers(filePath, servers);
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
        cwd: input.cwd,
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http/sse MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      type: input.transport,
      url: input.url,
      headers: input.headers ?? {},
    };
  }

  protected normalizeServerConfig(scope: McpScope, name: string, rawConfig: unknown): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    if (typeof config.command === 'string') {
      return {
        provider: 'hermes',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
      };
    }

    if (typeof config.url === 'string') {
      return {
        provider: 'hermes',
        name,
        scope,
        transport: 'http',
        url: config.url,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
