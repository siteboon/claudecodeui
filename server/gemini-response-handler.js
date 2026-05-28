// Gemini Response Handler - JSON Stream processing
import { sessionsService } from './modules/providers/services/sessions.service.js';

class GeminiResponseHandler {
  constructor(ws, options = {}) {
    this.ws = ws;
    this.buffer = '';
    this.onContentFragment = options.onContentFragment || null;
    this.onInit = options.onInit || null;
    this.onToolUse = options.onToolUse || null;
    this.onToolResult = options.onToolResult || null;
  }

  // Process incoming raw data from Gemini stream-json
  processData(data) {
    this.buffer += data;

    // Split by newline
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);
        this.handleEvent(event);
      } catch (err) {
        // Not a JSON line, probably debug output or CLI warnings
      }
    }
  }

  handleEvent(event) {
    const sid = typeof this.ws.getSessionId === 'function' ? this.ws.getSessionId() : null;

    if (event.type === 'init') {
      if (this.onInit) {
        this.onInit(event);
      }
      return;
    }

    // Invoke per-type callbacks for session tracking
    if (event.type === 'message' && event.role === 'assistant') {
      const content = event.content || '';
      if (this.onContentFragment && content) {
        this.onContentFragment(content);
      }
    } else if (event.type === 'tool_use' && this.onToolUse) {
      this.onToolUse(event);
    } else if (event.type === 'tool_result' && this.onToolResult) {
      this.onToolResult(event);
    }

    // Normalize via adapter and send all resulting messages
    const normalized = sessionsService.normalizeMessage('gemini', event, sid);
    for (const msg of normalized) {
      this.ws.send(msg);
    }
  }

  forceFlush() {
    if (this.buffer.trim()) {
      try {
        const event = JSON.parse(this.buffer);
        this.handleEvent(event);
      } catch (err) { }
    }
  }

  destroy() {
    this.buffer = '';
  }
}

export default GeminiResponseHandler;
