import assert from 'node:assert/strict';

import { test } from 'vitest';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { buildSyntaxTheme } from '@/modules/chat/utils/syntaxHighlightTheme';
import type { PrismStyleSheet } from '@/modules/chat/utils/syntaxHighlightTheme';

/**
 * The variable theme must be a lossless re-encoding of the two Prism themes:
 * resolving its variables with the `:root` block has to reproduce oneLight
 * exactly, and with the `.dark` block oneDark exactly. Otherwise the toggle
 * would be fast but the colours would drift.
 */

const parseDeclarations = (css: string, blockSelector: string): Map<string, string> => {
  const block = new RegExp(`${blockSelector}\\{([^}]*)\\}`).exec(css);
  assert.ok(block, `expected a ${blockSelector} block`);

  const declarations = new Map<string, string>();
  for (const declaration of block[1].split(';')) {
    if (!declaration.trim()) {
      continue;
    }
    const separator = declaration.indexOf(':');
    declarations.set(declaration.slice(0, separator).trim(), declaration.slice(separator + 1));
  }
  return declarations;
};

const resolve = (
  style: PrismStyleSheet,
  variables: Map<string, string>,
): PrismStyleSheet => {
  const resolved: PrismStyleSheet = {};

  for (const [selector, rule] of Object.entries(style)) {
    const resolvedRule: Record<string, string> = {};
    for (const [property, value] of Object.entries(rule)) {
      const variableMatch = /^var\((--[\w-]+)\)$/.exec(value);
      if (!variableMatch) {
        resolvedRule[property] = value;
        continue;
      }
      const variableValue = variables.get(variableMatch[1]);
      // An undefined variable makes the declaration invalid, i.e. unset.
      if (variableValue !== undefined) {
        resolvedRule[property] = variableValue;
      }
    }
    resolved[selector] = resolvedRule;
  }

  return resolved;
};

const theme = buildSyntaxTheme(oneLight as PrismStyleSheet, oneDark as PrismStyleSheet);

test('the light variables reproduce oneLight exactly', () => {
  const resolved = resolve(theme.style, parseDeclarations(theme.css, ':root'));
  assert.deepEqual(resolved, oneLight);
});

test('the dark variables reproduce oneDark exactly', () => {
  const resolved = resolve(theme.style, parseDeclarations(theme.css, '\\.dark'));
  assert.deepEqual(resolved, oneDark);
});

test('no theme-dependent value is left as a literal colour', () => {
  // Any literal that differs between the themes would need the style prop to be
  // swapped again, which is what re-tokenized every block on a theme toggle.
  for (const [selector, rule] of Object.entries(theme.style)) {
    for (const [property, value] of Object.entries(rule)) {
      const lightValue = (oneLight as PrismStyleSheet)[selector]?.[property];
      const darkValue = (oneDark as PrismStyleSheet)[selector]?.[property];
      if (lightValue === darkValue) {
        continue;
      }
      assert.match(
        value,
        /^var\(--cc-syntax-\d+\)$/,
        `${selector}.${property} differs between themes but is not a variable`,
      );
    }
  }
});

test('properties shared by both themes stay literal instead of becoming variables', () => {
  // fontFamily is the same in both themes and must not cost a variable.
  const codeRule = theme.style['code[class*="language-"]'];
  assert.ok(codeRule.fontFamily);
  assert.ok(
    !codeRule.fontFamily.startsWith('var('),
    'identical values must not be turned into variables',
  );
});

test('theme-dependent colours are emitted as variables', () => {
  const preRule = theme.style['pre[class*="language-"]'];
  assert.match(preRule.background, /^var\(--cc-syntax-\d+\)$/);
});
