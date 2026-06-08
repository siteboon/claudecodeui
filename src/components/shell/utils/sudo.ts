/**
 * Detects a sudo password prompt at the tail of terminal output.
 *
 * sudo (and su) print a prompt and then wait for input with no trailing
 * newline, so the prompt is always the last thing emitted. We only trigger on
 * the bracketed `[sudo]` marker (across locales the marker stays literal while
 * the wording changes) to avoid false positives on the word "sudo" appearing
 * inside normal command output.
 */
const SUDO_PROMPT_REGEX = /\[sudo\].*:\s*$/;

export function detectSudoPrompt(text: string): string | null {
  if (!text) {
    return null;
  }

  // The prompt is whatever sudo is currently showing — the tail after the last
  // line break. If an answered prompt scrolled up, the tail is the next shell
  // line instead, so we never re-trigger on stale prompts.
  const lastBreak = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
  const lastLine = text.slice(lastBreak + 1);

  return SUDO_PROMPT_REGEX.test(lastLine) ? lastLine.replace(/\s+$/, '') : null;
}
