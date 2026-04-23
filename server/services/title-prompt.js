/**
 * Title generation prompt + helpers for the auto-naming worker.
 *
 * The prompt is adapted from open-webui's title generator (see
 * https://github.com/open-webui/open-webui). The system-message filter mirrors
 * the inline filter at server/projects.js:~830 so we never feed Task Master
 * JSON, warmup pings, or SDK reminders into the titler.
 */

export const TITLE_PROMPT = `You generate 3-5 word titles for coding chat conversations.

Rules:
- 3 to 5 words only
- Title Case
- No quotation marks
- Specific and action-oriented: "Fix login redirect bug", "Refactor auth middleware", "Add OAuth scopes"
- Never generic: not "Chat 1", not "Discussion", not "Question"
- No emoji, no markdown
- If the conversation is about a specific file or feature, name it

Respond with only the title, nothing else.`;

const SYSTEM_PREFIX_MATCHERS = [
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command-stdout>',
  '<system-reminder>',
  'Caveat:',
  'This session is being continued from a previous',
  'Invalid API key',
];

const SYSTEM_CONTAINS_MATCHERS = [
  '{"subtasks":',
  'CRITICAL: You MUST respond with ONLY a JSON',
];

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const firstText = content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
  return firstText ? firstText.text : '';
}

function isSystemMessage(text) {
  if (typeof text !== 'string' || !text) return true;
  if (text === 'Warmup') return true;
  if (SYSTEM_PREFIX_MATCHERS.some((p) => text.startsWith(p))) return true;
  if (SYSTEM_CONTAINS_MATCHERS.some((p) => text.includes(p))) return true;
  return false;
}

/**
 * Pull the first `limit` non-system user messages from raw JSONL lines.
 * Returns an array of plain text strings (never objects/arrays).
 */
export function extractFirstUserTexts(jsonlLines, limit = 2) {
  const messages = [];
  for (const line of jsonlLines) {
    if (messages.length >= limit) break;
    const trimmed = typeof line === 'string' ? line.trim() : '';
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry?.message?.role !== 'user') continue;
    const text = extractTextFromContent(entry.message.content);
    if (!text) continue;
    if (isSystemMessage(text)) continue;
    messages.push(text);
  }
  return messages;
}

/**
 * Post-process a Haiku-generated title. Returns null when the output is too
 * long, too short, or looks malformed so callers can fall back to a default.
 */
export function normalizeTitle(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim();
  if (!t) return null;
  t = t.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
  if (!t) return null;
  if (t.includes('\n')) return null;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 8) return null;
  return t;
}

export const __internal = { extractTextFromContent, isSystemMessage };
