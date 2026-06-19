import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  captureScreenshot,
  executor,
  type ClickButton,
  type ExecutorTarget,
  type Point,
  type ScrollDirection,
} from '@/modules/computer-use/computer-executor.js';
import type { SemanticAdapter } from '@/modules/computer-use/semantics/adapters/semantic-adapter.js';
import { createMacOsSemanticAdapter } from '@/modules/computer-use/semantics/adapters/macos/macos-semantic-adapter.js';
import { createWindowsSemanticAdapter } from '@/modules/computer-use/semantics/adapters/windows/windows-semantic-adapter.js';
import { resolveSemanticHelper } from '@/modules/computer-use/semantics/helpers/semantic-helper-resolver.js';
import { semanticSessionStore } from '@/modules/computer-use/semantics/semantic-session-store.js';
import type { SemanticAppState, SemanticElement } from '@/modules/computer-use/semantics/semantic-types.js';

const execFileAsync = promisify(execFile);
const MAX_APP_STATE_ELEMENTS = 250;
let helperAdapter: SemanticAdapter | null | undefined;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readButton(value: unknown): ClickButton {
  return value === 'right' || value === 'middle' ? value : 'left';
}

function readClickCount(value: unknown): number {
  const count = readNumber(value);
  if (count === undefined) {
    return 1;
  }
  return Math.max(1, Math.min(5, Math.trunc(count)));
}

function readDirection(value: unknown): ScrollDirection {
  return value === 'up' || value === 'left' || value === 'right' ? value : 'down';
}

function readSessionId(input: Record<string, unknown>): string {
  return readString(input.sessionId) || 'default';
}

function centerOf(element: SemanticElement): Point | null {
  const bounds = element.bounds;
  if (!bounds) {
    return null;
  }
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
}

function getCachedElement(sessionId: string, app: string, index: string, stateId?: string): SemanticElement | null {
  return semanticSessionStore.getElement(sessionId, app, index, stateId);
}

function getPoint(input: Record<string, unknown>, sessionId: string, app: string): Point | undefined {
  const x = readNumber(input.x);
  const y = readNumber(input.y);
  if (x !== undefined && y !== undefined) {
    return { x, y };
  }

  const elementIndex = readString(input.element_index);
  if (!elementIndex) {
    return undefined;
  }
  const element = getCachedElement(sessionId, app, elementIndex, readString(input.stateId) || undefined);
  return element ? centerOf(element) || undefined : undefined;
}

function getHelperAdapter(): SemanticAdapter | null {
  if (helperAdapter !== undefined) {
    return helperAdapter;
  }

  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    helperAdapter = null;
    return helperAdapter;
  }

  const resolution = resolveSemanticHelper();
  if (!resolution.available) {
    helperAdapter = null;
    return helperAdapter;
  }

  helperAdapter = process.platform === 'darwin'
    ? createMacOsSemanticAdapter()
    : createWindowsSemanticAdapter();
  return helperAdapter;
}

function shouldFallbackFromHelper(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not implemented|unavailable|not found|does not exist/i.test(message);
}

async function withHelperState(
  sessionId: string,
  operation: (adapter: SemanticAdapter) => Promise<SemanticAppState>,
): Promise<SemanticAppState | null> {
  const adapter = getHelperAdapter();
  if (!adapter) {
    return null;
  }
  try {
    return semanticSessionStore.save(sessionId, await operation(adapter));
  } catch (error) {
    if (shouldFallbackFromHelper(error)) {
      console.warn('[ComputerSemantics] Falling back from helper:', error instanceof Error ? error.message : String(error));
      return null;
    }
    throw error;
  }
}

async function run(command: string, args: string[], timeout = 5000): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4,
  });
  return stdout;
}

async function listMacApps(): Promise<Array<Record<string, unknown>>> {
  const script = [
    'tell application "System Events"',
    'set appRows to {}',
    'repeat with p in (application processes whose background only is false)',
    'set end of appRows to (name of p as text)',
    'end repeat',
    'return appRows',
    'end tell',
  ].join('\n');
  const output = await run('osascript', ['-e', script]);
  return output.split(', ')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, running: true }));
}

async function listWindowsApps(): Promise<Array<Record<string, unknown>>> {
  const script = [
    'Get-Process | Where-Object { $_.MainWindowTitle } |',
    'Select-Object ProcessName, Id, MainWindowTitle | ConvertTo-Json -Depth 3',
  ].join(' ');
  const output = await run('powershell.exe', ['-NoProfile', '-Command', script]);
  const parsed = JSON.parse(output || '[]');
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => ({
    name: row.ProcessName,
    pid: row.Id,
    windowTitle: row.MainWindowTitle,
    running: true,
  }));
}

async function listLinuxApps(): Promise<Array<Record<string, unknown>>> {
  try {
    const output = await run('wmctrl', ['-lx']);
    return output.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        return {
          windowId: parts[0],
          desktop: parts[1],
          host: parts[2],
          className: parts[3],
          windowTitle: parts.slice(4).join(' '),
          running: true,
        };
      });
  } catch {
    const output = await run('ps', ['-eo', 'comm=']);
    return [...new Set(output.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))]
      .slice(0, 200)
      .map((name) => ({ name, running: true }));
  }
}

async function listApps(): Promise<Array<Record<string, unknown>>> {
  if (process.platform === 'darwin') {
    return listMacApps();
  }
  if (process.platform === 'win32') {
    return listWindowsApps();
  }
  return listLinuxApps();
}

async function macAccessibilityTree(app: string): Promise<SemanticElement[]> {
  const escapedApp = app.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
on safeText(v)
  try
    return v as text
  on error
    return ""
  end try
end safeText

on emitElement(e, depth, maxDepth, counter)
  if depth > maxDepth then return {}
  set rows to {}
  try
    set roleText to my safeText(role of e)
  on error
    set roleText to "element"
  end try
  try
    set titleText to my safeText(title of e)
  on error
    set titleText to ""
  end try
  try
    set valueText to my safeText(value of e)
  on error
    set valueText to ""
  end try
  try
    set posValue to position of e
    set sizeValue to size of e
    set boundsText to ((item 1 of posValue) as text) & "," & ((item 2 of posValue) as text) & "," & ((item 1 of sizeValue) as text) & "," & ((item 2 of sizeValue) as text)
  on error
    set boundsText to ""
  end try
  set end of rows to ((counter as text) & tab & roleText & tab & titleText & tab & valueText & tab & boundsText)
  if counter > ${MAX_APP_STATE_ELEMENTS} then return rows
  try
    repeat with childElement in UI elements of e
      set childRows to my emitElement(childElement, depth + 1, maxDepth, counter + (count of rows))
      set rows to rows & childRows
      if (count of rows) > ${MAX_APP_STATE_ELEMENTS} then return rows
    end repeat
  end try
  return rows
end emitElement

tell application "System Events"
  if not (exists process "${escapedApp}") then error "App is not running: ${escapedApp}"
  tell process "${escapedApp}"
    set rows to {}
    repeat with w in windows
      set rows to rows & my emitElement(w, 0, 4, (count of rows) + 1)
      if (count of rows) > ${MAX_APP_STATE_ELEMENTS} then exit repeat
    end repeat
    return rows
  end tell
end tell
`;
  const output = await run('osascript', ['-e', script], 10000);
  return output.split(/\r?\n|, /)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [rawIndex, role, title, value, boundsText] = line.split('\t');
      const boundsParts = (boundsText || '').split(',').map((part) => Number.parseFloat(part));
      const hasBounds = boundsParts.length === 4 && boundsParts.every(Number.isFinite);
      return {
        index: rawIndex || String(index + 1),
        role: role || 'element',
        title: title || undefined,
        value: value || undefined,
        bounds: hasBounds
          ? { x: boundsParts[0], y: boundsParts[1], width: boundsParts[2], height: boundsParts[3] }
          : undefined,
      };
    });
}

async function getAccessibilityTree(app: string): Promise<{ elements: SemanticElement[]; message?: string }> {
  if (process.platform === 'darwin') {
    try {
      return { elements: await macAccessibilityTree(app) };
    } catch (error) {
      return { elements: [], message: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    elements: [],
    message: 'Native accessibility tree capture is not implemented for this platform yet.',
  };
}

async function getAppState(sessionId: string, app: string): Promise<SemanticAppState> {
  if (!app) {
    throw new Error('app is required.');
  }
  const helperState = await withHelperState(sessionId, (adapter) => adapter.getAppState({ sessionId, app }));
  if (helperState) {
    return helperState;
  }

  const screenshot = await captureScreenshot();
  const tree = await getAccessibilityTree(app);
  const state: SemanticAppState = {
    stateId: semanticSessionStore.createStateId(),
    app,
    platform: process.platform,
    screenshotDataUrl: screenshot.dataUrl,
    displaySize: screenshot.size,
    elements: tree.elements,
    accessibilityTree: tree.elements,
    message: tree.message,
  };
  return semanticSessionStore.save(sessionId, state);
}

async function targetFor(sessionId: string, app: string, stateId?: string): Promise<ExecutorTarget> {
  const cached = semanticSessionStore.getState(sessionId, app, stateId);
  return { displaySize: cached?.displaySize || (await captureScreenshot()).size };
}

export const computerSemanticsService = {
  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    const sessionId = readSessionId(input);
    switch (name) {
      case 'list_apps': {
        const adapter = getHelperAdapter();
        if (adapter) {
          try {
            return { apps: await adapter.listApps(), platform: process.platform };
          } catch (error) {
            if (!shouldFallbackFromHelper(error)) {
              throw error;
            }
            console.warn('[ComputerSemantics] Falling back from helper:', error instanceof Error ? error.message : String(error));
          }
        }
        return { apps: await listApps(), platform: process.platform };
      }
      case 'get_app_state':
        return getAppState(sessionId, readString(input.app));
      case 'click': {
        const app = readString(input.app);
        const helperState = await withHelperState(sessionId, (adapter) => adapter.clickElement({ ...input, sessionId, app }));
        if (helperState) {
          return helperState;
        }
        const stateId = readString(input.stateId) || undefined;
        const point = getPoint(input, sessionId, app);
        if (!point) {
          throw new Error('click requires x/y or an element_index from computer_get_app_state.');
        }
        const target = await targetFor(sessionId, app, stateId);
        const button = readButton(input.mouse_button ?? input.mouseButton);
        const clickCount = readClickCount(input.click_count ?? input.clickCount);
        for (let index = 0; index < clickCount; index += 1) {
          await executor.click(target, button, point, false);
        }
        return getAppState(sessionId, app);
      }
      case 'drag': {
        const app = readString(input.app);
        const helperState = await withHelperState(sessionId, (adapter) => adapter.drag({ ...input, sessionId, app }));
        if (helperState) {
          return helperState;
        }
        const stateId = readString(input.stateId) || undefined;
        const fromX = readNumber(input.from_x);
        const fromY = readNumber(input.from_y);
        const toX = readNumber(input.to_x);
        const toY = readNumber(input.to_y);
        if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) {
          throw new Error('drag requires from_x/from_y/to_x/to_y.');
        }
        await executor.drag(await targetFor(sessionId, app, stateId), { x: fromX, y: fromY }, { x: toX, y: toY }, readButton(input.mouse_button ?? input.mouseButton));
        return getAppState(sessionId, app);
      }
      case 'scroll': {
        const app = readString(input.app);
        const helperState = await withHelperState(sessionId, (adapter) => adapter.scrollElement({ ...input, sessionId, app }));
        if (helperState) {
          return helperState;
        }
        const stateId = readString(input.stateId) || undefined;
        const point = getPoint(input, sessionId, app);
        if (!point) {
          throw new Error('scroll requires x/y or an element_index from computer_get_app_state.');
        }
        await executor.scroll(await targetFor(sessionId, app, stateId), readDirection(input.direction), readNumber(input.pages) ?? 1, point);
        return getAppState(sessionId, app);
      }
      case 'type_text': {
        const app = readString(input.app);
        const helperState = await withHelperState(sessionId, (adapter) => adapter.typeText({ ...input, sessionId, app }));
        if (helperState) {
          return helperState;
        }
        await executor.type(readString(input.text));
        return getAppState(sessionId, app);
      }
      case 'press_key': {
        const app = readString(input.app);
        const helperState = await withHelperState(sessionId, (adapter) => adapter.pressKey({ ...input, sessionId, app }));
        if (helperState) {
          return helperState;
        }
        await executor.pressChord(readString(input.key));
        return getAppState(sessionId, app);
      }
      case 'set_value': {
        const app = readString(input.app);
        const helperState = await withHelperState(sessionId, (adapter) => adapter.setValue({ ...input, sessionId, app }));
        if (helperState) {
          return helperState;
        }
        const stateId = readString(input.stateId) || undefined;
        const point = getPoint(input, sessionId, app);
        if (!point) {
          throw new Error('set_value requires x/y or an element_index from computer_get_app_state.');
        }
        await executor.click(await targetFor(sessionId, app, stateId), 'left', point, false);
        await executor.pressChord(process.platform === 'darwin' ? 'cmd+a' : 'ctrl+a');
        await executor.type(readString(input.value));
        return getAppState(sessionId, app);
      }
      case 'perform_secondary_action': {
        const app = readString(input.app);
        const helperState = await withHelperState(sessionId, (adapter) => adapter.performSecondaryAction({ ...input, sessionId, app }));
        if (helperState) {
          return helperState;
        }
        const stateId = readString(input.stateId) || undefined;
        const point = getPoint(input, sessionId, app);
        if (!point) {
          throw new Error('perform_secondary_action requires x/y or an element_index from computer_get_app_state.');
        }
        await executor.click(await targetFor(sessionId, app, stateId), 'right', point, false);
        return getAppState(sessionId, app);
      }
      default:
        throw new Error(`Unknown semantic Computer Use tool: ${name}`);
    }
  },
};
