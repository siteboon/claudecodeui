import { sessionsService } from './modules/providers/services/sessions.service.js';
import { createNormalizedMessage } from './shared/utils.js';

let activeCrewAISessions = new Map();

export async function queryCrewAI(command, options = {}, ws) {
  const { sessionId, crewId, inputs, projectPath, cwd } = options;
  const capturedSessionId = sessionId || `crewai-${Date.now()}`;
  const bridgeUrl = process.env.CREWAI_BRIDGE_URL || 'http://localhost:8000';

  activeCrewAISessions.set(capturedSessionId, { aborted: false });

  try {
    await sessionsService.ensureSessionAndProject(capturedSessionId, 'crewai', cwd || projectPath || 'crewai://crew-run');
  } catch { /* best-effort */ }

  ws.send(createNormalizedMessage({
    kind: 'session_created',
    sessionId: capturedSessionId,
    provider: 'crewai',
  }));

  const controller = new AbortController();
  activeCrewAISessions.set(capturedSessionId, { aborted: false, controller });

  try {
    const resp = await fetch(`${bridgeUrl}/crew/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        crew_id: crewId || command,
        inputs: inputs || {},
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`CrewAI bridge returned ${resp.status}: ${resp.statusText}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;

        try {
          const event = JSON.parse(payload);
          const msg = normalizeCrewEvent(event, capturedSessionId);
          if (msg) ws.send(msg);
        } catch { /* skip malformed events */ }
      }
    }

    ws.send(createNormalizedMessage({
      kind: 'complete',
      exitCode: 0,
      sessionId: capturedSessionId,
      provider: 'crewai',
    }));
  } catch (err) {
    if (err.name === 'AbortError') {
      ws.send(createNormalizedMessage({
        kind: 'complete',
        exitCode: 1,
        aborted: true,
        sessionId: capturedSessionId,
        provider: 'crewai',
      }));
    } else {
      const isOffline = err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED';
      ws.send(createNormalizedMessage({
        kind: 'error',
        content: isOffline
          ? 'CrewAI bridge is not running. Start it with: python crewai-bridge/api.py'
          : `CrewAI error: ${err.message}`,
        isError: true,
        sessionId: capturedSessionId,
        provider: 'crewai',
      }));
    }
  } finally {
    activeCrewAISessions.delete(capturedSessionId);
  }
}

function normalizeCrewEvent(event, sessionId) {
  const base = { sessionId, provider: 'crewai' };

  switch (event.type) {
    case 'status':
      return createNormalizedMessage({ ...base, kind: 'status', status: 'running', content: event.message });

    case 'result':
      return createNormalizedMessage({ ...base, kind: 'text', content: event.output, role: 'assistant' });

    case 'task_start':
      return createNormalizedMessage({ ...base, kind: 'status', status: 'task_started', content: event.task, toolName: event.agent });

    case 'task_output':
      return createNormalizedMessage({ ...base, kind: 'text', content: event.content, role: 'assistant' });

    case 'crew_complete':
      return createNormalizedMessage({ ...base, kind: 'text', content: event.result, role: 'assistant' });

    case 'error':
      return createNormalizedMessage({ ...base, kind: 'error', content: event.message, isError: true });

    default:
      return null;
  }
}

export function abortCrewAISession(sessionId) {
  const session = activeCrewAISessions.get(sessionId);
  if (!session) return false;
  try {
    session.controller?.abort();
    activeCrewAISessions.delete(sessionId);
    return true;
  } catch {
    return false;
  }
}

export function isCrewAISessionActive(sessionId) {
  return activeCrewAISessions.has(sessionId);
}

export function getActiveCrewAISessions() {
  return activeCrewAISessions;
}
