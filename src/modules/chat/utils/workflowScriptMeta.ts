/**
 * Reads the `export const meta = { name, description, phases }` header a
 * workflow script opens with — what the card and the background-tasks strip
 * know about a launch before anything has reported on it.
 */

export type WorkflowScriptMeta = {
  name?: string;
  description?: string;
  phases: Array<{ title: string; detail?: string }>;
};

/**
 * A JS string literal in any of the three quotes: the quote in the first
 * group, the body in the second. Two of these in one pattern need the second
 * to refer back to its own quote, hence the renumbered copy.
 */
const STRING_LITERAL = "(['\"`])((?:\\\\.|(?!\\1).)*)\\1";
const SECOND_STRING_LITERAL = STRING_LITERAL.replace(/\\1/g, '\\3');
const META_NAME = new RegExp(`\\bname:\\s*${STRING_LITERAL}`);
const META_DESCRIPTION = new RegExp(`\\bdescription:\\s*${STRING_LITERAL}`);
const META_PHASES = /\bphases:\s*\[([\s\S]*?)\]/;
const PHASE_ENTRY = new RegExp(`\\{\\s*title:\\s*${STRING_LITERAL}(?:\\s*,\\s*detail:\\s*${SECOND_STRING_LITERAL})?`, 'g');

/**
 * Reads the `export const meta = { name, description, phases }` header a
 * workflow script opens with.
 *
 * The script is JavaScript, not JSON, so this reads the three fields with
 * regular expressions rather than evaluating anything: enough for the shapes
 * scripts actually use (string literals, an array of `{ title, detail }`), and
 * a script that writes them some other way simply shows no phases.
 */
export function parseWorkflowMeta(script: string): WorkflowScriptMeta {
  const metaStart = script.indexOf('export const meta');
  if (metaStart === -1) {
    return { phases: [] };
  }
  // Only the header: a `name:` further down the script belongs to something else.
  const header = script.slice(metaStart, script.indexOf('\n}', metaStart) + 1 || undefined);

  const phases: WorkflowScriptMeta['phases'] = [];
  const phasesSource = META_PHASES.exec(header)?.[1] ?? '';
  for (const match of phasesSource.matchAll(PHASE_ENTRY)) {
    phases.push({ title: match[2], detail: match[4] });
  }

  return {
    name: META_NAME.exec(header)?.[2],
    description: META_DESCRIPTION.exec(header)?.[2],
    phases,
  };
}
