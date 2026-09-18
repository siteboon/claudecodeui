/**
 * Builds one Prism style object whose theme-dependent values are CSS variables.
 *
 * `react-syntax-highlighter` re-tokenizes a block whenever its `style` prop
 * changes, so switching between the light and dark theme objects re-highlighted
 * every mounted code block at once. Emitting a single style object that reads
 * `var(--cc-syntax-N)` makes the prop constant, so the theme toggle becomes a
 * CSS variable flip and memo(Markdown) keeps the tokenization.
 *
 * The variables are derived from the two source themes rather than hand-written,
 * so the rendered colours are the same values Prism used before.
 */

export type PrismStyleSheet = Record<string, Record<string, string>>;

const VARIABLE_PREFIX = '--cc-syntax';

export type SyntaxTheme = {
  /** Style object handed to SyntaxHighlighter. Stable across theme changes. */
  style: PrismStyleSheet;
  /** `:root` / `.dark` declarations backing every variable in `style`. */
  css: string;
};

export function buildSyntaxTheme(light: PrismStyleSheet, dark: PrismStyleSheet): SyntaxTheme {
  const style: PrismStyleSheet = {};
  const lightDeclarations: string[] = [];
  const darkDeclarations: string[] = [];
  let variableCount = 0;

  for (const selector of unionKeys(light, dark)) {
    const lightRule = light[selector] ?? {};
    const darkRule = dark[selector] ?? {};
    const merged: Record<string, string> = {};

    for (const property of unionKeys(lightRule, darkRule)) {
      const lightValue = lightRule[property];
      const darkValue = darkRule[property];

      // Identical in both themes: no variable needed.
      if (lightValue === darkValue) {
        merged[property] = lightValue;
        continue;
      }

      const variableName = `${VARIABLE_PREFIX}-${variableCount}`;
      variableCount += 1;
      merged[property] = `var(${variableName})`;

      // A theme that omits the property leaves the variable undefined, which
      // makes the declaration invalid and drops it — the same result as the
      // theme not setting it. Only the light theme omits properties in the pair
      // this app ships, so the dark side is written unconditionally.
      if (lightValue !== undefined) {
        lightDeclarations.push(`${variableName}:${lightValue};`);
      }
      darkDeclarations.push(`${variableName}:${darkValue};`);
    }

    style[selector] = merged;
  }

  return {
    style,
    css: `:root{${lightDeclarations.join('')}}\n.dark{${darkDeclarations.join('')}}`,
  };
}

function unionKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])];
}
