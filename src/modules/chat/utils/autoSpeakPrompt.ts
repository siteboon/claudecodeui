// English like the rest of the prompt scaffolding: it describes output shape, not
// language. Without it, replies written for the eye are read out as punctuation soup.
const AUTO_SPEAK_PROMPT_HINT =
  'Your reply will be read aloud automatically, so write it to be listened to: '
  + 'short spoken-sounding sentences, minimal formatting.';

/**
 * The hint is visible in the transcript by necessity: the provider persists the
 * prompt it was given, so a hidden hint reappears on reload anyway — and an echo
 * differing from the sent text is not matched to its persisted turn, which leaves
 * the message on screen twice.
 */
export function withAutoSpeakHint(content: string, autoSpeakEnabled: boolean): string {
  if (!autoSpeakEnabled || !content.trim()) return content;
  return `${content}\n\n${AUTO_SPEAK_PROMPT_HINT}`;
}
