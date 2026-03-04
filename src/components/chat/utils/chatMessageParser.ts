import type { ChatMessage } from '../types/types';

export type UiMessageKind =
  | 'thinking'
  | 'bash'
  | 'file-read'
  | 'code-diff'
  | 'file-write'
  | 'web-search'
  | 'file-tree'
  | 'error-warning'
  | 'tool-invocation'
  | 'image-generation'
  | 'streaming-prose'
  | 'summary-completion';

export interface SearchResultItem {
  title: string;
  url?: string;
  snippet?: string;
}

export interface TreeItem {
  name: string;
  type: 'file' | 'folder';
  size?: string;
}

export interface ParsedUiMessage {
  kind: UiMessageKind;
  collapsible: boolean;
  defaultOpen: boolean;
  title?: string;
  details?: string;
  path?: string;
  filename?: string;
  language?: string;
  lineCount?: number;
  command?: string;
  output?: string;
  exitCode?: number | null;
  query?: string;
  resultCount?: number;
  searchResults?: SearchResultItem[];
  treeItems?: TreeItem[];
  content?: string;
  status?: 'running' | 'done' | 'error' | 'created' | 'saved' | 'generating';
  isStreaming?: boolean;
  additions?: number;
  deletions?: number;
  toolName?: string;
  toolId?: string;
  toolInputRaw?: string;
  listItems?: string[];
  outputs?: string[];
  generated?: unknown;
  permissionRequest?: boolean;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  js: 'JS',
  jsx: 'JSX',
  ts: 'TS',
  tsx: 'TSX',
  py: 'PY',
  md: 'MD',
  json: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
  sh: 'SH',
  css: 'CSS',
  html: 'HTML',
  go: 'GO',
  rs: 'RS',
  java: 'JAVA',
  c: 'C',
  cpp: 'CPP',
  cs: 'CS',
  rb: 'RB',
  php: 'PHP',
  sql: 'SQL',
};

const toObject = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const toArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getFileExtension = (filePath?: string): string => {
  if (!filePath) return '';
  const last = filePath.split('/').pop() || '';
  const dot = last.lastIndexOf('.');
  if (dot < 0) return '';
  return last.slice(dot + 1).toLowerCase();
};

const getLanguageTag = (filePath?: string): string => {
  const ext = getFileExtension(filePath);
  return LANGUAGE_BY_EXT[ext] || (ext ? ext.toUpperCase() : 'TXT');
};

const extractExitCode = (message: ChatMessage): number | null => {
  const topLevel = Number(message.exitCode);
  if (Number.isFinite(topLevel)) return topLevel;
  const resultObject = toObject(message.toolResult);
  if (!resultObject) return null;
  const fields = ['exitCode', 'exit_code', 'code', 'statusCode'];
  for (const field of fields) {
    const value = Number(resultObject[field]);
    if (Number.isFinite(value)) return value;
  }
  return null;
};

const extractResultText = (toolResult: unknown): string => {
  const obj = toObject(toolResult);
  if (!obj) return toText(toolResult);

  const candidate =
    obj.content ??
    obj.output ??
    obj.stdout ??
    obj.text ??
    obj.message ??
    obj.result;

  return toText(candidate);
};

const extractSearchResults = (toolResult: unknown): SearchResultItem[] => {
  const obj = toObject(toolResult);
  if (!obj) return [];

  const list = [obj.results, obj.items, obj.data, obj.content]
    .map((source) => toArray(source))
    .find((source) => source.length > 0) || [];

  if (!Array.isArray(list) || list.length === 0) return [];

  return list
    .map((entry): SearchResultItem | null => {
      const row = toObject(entry);
      if (!row) return null;
      return {
        title: toText(row.title || row.name || row.heading).trim(),
        url: toText(row.url || row.link || row.href).trim() || undefined,
        snippet: toText(row.snippet || row.description || row.summary).trim() || undefined,
      };
    })
    .filter((entry): entry is SearchResultItem => Boolean(entry && entry.title));
};

const extractTreeItems = (toolInput: unknown, toolResult: unknown): TreeItem[] => {
  const fromResult = toArray(toObject(toolResult)?.items);
  const fromFilenames = toArray(toObject(toolResult)?.filenames);
  const inputObj = toObject(toolInput);
  const fromInput = toArray(inputObj?.items);
  const candidate = fromResult.length ? fromResult : fromFilenames.length ? fromFilenames : fromInput;

  if (!candidate.length) {
    const text = extractResultText(toolResult);
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((line) => ({
        name: line.replace(/^[\-*]\s*/, ''),
        type: line.endsWith('/') ? 'folder' : 'file',
      }));
  }

  return candidate
    .map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry, type: entry.endsWith('/') ? 'folder' : 'file' } as TreeItem;
      }
      const row = toObject(entry);
      if (!row) return null;
      const normalizedType = toText(row.type || row.kind).trim().toLowerCase();
      const isFolder = ['dir', 'directory', 'folder'].includes(normalizedType);
      return {
        name: toText(row.name || row.path || row.file || ''),
        type: isFolder ? 'folder' : 'file',
        size: toText(row.size || '').trim() || undefined,
      } as TreeItem;
    })
    .filter((item): item is TreeItem => Boolean(item?.name));
};

const extractSummaryItems = (content: string): string[] => {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, ''))
    .filter(Boolean);
};

export function parseChatMessageForUi(message: ChatMessage): ParsedUiMessage {
  const content = toText(message.content || '');
  const toolName = String(message.toolName || 'UnknownTool');

  if (message.isThinking) {
    return {
      kind: 'thinking',
      collapsible: true,
      defaultOpen: false,
      title: 'Thinking',
      isStreaming: Boolean(message.isStreaming),
      content,
    };
  }

  if (message.type === 'error' || message.toolResult?.isError) {
    return {
      kind: 'error-warning',
      collapsible: false,
      defaultOpen: true,
      title: 'Error',
      content: content || extractResultText(message.toolResult),
      details: message.toolResult?.isError ? extractResultText(message.toolResult) : undefined,
      status: 'error',
      toolName,
      toolId: toText(message.toolId || message.toolCallId).trim() || undefined,
      toolInputRaw: toText(message.toolInput),
      permissionRequest: Boolean(message.toolResult?.isError && message.toolName),
    };
  }

  if (!message.isToolUse) {
    const summaryItems = extractSummaryItems(content);
    const firstLine = (content.split('\n')[0] || '').trim();
    const explicitSummary = Boolean((message as any).isSummary);
    const summaryHeading = /^summary\s*[:\-]\s*/i.test(firstLine);
    const completionHeading = /\b(refactoring\s+)?complete(?:d)?[.!]?$/i.test(firstLine);
    const looksLikeSummary =
      explicitSummary ||
      summaryItems.length > 1 ||
      summaryHeading ||
      completionHeading;

    if (looksLikeSummary && content.length < 2500) {
      const title = (firstLine || 'Summary').replace(/^[-*•]\s+/, '').trim();
      return {
        kind: 'summary-completion',
        collapsible: false,
        defaultOpen: true,
        title,
        listItems: summaryItems.length > 0 ? summaryItems : content.split('\n').slice(1).filter(Boolean),
      };
    }

    return {
      kind: 'streaming-prose',
      collapsible: false,
      defaultOpen: true,
      isStreaming: Boolean(message.isStreaming),
      content,
    };
  }

  const toolNameLower = toolName.toLowerCase();
  const toolInputObj = toObject(message.toolInput);
  const toolResultText = extractResultText(message.toolResult);

  if (toolNameLower === 'bash' || toolNameLower.includes('command')) {
    const command = toText(
      toolInputObj?.command ??
      toolInputObj?.cmd ??
      toolInputObj?.script ??
      message.toolInput,
    ).trim();
    const exitCode = extractExitCode(message);
    const isRunning = !message.toolResult;
    return {
      kind: 'bash',
      collapsible: true,
      defaultOpen: true,
      title: 'Command',
      command,
      output: toolResultText,
      exitCode,
      status: isRunning ? 'running' : exitCode && exitCode > 0 ? 'error' : 'done',
      toolName,
    };
  }

  if (toolNameLower === 'read') {
    const path = toText(toolInputObj?.file_path ?? toolInputObj?.path).trim();
    const fileBody = toolResultText || content;
    return {
      kind: 'file-read',
      collapsible: true,
      defaultOpen: false,
      path,
      filename: path.split('/').pop() || path,
      language: getLanguageTag(path),
      lineCount: fileBody ? fileBody.split('\n').length : 0,
      content: fileBody,
      toolName,
    };
  }

  if (toolNameLower === 'edit') {
    const path = toText(toolInputObj?.file_path ?? toolInputObj?.path).trim();
    const oldContent = toText(toolInputObj?.old_string || '');
    const newContent = toText(toolInputObj?.new_string || '');
    return {
      kind: 'code-diff',
      collapsible: true,
      defaultOpen: true,
      path,
      filename: path.split('/').pop() || path,
      content: JSON.stringify({ oldContent, newContent }),
      toolName,
    };
  }

  if (toolNameLower === 'write' || toolNameLower.includes('create_file') || toolNameLower.includes('createfile')) {
    const path = toText(toolInputObj?.file_path ?? toolInputObj?.path).trim();
    const fileContent = toText(toolInputObj?.content || '');
    const status = fileContent ? 'created' : 'saved';
    return {
      kind: 'file-write',
      collapsible: false,
      defaultOpen: true,
      path,
      filename: path.split('/').pop() || path,
      status,
      toolName,
    };
  }

  const isImageTool = toolNameLower.includes('image') || toolNameLower.includes('dall') || toolNameLower.includes('vision');
  if (isImageTool) {
    const status = message.toolResult ? 'done' : 'generating';
    const resultObj = toObject(message.toolResult);
    const candidateOutputs = [
      resultObj?.outputs,
      resultObj?.images,
      resultObj?.generated,
      resultObj?.result,
      resultObj?.output,
      resultObj?.content,
      resultObj?.data,
    ];
    const outputs = candidateOutputs
      .flatMap((candidate) => {
        if (Array.isArray(candidate)) return candidate.map((item) => toText(item).trim()).filter(Boolean);
        const single = toText(candidate).trim();
        return single ? [single] : [];
      });
    return {
      kind: 'image-generation',
      collapsible: true,
      defaultOpen: false,
      title: 'Image Generation',
      status,
      content: toolResultText,
      output: outputs[0] || undefined,
      outputs: outputs.length ? outputs : undefined,
      generated: resultObj?.generated ?? resultObj?.output ?? resultObj?.outputs,
      toolName,
      toolId: toText(message.toolId || message.toolCallId).trim() || undefined,
    };
  }

  const isSearchTool =
    toolNameLower.includes('search') ||
    toolNameLower.includes('web_fetch') ||
    toolNameLower.includes('websearch') ||
    toolNameLower.includes('web-search');
  if (isSearchTool) {
    const results = extractSearchResults(message.toolResult);
    const query = toText(toolInputObj?.query || toolInputObj?.q || toolInputObj?.search_query || message.toolInput).trim();
    return {
      kind: 'web-search',
      collapsible: true,
      defaultOpen: false,
      query,
      resultCount: results.length,
      searchResults: results,
      status: message.toolResult ? 'done' : 'running',
      toolName,
    };
  }

  const isTreeTool =
    toolNameLower === 'ls' ||
    toolNameLower.includes('listdir') ||
    toolNameLower.includes('readdir') ||
    toolNameLower.includes('directory') ||
    toolNameLower === 'glob';
  if (isTreeTool) {
    const path = toText(toolInputObj?.path || toolInputObj?.directory || toolInputObj?.cwd || '').trim();
    const treeItems = extractTreeItems(message.toolInput, message.toolResult);
    return {
      kind: 'file-tree',
      collapsible: true,
      defaultOpen: false,
      path,
      treeItems,
      toolName,
    };
  }

  // Fallback for any remaining tool-use message that does not match a known tool kind.
  return {
    kind: 'tool-invocation',
    collapsible: true,
    defaultOpen: false,
    toolName,
    toolId: toText(message.toolId || message.toolCallId).trim() || undefined,
    status: message.toolResult ? 'done' : 'running',
    toolInputRaw: toText(message.toolInput),
    content: toolResultText,
  };
}
