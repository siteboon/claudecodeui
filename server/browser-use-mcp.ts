#!/usr/bin/env node
import './load-env.js';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const textResponse = (text: string) => ({
  content: [{ type: 'text', text }],
});

const jsonResponse = (value: unknown) => textResponse(JSON.stringify(value, null, 2));

const readString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
};

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const apiUrl = (process.env.CLOUDCLI_BROWSER_USE_API_URL || 'http://127.0.0.1:3001/api/browser-use-mcp').replace(/\/$/, '');
const apiToken = process.env.CLOUDCLI_BROWSER_USE_MCP_TOKEN || '';
const API_TIMEOUT_MS = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_API_TIMEOUT_MS || '60000', 10);

async function callBrowserUseApi(toolName: string, input: Record<string, unknown>) {
  if (!apiToken) {
    throw new Error('CLOUDCLI_BROWSER_USE_MCP_TOKEN is not configured.');
  }

  const response = await fetch(`${apiUrl}/tools/${encodeURIComponent(toolName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const data = await response.json() as { success?: boolean; data?: unknown; error?: string };
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Browser Use API request failed (${response.status})`);
  }
  return data.data;
}

const sessionIdSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'Browser Use session id.' },
  },
  required: ['sessionId'],
};

const tools: ToolDefinition[] = [
  {
    name: 'browser_create_session',
    description: 'Create a temporary Browser Use session that the agent can control. Optionally provide a background profileName to reuse cookies and storage.',
    inputSchema: {
      type: 'object',
      properties: {
        profileName: { type: 'string', description: 'Optional background profile name for persistent browser storage.' },
      },
    },
  },
  {
    name: 'browser_list_sessions',
    description: 'List Browser Use sessions currently available to agents.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_snapshot',
    description: 'Capture current page metadata, screenshot data URL, and visible body text for a Browser Use session.',
    inputSchema: sessionIdSchema,
  },
  {
    name: 'browser_take_screenshot',
    description: 'Capture the latest screenshot for a Browser Use session.',
    inputSchema: sessionIdSchema,
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a Browser Use session to an HTTP or HTTPS URL.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['sessionId', 'url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element by CSS selector, visible text, or x/y coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into the focused page or fill a CSS selector. Set submit to press Enter after typing.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
      },
      required: ['sessionId', 'text'],
    },
  },
  {
    name: 'browser_fill_form',
    description: 'Fill multiple form fields using CSS selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['selector', 'value'],
          },
        },
      },
      required: ['sessionId', 'fields'],
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key, for example Enter, Escape, Tab, or Control+A.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['sessionId', 'key'],
    },
  },
  {
    name: 'browser_select_option',
    description: 'Select option values in a select element found by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        selector: { type: 'string' },
        values: { type: 'array', items: { type: 'string' } },
      },
      required: ['sessionId', 'selector', 'values'],
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait for visible text, a URL pattern, or a short timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        text: { type: 'string' },
        url: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'browser_tabs',
    description: 'List, open, select, or close tabs in a Browser Use session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        action: { type: 'string', enum: ['list', 'new', 'select', 'close'] },
        index: { type: 'number' },
        url: { type: 'string' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'browser_close_session',
    description: 'Stop a Browser Use session controlled by agents.',
    inputSchema: sessionIdSchema,
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'browser_create_session':
      return jsonResponse(await callBrowserUseApi(name, {
        profileName: readOptionalString(args.profileName),
      }));
    case 'browser_list_sessions':
      return jsonResponse(await callBrowserUseApi(name, {}));
    case 'browser_snapshot':
      return jsonResponse(await callBrowserUseApi(name, { sessionId: readString(args.sessionId, 'sessionId') }));
    case 'browser_take_screenshot': {
      return jsonResponse(await callBrowserUseApi(name, { sessionId: readString(args.sessionId, 'sessionId') }));
    }
    case 'browser_navigate':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        url: readString(args.url, 'url'),
      }));
    case 'browser_click':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        selector: readOptionalString(args.selector),
        text: readOptionalString(args.text),
        x: readNumber(args.x),
        y: readNumber(args.y),
      }));
    case 'browser_type':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        selector: readOptionalString(args.selector),
        text: readString(args.text, 'text'),
        submit: args.submit === true,
      }));
    case 'browser_fill_form': {
      const fields = Array.isArray(args.fields)
        ? args.fields.map((field) => {
          const record = field as Record<string, unknown>;
          return {
            selector: readString(record.selector, 'field.selector'),
            value: readString(record.value, 'field.value'),
          };
        })
        : [];
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        fields,
      }));
    }
    case 'browser_press_key':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        key: readString(args.key, 'key'),
      }));
    case 'browser_select_option':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        selector: readString(args.selector, 'selector'),
        values: Array.isArray(args.values) ? args.values.filter((value): value is string => typeof value === 'string') : [],
      }));
    case 'browser_wait_for':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        text: readOptionalString(args.text),
        url: readOptionalString(args.url),
        timeoutMs: readNumber(args.timeoutMs),
      }));
    case 'browser_tabs':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        action: args.action === 'new' || args.action === 'select' || args.action === 'close' || args.action === 'list'
          ? args.action
          : undefined,
        index: readNumber(args.index),
        url: readOptionalString(args.url),
      }));
    case 'browser_close_session':
      return jsonResponse(await callBrowserUseApi(name, { sessionId: readString(args.sessionId, 'sessionId') }));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message: JsonRpcRequest) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'cloudcli-browser-use', version: '1.0.0' },
    };
  }

  if (message.method === 'tools/list') {
    return { tools };
  }

  if (message.method === 'tools/call') {
    const params = message.params || {};
    const name = readString(params.name, 'name');
    const args = (params.arguments && typeof params.arguments === 'object'
      ? params.arguments
      : {}) as Record<string, unknown>;
    return callTool(name, args);
  }

  if (message.method.startsWith('notifications/')) {
    return undefined;
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

function writeMessage(message: Record<string, unknown>) {
  const payload = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
}

function sendResult(id: string | number | null | undefined, result: unknown) {
  if (id === undefined) {
    return;
  }
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id: string | number | null | undefined, error: unknown) {
  if (id === undefined) {
    return;
  }
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return;
    }

    const header = buffer.slice(0, headerEnd).toString('utf8');
    const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
    if (!lengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const length = Number.parseInt(lengthMatch[1], 10);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) {
      return;
    }

    const rawMessage = buffer.slice(messageStart, messageEnd).toString('utf8');
    buffer = buffer.slice(messageEnd);

    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(rawMessage) as JsonRpcRequest;
      } catch (error) {
        sendError(null, error);
        return;
      }
      try {
        const result = await handleMessage(request);
        sendResult(request.id, result);
      } catch (error) {
        sendError(request.id, error);
      }
    })();
  }
});
