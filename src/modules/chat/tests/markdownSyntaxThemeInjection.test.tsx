import assert from 'node:assert/strict';

import { test, vi } from 'vitest';
import { render } from '@testing-library/react';

import { Markdown } from '@/modules/chat/transcript/Markdown';

/**
 * Regression coverage for the `<style id="cc-syntax-theme">` element that
 * Markdown.tsx injects at module scope.
 *
 * Every colour in a rendered code block is a `var(--cc-syntax-N)` reference, and
 * that stylesheet is the only place those custom properties are declared — it
 * cannot live in index.css because the values are derived from the Prism theme
 * objects at runtime. Nothing rendered a code block in a test before, so blanking
 * the element's text (every code block in the app turning colourless) or dropping
 * the injection entirely left the suite green.
 *
 * These tests render markdown through the real <Markdown>, read the custom
 * properties the rendered code block actually references, and require the
 * injected stylesheet to declare them. They also pin the two ways the element
 * must stay unique: across many renders, and across a re-evaluation of the module.
 */

const STYLE_ELEMENT_SELECTOR = 'style#cc-syntax-theme';

const CODE_MARKDOWN = 'Intro line.\n\n```ts\nconst answer = 41;\n```\n';

const renderMarkdown = () => render(<Markdown>{CODE_MARKDOWN}</Markdown>);

/** The `--cc-syntax-N` names the rendered highlighter actually asks the page for. */
const referencedVariables = (root: HTMLElement): Set<string> => {
  const names = new Set<string>();
  for (const element of root.querySelectorAll('[style]')) {
    for (const match of (element.getAttribute('style') ?? '').matchAll(/var\((--cc-syntax-\d+)\)/g)) {
      names.add(match[1]);
    }
  }
  return names;
};

/** The `--cc-syntax-N` names one block of the injected stylesheet declares. */
const declaredVariables = (css: string, blockSelector: string): Set<string> => {
  const block = new RegExp(`${blockSelector}\\{([^}]*)\\}`).exec(css);
  assert.ok(block, `expected a ${blockSelector} block in the injected stylesheet`);

  const names = new Set<string>();
  for (const declaration of block[1].split(';')) {
    const separator = declaration.indexOf(':');
    if (separator > 0) {
      names.add(declaration.slice(0, separator).trim());
    }
  }
  return names;
};

const injectedCss = (): string => {
  const elements = document.querySelectorAll(STYLE_ELEMENT_SELECTOR);
  assert.equal(elements.length, 1, 'expected exactly one injected syntax theme stylesheet');
  return elements[0].textContent ?? '';
};

test('the dark block declares every custom property a rendered code block references', () => {
  const { container } = renderMarkdown();

  const referenced = referencedVariables(container);
  assert.ok(referenced.size > 0, 'the rendered code block referenced no --cc-syntax variable');

  const declared = declaredVariables(injectedCss(), '\\.dark');
  const missing = [...referenced].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], 'variables used by the rendered code block are undeclared in .dark');
});

test('the root block declares the property the highlighted <pre> reads its colour from', () => {
  const { container } = renderMarkdown();

  const pre = container.querySelector('pre');
  assert.ok(pre, 'expected the fenced block to render a highlighted <pre>');
  const colourVariable = /color:\s*var\((--cc-syntax-\d+)\)/.exec(pre.getAttribute('style') ?? '');
  assert.ok(colourVariable, 'expected the <pre> colour to be a --cc-syntax variable');

  assert.ok(
    declaredVariables(injectedCss(), ':root').has(colourVariable[1]),
    `${colourVariable[1]} backs the light theme's code colour but :root does not declare it`,
  );
});

test('rendering many times does not inject the stylesheet again', () => {
  renderMarkdown();
  renderMarkdown();
  renderMarkdown();

  assert.equal(document.querySelectorAll(STYLE_ELEMENT_SELECTOR).length, 1);
});

test('re-evaluating the module reuses the stylesheet already in the document', async () => {
  vi.resetModules();
  await import('@/modules/chat/transcript/Markdown');

  assert.equal(document.querySelectorAll(STYLE_ELEMENT_SELECTOR).length, 1);
});
