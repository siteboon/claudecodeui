import express from 'express';

import { computerUseService } from '@/modules/computer-use/computer-use.service.js';

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
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : '';
    const toolName = req.params.toolName;
    let result: unknown;

    switch (toolName) {
      case 'computer_create_session':
        result = await computerUseService.createAgentSession();
        break;
      case 'computer_list_sessions':
        result = await computerUseService.listAgentSessions();
        break;
      case 'computer_screenshot':
        result = await computerUseService.agentScreenshot(sessionId);
        break;
      case 'computer_cursor_position':
        result = await computerUseService.agentCursorPosition(sessionId);
        break;
      case 'computer_mouse_move':
        result = await computerUseService.agentMouseMove(sessionId, point(input) || { x: 0, y: 0 });
        break;
      case 'computer_left_click':
        result = await computerUseService.agentClick(sessionId, 'left', point(input));
        break;
      case 'computer_right_click':
        result = await computerUseService.agentClick(sessionId, 'right', point(input));
        break;
      case 'computer_middle_click':
        result = await computerUseService.agentClick(sessionId, 'middle', point(input));
        break;
      case 'computer_double_click':
        result = await computerUseService.agentClick(sessionId, toButton(input.button), point(input), true);
        break;
      case 'computer_left_click_drag': {
        const from = typeof input.startX === 'number' && typeof input.startY === 'number'
          ? { x: input.startX, y: input.startY }
          : { x: 0, y: 0 };
        const to = typeof input.endX === 'number' && typeof input.endY === 'number'
          ? { x: input.endX, y: input.endY }
          : { x: 0, y: 0 };
        result = await computerUseService.agentDrag(sessionId, from, to, 'left');
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
