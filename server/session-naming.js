import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessionNamesDb } from './database/db.js';

const inFlight = new Set();

function cleanUserMessage(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .trim();
}

function sanitizeSummary(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text
    .replace(/[\n\r]/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')  // strip surrounding quotes
    .replace(/^(Session name|Name|Title|Summary):\s*/i, '')  // strip common prefixes
    .trim();
  if (!s) return null;
  return s.substring(0, 60);
}

async function generateSessionName(userMessage, assistantResponse) {
  const cleaned = cleanUserMessage(userMessage);
  if (!cleaned) return null;

  const prompt = `Given this coding assistant conversation, generate a concise session name (max 60 chars).

User: ${cleaned.substring(0, 500)}
Assistant: ${(assistantResponse || '').substring(0, 500)}

Rules:
- Return ONLY the session name, no quotes, no explanation
- Focus on the actual task, ignore XML tags and boilerplate content
- Be specific (e.g. "Fix auth token refresh bug" not "Code changes")
- Max 60 characters`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  timeout.unref();
  try {
    const q = query({
      prompt,
      options: {
        model: 'haiku',
        tools: [],
        maxTurns: 1,
        persistSession: false,
        permissionMode: 'plan',
        abortController: controller,
      },
    });
    for await (const msg of q) {
      if (msg.type === 'result' && msg.result) {
        return sanitizeSummary(msg.result);
      }
    }
  } finally {
    clearTimeout(timeout);
  }
  return null;
}

/**
 * Generate a session name using Claude SDK and persist it to SQLite.
 * Skips if a custom name (manual rename) already exists for this session.
 * @param {string} sessionId
 * @param {string} userMessage - First user message
 * @param {string|null} assistantResponse - First assistant response
 * @param {function|null} broadcastFn - Optional callback to broadcast session_name_updated
 */
export async function generateAndPersistSessionName(sessionId, userMessage, assistantResponse, broadcastFn) {
  if (inFlight.has(sessionId)) return;
  inFlight.add(sessionId);
  try {
    // Skip if user already manually renamed this session
    const existing = sessionNamesDb.getName(sessionId, 'claude');
    if (existing) return;

    const name = await generateSessionName(userMessage, assistantResponse);
    if (!name) return;

    // Atomic insert — a concurrent manual rename always wins
    const didPersist = sessionNamesDb.setNameIfAbsent(sessionId, 'claude', name);
    if (!didPersist) return;
    console.log(`Session ${sessionId} auto-named`);

    // SQLite writes don't trigger file watchers, so broadcast explicitly
    if (broadcastFn) {
      broadcastFn(sessionId, 'claude', name);
    }
  } finally {
    inFlight.delete(sessionId);
  }
}
