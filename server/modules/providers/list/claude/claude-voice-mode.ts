/**
 * Voice mode: the spoken-line contract appended to Claude's system prompt.
 *
 * When the composer has auto-speak on, `chat.send` carries
 * `options.voiceMode` (`true`, or `{ language }` with a BCP 47 tag, normally
 * the UI locale). The runtime then asks Claude to close each reply with one
 * short `<spoken>` block. The client strips that block from the transcript and
 * from Copy and speaks it; a reply without one is simply not spoken.
 *
 * Off by default: any other value of `voiceMode` (absent, `false`, a string)
 * leaves the system prompt exactly as it was.
 */

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** English name of the block's language, or null when the tag is missing or unusable. */
function describeLanguage(tag: unknown): string | null {
  if (typeof tag !== 'string' || !LANGUAGE_TAG.test(tag.trim())) {
    return null;
  }
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag.trim());
    // DisplayNames echoes an unknown tag back unchanged; that is not a name.
    return name && name.toLowerCase() !== tag.trim().toLowerCase() ? name : null;
  } catch {
    return null;
  }
}

/**
 * The text to append to the `claude_code` preset, or null when voice mode is off.
 */
export function buildSpokenLineContract(voiceMode: unknown): string | null {
  if (voiceMode !== true && (typeof voiceMode !== 'object' || voiceMode === null || Array.isArray(voiceMode))) {
    return null;
  }

  const languageName = voiceMode === true ? null : describeLanguage((voiceMode as { language?: unknown }).language);
  const languageRule = languageName
    ? `Write the block in ${languageName}, whatever language the rest of the reply is in.`
    : 'Write the block in the language the user writes in.';

  return [
    '## Voice mode: a spoken line at the end of each reply',
    '',
    'The user may dictate prompts and listen to replies without looking at the screen.',
    '',
    '- End every reply with exactly one `<spoken>...</spoken>` block. It is the very last thing in the reply; nothing follows it.',
    '- In the block, write one or two sentences, roughly under 200 characters, saying what is done or what needs to happen next.',
    `- ${languageRule}`,
    '- Spell numbers out as words, in their grammatically correct form, never as digits.',
    '- Put no code, file paths, URLs, identifiers or digit sequences in the block. To refer to something like that, say it in general terms ("in the configuration", "in that pull request") and keep the details in the written part.',
    '- Only the final reply to the user carries the block. Do not write it into messages for subagents, non-interactive output, commit messages, pull request text or files.',
    '- Do not name people, companies, amounts or other confidential details in the block; refer to them in general terms.',
    '- The prompt was dictated, so speech recognition may have garbled it. If you are unsure which file is meant, or a step would irreversibly delete or overwrite something, do nothing and ask. Put the question in the block as well.',
    '- The block is not shown on screen; the user only hears it. Everything that matters must also be in the written part of the reply.',
    '',
    'Example: `<spoken>The migration is done and the tests passed. Shall I open a pull request?</spoken>`',
  ].join('\n');
}
