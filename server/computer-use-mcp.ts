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

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readMouseButton = (value: unknown): 'left' | 'right' | 'middle' =>
  value === 'right' || value === 'middle' ? value : 'left';

const apiUrl = (process.env.CLOUDCLI_COMPUTER_USE_API_URL || 'http://127.0.0.1:3001/api/computer-use-mcp').replace(/\/$/, '');
const apiToken = process.env.CLOUDCLI_COMPUTER_USE_MCP_TOKEN || '';

const computerUseInstructions = `
CloudCLI Computer Use lets you operate the user's real desktop through guarded sessions. Use it deliberately: observe first, act second, then verify.

Recommended app workflow:
1. If you do not know the target app name, call computer_list_apps.
2. Call computer_get_app_state for the target app before app-scoped actions. It returns a screenshot, accessibility elements, and a stateId.
3. Prefer semantic element actions using stateId + element_index from the latest computer_get_app_state result. Do not guess element indexes or reuse them after large UI changes without refreshing state.
4. Use x/y coordinates from the returned screenshot only when no suitable element_index is available.
5. After every action, inspect the returned screenshot/state before deciding the next action.

Use app-scoped tools when the target app is known: computer_list_apps, computer_get_app_state, computer_click_element, computer_perform_secondary_action, computer_set_value, computer_type_text, computer_press_key, computer_scroll_element, and computer_app_drag.

Use raw desktop tools only when you need full-screen coordinate control, cursor position, or current-focus input: computer_screenshot, computer_cursor_position, computer_mouse_move, computer_click, computer_drag, computer_type, computer_key, computer_scroll, computer_wait, and computer_close_session. Raw coordinates are screenshot pixels, so call computer_screenshot first when you need a coordinate frame.

Most tools can use or create the active agent session automatically when sessionId is omitted. In local mode, input actions require the user to grant control in the Computer tab before they work. In cloud mode, approval is handled by the linked CloudCLI desktop app.

If a tool reports missing permission, denied control, or no available desktop session, stop retrying and ask the user to fix access. For local mode, ask them to open CloudCLI Desktop, go to the Computer tab, enable Computer Use, grant the requested OS permissions, and allow the session. On macOS this usually means Accessibility and Screen Recording. For cloud mode, ask them to keep the linked CloudCLI Desktop app running and approve the cloud agent's Computer Use request there.

Ask before sending, deleting, purchasing, approving, uploading, publishing, changing account settings, or making other externally visible or destructive changes. Do not inspect unrelated private content unless the user explicitly asked for that task.
`.trim();

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
    sessionId: { type: 'string', description: 'Optional. Omit to use or create the active agent session automatically.' },
  },
};

const optionalSessionProperty = sessionIdSchema.properties.sessionId;

const withOptionalSession = (properties: Record<string, unknown> = {}) => ({
  sessionId: optionalSessionProperty,
  ...properties,
});

const optionalSessionInput = (args: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  sessionId: readOptionalString(args.sessionId),
  ...extra,
});

const stateIdProperty = {
  type: 'string',
  description: 'State id returned by the latest computer_get_app_state call for this app. Send it with element_index so the runtime can resolve the cached element.',
};

const elementIndexProperty = {
  type: 'string',
  description: 'Element index from the latest computer_get_app_state result for this app. Use with stateId when possible.',
};

const tools: ToolDefinition[] = [
  {
    name: 'computer_list_apps',
    description: 'Discover app names, bundle identifiers, process names, and window titles that can be used as the app target for app-scoped Computer Use tools. Call this first when you are unsure which app string to pass to computer_get_app_state.',
    inputSchema: { type: 'object', properties: withOptionalSession() },
  },
  {
    name: 'computer_get_app_state',
    description: 'Inspect a target app and return its current screenshot, accessibility elements, and stateId. Call this before element-targeted actions, after navigation, and whenever the UI may have changed enough that old element indexes could be stale.',
    inputSchema: {
      type: 'object',
      properties: withOptionalSession({
        app: { type: 'string', description: 'App name, process name, bundle identifier, or window title from computer_list_apps or the user request.' },
      }),
      required: ['app'],
    },
  },
  {
    name: 'computer_click_element',
    description: 'Click a target inside an app. Prefer stateId + element_index from computer_get_app_state; use x/y screenshot coordinates only when the target is not represented in the accessibility elements.',
    inputSchema: {
      type: 'object',
      properties: withOptionalSession({
        app: { type: 'string', description: 'Target app name, process name, bundle identifier, or window title.' },
        stateId: stateIdProperty,
        element_index: elementIndexProperty,
        x: { type: 'number', description: 'X coordinate in screenshot pixel coordinates from computer_get_app_state.' },
        y: { type: 'number', description: 'Y coordinate in screenshot pixel coordinates from computer_get_app_state.' },
        click_count: { type: 'integer', description: 'Number of clicks, usually 1. Defaults to 1 and is capped by the runtime.' },
        mouse_button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Button for the click; omitted means left.' },
      }),
      required: ['app'],
    },
  },
  {
    name: 'computer_perform_secondary_action',
    description: 'Open the secondary action for a target inside an app, typically a context menu. Prefer stateId + element_index; if native secondary actions are unavailable, the runtime falls back to a right-click at the resolved point.',
    inputSchema: {
      type: 'object',
      properties: withOptionalSession({
        app: { type: 'string', description: 'Target app name, process name, bundle identifier, or window title.' },
        stateId: stateIdProperty,
        element_index: elementIndexProperty,
        x: { type: 'number', description: 'X coordinate in screenshot pixel coordinates from computer_get_app_state.' },
        y: { type: 'number', description: 'Y coordinate in screenshot pixel coordinates from computer_get_app_state.' },
      }),
      required: ['app'],
    },
  },
  {
    name: 'computer_set_value',
    description: 'Set the value of a specific editable element in an app. Prefer stateId + element_index for a settable accessibility element; coordinate fallback focuses the resolved point and replaces the current value, so do not call this unless the target is resolved.',
    inputSchema: {
      type: 'object',
      properties: withOptionalSession({
        app: { type: 'string', description: 'Target app name, process name, bundle identifier, or window title.' },
        stateId: stateIdProperty,
        element_index: elementIndexProperty,
        x: { type: 'number', description: 'X coordinate in screenshot pixel coordinates from computer_get_app_state.' },
        y: { type: 'number', description: 'Y coordinate in screenshot pixel coordinates from computer_get_app_state.' },
        value: { type: 'string', description: 'Exact value to put into the target element.' },
      }),
      required: ['app', 'value'],
    },
  },
  {
    name: 'computer_type_text',
    description: 'Type literal text into the target app using keyboard input. Use after you have focused the intended field with computer_click_element or verified the correct focus in computer_get_app_state.',
    inputSchema: {
      type: 'object',
      properties: withOptionalSession({
        app: { type: 'string', description: 'Target app name, process name, bundle identifier, or window title.' },
        text: { type: 'string', description: 'Text to enter exactly as provided.' },
      }),
      required: ['app', 'text'],
    },
  },
  {
    name: 'computer_press_key',
    description: 'Press a key or key combination in the target app. Use for navigation, shortcuts, and confirmation keys after verifying the intended app/focus.',
    inputSchema: {
      type: 'object',
      properties: withOptionalSession({
        app: { type: 'string', description: 'Target app name, process name, bundle identifier, or window title.' },
        key: { type: 'string', description: 'Key or chord, using names such as Return, Escape, Tab, ctrl+s, cmd+a, Up, or Page_Down.' },
      }),
      required: ['app', 'key'],
    },
  },
  {
    name: 'computer_scroll_element',
    description: 'Scroll a target area inside an app. Prefer stateId + element_index for scrollable elements; use x/y screenshot coordinates only when the scroll target is visible but not represented as an element.',
    inputSchema: {
      type: 'object',
      properties: withOptionalSession({
        app: { type: 'string', description: 'Target app name, process name, bundle identifier, or window title.' },
        stateId: stateIdProperty,
        element_index: elementIndexProperty,
        x: { type: 'number', description: 'X coordinate in screenshot pixel coordinates from computer_get_app_state.' },
        y: { type: 'number', description: 'Y coordinate in screenshot pixel coordinates from computer_get_app_state.' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Direction to scroll the target.' },
        pages: { type: 'number', description: 'How far to scroll, measured in page units. Fractional values are allowed; default is 1.' },
      }),
      required: ['app', 'direction'],
    },
  },
  {
    name: 'computer_app_drag',
    description: 'Drag inside a target app from one screenshot coordinate to another. Use for sliders, selections, map/canvas gestures, or drag-and-drop when no semantic element action is available.',
    inputSchema: {
      type: 'object',
      properties: withOptionalSession({
        app: { type: 'string', description: 'Target app name, process name, bundle identifier, or window title.' },
        from_x: { type: 'number', description: 'Start X coordinate in screenshot pixels.' },
        from_y: { type: 'number', description: 'Start Y coordinate in screenshot pixels.' },
        to_x: { type: 'number', description: 'End X coordinate in screenshot pixels.' },
        to_y: { type: 'number', description: 'End Y coordinate in screenshot pixels.' },
      }),
      required: ['app', 'from_x', 'from_y', 'to_x', 'to_y'],
    },
  },
  {
    name: 'computer_screenshot',
    description: 'Capture the full desktop screenshot and current display size. Use this before raw coordinate actions when an app-specific accessibility state is unavailable or the task spans multiple apps.',
    inputSchema: sessionIdSchema,
  },
  {
    name: 'computer_cursor_position',
    description: 'Get the current mouse cursor position in desktop screenshot pixel coordinates. Useful after a raw action misses or when coordinating pointer-relative steps.',
    inputSchema: sessionIdSchema,
  },
  {
    name: 'computer_mouse_move',
    description: 'Move the mouse cursor to an exact full-desktop screenshot coordinate. Call computer_screenshot first if you do not already have a current coordinate frame.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: optionalSessionProperty,
        x: { type: 'number', description: 'X coordinate in full-desktop screenshot pixels.' },
        y: { type: 'number', description: 'Y coordinate in full-desktop screenshot pixels.' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'computer_click',
    description: 'Raw desktop click at the current cursor or at optional full-desktop screenshot coordinates. Prefer computer_click_element when the target app and element are known.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: optionalSessionProperty,
        x: { type: 'number', description: 'Optional X coordinate in full-desktop screenshot pixels.' },
        y: { type: 'number', description: 'Optional Y coordinate in full-desktop screenshot pixels.' },
        mouseButton: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Button for the click; omitted means left.' },
        clickCount: { type: 'integer', description: 'How many times to click; omitted means 1.' },
      },
    },
  },
  {
    name: 'computer_drag',
    description: 'Raw desktop drag from start coordinates to end coordinates in full-desktop screenshot pixels. Prefer computer_app_drag for app-scoped drags when the target app is known.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: optionalSessionProperty,
        startX: { type: 'number', description: 'Start X coordinate in full-desktop screenshot pixels.' },
        startY: { type: 'number', description: 'Start Y coordinate in full-desktop screenshot pixels.' },
        endX: { type: 'number', description: 'End X coordinate in full-desktop screenshot pixels.' },
        endY: { type: 'number', description: 'End Y coordinate in full-desktop screenshot pixels.' },
        mouseButton: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Button to hold during the drag; omitted means left.' },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'computer_type',
    description: 'Type literal text at the current desktop focus. This is not app-scoped; use only after verifying the intended field is focused.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: optionalSessionProperty, text: { type: 'string', description: 'Text to enter exactly as provided at current focus.' } },
      required: ['text'],
    },
  },
  {
    name: 'computer_key',
    description: 'Press a key or key chord at the current desktop focus. This is not app-scoped; use computer_press_key when the target app is known.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: optionalSessionProperty, key: { type: 'string', description: 'Key or chord, using names such as Return, Escape, Tab, ctrl+s, cmd+a, Up, or Page_Down.' } },
      required: ['key'],
    },
  },
  {
    name: 'computer_scroll',
    description: 'Raw desktop scroll at the current cursor or optional full-desktop screenshot coordinates. Prefer computer_scroll_element when the target app/element is known.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: optionalSessionProperty,
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Direction to scroll the desktop target.' },
        amount: { type: 'number', description: 'Scroll amount in wheel/page-like units. Defaults are runtime-defined.' },
        x: { type: 'number', description: 'Optional X coordinate in full-desktop screenshot pixels.' },
        y: { type: 'number', description: 'Optional Y coordinate in full-desktop screenshot pixels.' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'computer_wait',
    description: 'Wait briefly, up to 10000 ms, then return an updated desktop screenshot. Use after actions that trigger loading, animation, or delayed UI changes.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: optionalSessionProperty, timeoutMs: { type: 'number', description: 'Milliseconds to wait. The runtime caps long waits.' } },
    },
  },
  {
    name: 'computer_close_session',
    description: 'Stop the active auto-created Computer Use session, or the specified session, and revoke agent input control for that session.',
    inputSchema: sessionIdSchema,
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'computer_app_drag':
    case 'computer_click_element':
    case 'computer_get_app_state':
    case 'computer_list_apps':
    case 'computer_perform_secondary_action':
    case 'computer_press_key':
    case 'computer_scroll_element':
    case 'computer_set_value':
    case 'computer_type_text':
      return toolResult(await callComputerUseApi(name, args));
    case 'computer_screenshot':
    case 'computer_cursor_position':
    case 'computer_close_session':
      return toolResult(await callComputerUseApi(name, optionalSessionInput(args)));
    case 'computer_mouse_move':
      return toolResult(await callComputerUseApi(name, optionalSessionInput(args, {
        x: readNumber(args.x),
        y: readNumber(args.y),
      })));
    case 'computer_click':
      return toolResult(await callComputerUseApi(name, optionalSessionInput(args, {
        x: readNumber(args.x),
        y: readNumber(args.y),
        mouseButton: readMouseButton(args.mouseButton ?? args.mouse_button ?? args.button),
        clickCount: readNumber(args.clickCount ?? args.click_count),
      })));
    case 'computer_drag':
      return toolResult(await callComputerUseApi(name, optionalSessionInput(args, {
        startX: readNumber(args.startX),
        startY: readNumber(args.startY),
        endX: readNumber(args.endX),
        endY: readNumber(args.endY),
        mouseButton: readMouseButton(args.mouseButton ?? args.mouse_button ?? args.button),
      })));
    case 'computer_type':
      return toolResult(await callComputerUseApi(name, optionalSessionInput(args, {
        text: readString(args.text, 'text'),
      })));
    case 'computer_key':
      return toolResult(await callComputerUseApi(name, optionalSessionInput(args, {
        key: readString(args.key, 'key'),
      })));
    case 'computer_scroll':
      return toolResult(await callComputerUseApi(name, optionalSessionInput(args, {
        direction: typeof args.direction === 'string' ? args.direction : 'up',
        amount: readNumber(args.amount),
        x: readNumber(args.x),
        y: readNumber(args.y),
      })));
    case 'computer_wait':
      return toolResult(await callComputerUseApi(name, optionalSessionInput(args, {
        timeoutMs: readNumber(args.timeoutMs),
      })));
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
      instructions: computerUseInstructions,
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
      let request: JsonRpcRequest | null = null;
      try {
        request = JSON.parse(rawMessage) as JsonRpcRequest;
        const result = await handleMessage(request);
        sendResult(request.id, result);
      } catch (error) {
        sendError(request?.id ?? null, error);
      }
    })();
  }
});
