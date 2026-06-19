import express from 'express';

import { computerUseService } from '@/modules/computer-use/computer-use.service.js';
import { semanticOperationForMcpTool } from '@/modules/computer-use/semantics/semantic-tool-dispatcher.js';

const router = express.Router();

function readBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const trimmed = header.trim();
  const scheme = 'Bearer';
  if (trimmed.slice(0, scheme.length).toLowerCase() !== scheme.toLowerCase()) {
    return null;
  }

  const separator = trimmed[scheme.length];
  if (separator !== ' ' && separator !== '\t') {
    return null;
  }

  return trimmed.slice(scheme.length + 1).trimStart() || null;
}

function toButton(value: unknown): 'left' | 'right' | 'middle' {
  return value === 'right' || value === 'middle' ? value : 'left';
}

function toScrollDirection(value: unknown): 'up' | 'down' | 'left' | 'right' {
  return value === 'down' || value === 'left' || value === 'right' ? value : 'up';
}

function point(input: Record<string, unknown>): { x: number; y: number } | undefined {
  return typeof input.x === 'number' && typeof input.y === 'number'
    ? { x: input.x, y: input.y }
    : undefined;
}

function requireNumber(input: Record<string, unknown>, name: string): number {
  const value = input[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} is required and must be a finite number.`);
  }
  return value;
}

function requirePoint(input: Record<string, unknown>): { x: number; y: number } {
  return { x: requireNumber(input, 'x'), y: requireNumber(input, 'y') };
}

function requireNamedPoint(input: Record<string, unknown>, xName: string, yName: string): { x: number; y: number } {
  return { x: requireNumber(input, xName), y: requireNumber(input, yName) };
}

router.use((req, res, next) => {
  const expected = computerUseService.getMcpToken();
  const token = readBearerToken(req.headers.authorization) || String(req.headers['x-computer-use-mcp-token'] || '');
  if (!token || token !== expected) {
    res.status(401).json({ success: false, error: 'Invalid Computer Use MCP token.' });
    return;
  }
  next();
});

router.post('/tools/:toolName', async (req, res) => {
  try {
    const input = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : undefined;
    const toolName = req.params.toolName;
    const semanticOperation = semanticOperationForMcpTool(toolName);
    let result: unknown;

    if (semanticOperation) {
      result = await computerUseService.callSemanticTool(semanticOperation, input);
      res.json({ success: true, data: result });
      return;
    }

    switch (toolName) {
      case 'computer_screenshot':
        result = await computerUseService.agentScreenshot(sessionId);
        break;
      case 'computer_cursor_position':
        result = await computerUseService.agentCursorPosition(sessionId);
        break;
      case 'computer_mouse_move':
        result = await computerUseService.agentMouseMove(sessionId, requirePoint(input));
        break;
      case 'computer_click':
        result = await computerUseService.agentUnifiedClick(sessionId, {
          button: toButton(input.mouseButton ?? input.mouse_button ?? input.button),
          point: point(input),
          clickCount: typeof input.clickCount === 'number'
            ? input.clickCount
            : typeof input.click_count === 'number'
              ? input.click_count
              : 1,
        });
        break;
      case 'computer_drag': {
        const from = requireNamedPoint(input, 'startX', 'startY');
        const to = requireNamedPoint(input, 'endX', 'endY');
        result = await computerUseService.agentDrag(sessionId, from, to, toButton(input.mouseButton ?? input.mouse_button ?? input.button));
        break;
      }
      case 'computer_type':
        result = await computerUseService.agentType(sessionId, String(input.text || ''));
        break;
      case 'computer_key':
        result = await computerUseService.agentKey(sessionId, String(input.key || ''));
        break;
      case 'computer_scroll':
        result = await computerUseService.agentScroll(sessionId, {
          direction: toScrollDirection(input.direction),
          amount: typeof input.amount === 'number' ? input.amount : undefined,
          x: typeof input.x === 'number' ? input.x : undefined,
          y: typeof input.y === 'number' ? input.y : undefined,
        });
        break;
      case 'computer_wait':
        result = await computerUseService.agentWait(sessionId, typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined);
        break;
      case 'computer_close_session':
        result = await computerUseService.agentStopSession(sessionId);
        break;
      default:
        res.status(404).json({ success: false, error: `Unknown Computer Use MCP tool "${toolName}".` });
        return;
    }

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Computer Use MCP tool failed.',
    });
  }
});

export default router;
