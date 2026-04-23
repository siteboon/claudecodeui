/**
 * Phase 4 — Haiku tagging prompt + helpers.
 *
 * Mirrors the structure of title-prompt.js. The prompt asks Haiku to choose
 * an existing topic when one fits or invent a new 2-3 word Title Case label.
 * `extractFirstUserText` reuses the system-message filter conventions from
 * title-prompt.js so we don't feed warmup pings or SDK reminders into Haiku.
 */

import { extractFirstUserTexts, normalizeTitle as titleNormalize } from './title-prompt.js';

const MAX_PREVIEW_CHARS = 1000;

const FALLBACK_TOPIC = 'Misc';

export const TOPIC_PROMPT_TEMPLATE = ({ existingTopics, title, firstMessage }) => {
  const topicsLine = existingTopics.length
    ? existingTopics.join(', ')
    : '(none yet)';
  return `You assign topic tags to coding chat conversations.

Existing topics in this project: ${topicsLine}
Conversation title: ${title || '(no title)'}
First message: ${firstMessage || '(empty)'}

Assign ONE topic. Prefer an existing topic if it fits. Otherwise invent a new topic (2-3 words, Title Case).
Examples: "Auth", "Tests", "Deploy Flakiness", "Refactor Data Layer"
Respond with only the topic name.`;
};

export const CLUSTER_NAMING_PROMPT = ({ existingTopics, sampleTitles }) => {
  const topicsLine = existingTopics.length ? existingTopics.join(', ') : '(none yet)';
  return `You name clusters of related coding conversations with a short topic tag.

Existing topics in this project: ${topicsLine}
Sample conversation titles in this cluster:
${sampleTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Pick a 2-3 word Title Case label that summarizes what these conversations have in common.
Prefer an existing topic name if one fits. Examples: "Auth", "Tests", "Deploy Flakiness", "Refactor Data Layer".
Respond with only the topic name.`;
};

/**
 * Build the (title, firstMessage) tuple a single conversation contributes to a
 * tagging prompt. Reads the JSONL file at filePath and pulls out the first
 * non-system user message via the title-prompt helper.
 */
export async function buildSessionContext(filePath, fsp) {
  let content;
  try {
    content = await fsp.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const lines = content.split('\n');
  const texts = extractFirstUserTexts(lines, 1);
  if (!texts.length) return null;
  return texts[0].slice(0, MAX_PREVIEW_CHARS);
}

/**
 * Validate + normalize Haiku's topic response. Returns null when the model
 * returns junk so callers can fall back to a default.
 */
export function normalizeTopic(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim();
  if (!t) return null;
  // Strip wrapping quotes and trailing punctuation that Haiku occasionally adds.
  t = t.replace(/^["'`*]+/, '').replace(/["'`*.,;:!?]+$/, '').trim();
  if (!t) return null;
  if (t.includes('\n')) {
    t = t.split('\n')[0].trim();
  }
  // Drop "Topic: Auth" style prefixes.
  t = t.replace(/^topic\s*[:\-]\s*/i, '').trim();
  if (!t) return null;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6) return null;
  // Title Case for consistency.
  const titled = words
    .map((w) => {
      if (/^[A-Z0-9]+$/.test(w)) return w; // ACRONYMs
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
  if (titled.length > 40) return null;
  return titled;
}

export { FALLBACK_TOPIC, MAX_PREVIEW_CHARS, titleNormalize };

export const __internal = { extractFirstUserTexts };
