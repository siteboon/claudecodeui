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

const readString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
};

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const apiUrl = (process.env.CLOUDCLI_COMPUTER_USE_API_URL || 'http://127.0.0.1:3001/api/computer-use-mcp').replace(/\/$/, '');
const apiToken = process.env.CLOUDCLI_COMPUTER_USE_MCP_TOKEN || '';

async function callComputerUseApi(toolName: string, input: Record<string, unknown>) {
  if (!apiToken) {
    throw new Error('CLOUDCLI_COMPUTER_USE_MCP_TOKEN is not configured.');
  }

  const response = await fetch(`${apiUrl}/tools/${encodeURIComponent(toolName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = await response.json() as { success?: boolean; data?: unknown; error?: string };
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Computer Use API request failed (${response.status})`);
  }
  return data.data;
}

/** Pulls the most recent screenshot data URL out of an API result, if present. */
function findScreenshot(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.screenshotDataUrl === 'string') {
    return record.screenshotDataUrl;
  }
  if (record.session && typeof record.session === 'object') {
    const session = record.session as Record<string, unknown>;
    if (typeof session.screenshotDataUrl === 'string') {
      return session.screenshotDataUrl;
    }
  }
  return null;
}

/** Removes the large data URL from JSON so the text block stays small. */
function stripScreenshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripScreenshot);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'screenshotDataUrl' && typeof val === 'string') {
        out.screenshot = '[returned as image]';
        continue;
      }
      out[key] = stripScreenshot(val);
    }
    return out;
  }
  return value;
}

/**
 * Builds an MCP tool result. Screenshots are returned as an `image` content block so
 * vision-capable models actually see the desktop — a JSON data-URL string would not work.
 */
function toolResult(value: unknown) {
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: JSON.stringify(stripScreenshot(value), null, 2) },
  ];

  const screenshot = findScreenshot(value);
  const match = screenshot ? /^data:(image\/[a-z]+);base64,(.+)$/i.exec(screenshot) : null;
  if (match) {
    content.push({ type: 'image', data: match[2], mimeType: match[1] });
  }

  return { content };
}

const sessionIdSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'Computer Use session id.' },
  },
  required: ['sessionId'],
};

const pointSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    x: { type: 'number', description: 'X coordinate in screenshot pixel space.' },
    y: { type: 'number', description: 'Y coordinate in screenshot pixel space.' },
  },
  required: ['sessionId'],
};

const tools: ToolDefinition[] = [
  {
    name: 'computer_create_session',
    description: 'Create a Computer Use session that controls the user desktop. The session starts WITHOUT control: the user must grant control in the Computer panel before any action will work. Returns a screenshot once available.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'computer_list_sessions',
    description: 'List Computer Use sessions and whether the user has granted control.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'computer_screenshot',
    description: 'Capture the current desktop screenshot. Returns the image plus the display size to use for coordinates.',
    inputSchema: sessionIdSchema,
  },
  {
    name: 'computer_cursor_position',
    description: 'Get the current mouse cursor position in screenshot pixel space.',
    inputSchema: sessionIdSchema,
  },
  {
    name: 'computer_mouse_move',
    description: 'Move the mouse cursor to x/y (screenshot pixel space).',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } },
      required: ['sessionId', 'x', 'y'],
    },
  },
  {
    name: 'computer_left_click',
    description: 'Left-click. Optionally provide x/y to move there first.',
    inputSchema: pointSchema,
  },
  {
    name: 'computer_right_click',
    description: 'Right-click. Optionally provide x/y to move there first.',
    inputSchema: pointSchema,
  },
  {
    name: 'computer_middle_click',
    description: 'Middle-click. Optionally provide x/y to move there first.',
    inputSchema: pointSchema,
  },
  {
    name: 'computer_double_click',
    description: 'Double-click. Optionally provide x/y to move there first.',
    inputSchema: pointSchema,
  },
  {
    name: 'computer_left_click_drag',
    description: 'Press the left button at start coordinates and release at end coordinates (drag).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        startX: { type: 'number' }, startY: { type: 'number' },
        endX: { type: 'number' }, endY: { type: 'number' },
      },
      required: ['sessionId', 'startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'computer_type',
    description: 'Type a string of text at the current focus.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, text: { type: 'string' } },
      required: ['sessionId', 'text'],
    },
  },
  {
    name: 'computer_key',
    description: 'Press a key or key chord using xdotool-style names, e.g. "Return", "Escape", "ctrl+a", "Page_Down".',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, key: { type: 'string' } },
      required: ['sessionId', 'key'],
    },
  },
  {
    name: 'computer_scroll',
    description: 'Scroll the mouse wheel. direction is up/down/left/right; amount is the number of steps. Optionally provide x/y to move there first.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['sessionId', 'direction'],
    },
  },
  {
    name: 'computer_wait',
    description: 'Wait for a short period (milliseconds, max 10000) then return a fresh screenshot.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, timeoutMs: { type: 'number' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'computer_close_session',
    description: 'Stop a Computer Use session and revoke control.',
    inputSchema: sessionIdSchema,
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'computer_create_session':
      return toolResult(await callComputerUseApi(name, {}));
    case 'computer_list_sessions':
      return toolResult(await callComputerUseApi(name, {}));
    case 'computer_screenshot':
    case 'computer_cursor_position':
    case 'computer_close_session':
      return toolResult(await callComputerUseApi(name, { sessionId: readString(args.sessionId, 'sessionId') }));
    case 'computer_mouse_move':
      return toolResult(await callComputerUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        x: readNumber(args.x),
        y: readNumber(args.y),
      }));
    case 'computer_left_click':
    case 'computer_right_click':
    case 'computer_middle_click':
    case 'computer_double_click':
      return toolResult(await callComputerUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        x: readNumber(args.x),
        y: readNumber(args.y),
      }));
    case 'computer_left_click_drag':
      return toolResult(await callComputerUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        startX: readNumber(args.startX),
        startY: readNumber(args.startY),
        endX: readNumber(args.endX),
        endY: readNumber(args.endY),
      }));
    case 'computer_type':
      return toolResult(await callComputerUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        text: readString(args.text, 'text'),
      }));
    case 'computer_key':
      return toolResult(await callComputerUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        key: readString(args.key, 'key'),
      }));
    case 'computer_scroll':
      return toolResult(await callComputerUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        direction: typeof args.direction === 'string' ? args.direction : 'up',
        amount: readNumber(args.amount),
        x: readNumber(args.x),
        y: readNumber(args.y),
      }));
    case 'computer_wait':
      return toolResult(await callComputerUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        timeoutMs: readNumber(args.timeoutMs),
      }));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message: JsonRpcRequest) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'cloudcli-computer-use', version: '1.0.0' },
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
      const request = JSON.parse(rawMessage) as JsonRpcRequest;
      try {
        const result = await handleMessage(request);
        sendResult(request.id, result);
      } catch (error) {
        sendError(request.id, error);
      }
    })();
  }
});
