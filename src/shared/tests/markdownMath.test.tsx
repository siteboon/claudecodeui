import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import { describe, expect, test } from 'vitest';

import { remarkMathWithCurrencyProtection } from '@/shared/utils';

const renderMath = (content: string) => {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMathWithCurrencyProtection]} rehypePlugins={[rehypeKatex]}>
      {content}
    </ReactMarkdown>,
  );
  return root;
};

describe('single-dollar math', () => {
  test.each(['$X$', '$W_Q, W_K, W_V$', String.raw`$Q \cdot K^T$`, String.raw`$\sqrt{d_k}$`, '$2 + 2 = 4$'])('%s renders through KaTeX', (source) => {
    const root = renderMath(source);
    expect(root.querySelector('annotation')?.textContent).toBe(source.slice(1, -1));
    expect(root.querySelector('.katex-error')).toBeNull();
  });

  test.each([
    'It costs $5 and $7 in total.',
    'The $20/psf allowance is low for a surgical buildout (sealed floors, surgery/recovery, plumbing). Can we push to $35–$50/psf?',
    '$10–$20, $1,000.50 and $2,000.',
    '$5-$７',
    '$5-$٧',
    '$5-$𝟟',
    '$HOME and $PATH are environment variables.',
    '$ x$ and $y $',
    '$x\ny$',
    '$unfinished',
    String.raw`\$X\$`,
  ])('%s stays literal', (source) => {
    const root = renderMath(source);
    expect(root.querySelector('.katex')).toBeNull();
    expect(root.textContent?.trim()).toBe(source.replace(/\\\$/g, '$'));
  });

  test('currency rejection preserves emphasis, links, and later math', () => {
    const root = renderMath('Pay $5 **today** and $7 [tomorrow](https://example.com), then compute $x^2$.');
    expect(root.querySelectorAll('.katex')).toHaveLength(1);
    expect(root.querySelector('strong')?.textContent).toBe('today');
    expect(root.querySelector('a')?.textContent).toBe('tomorrow');
    expect(root.textContent).toContain('$5 today and $7 tomorrow');
  });

  test.each([
    'Pay $5 and $7 ($x$).',
    'Pay $5 and $7, $9 ($x$).',
    'Pay $5-$７ ($x$).',
    'Pay $5-$٧ ($x$).',
    'Pay $5-$𝟟 ($x$).',
  ])('prices do not consume a later formula: %s', (source) => {
    const root = renderMath(source);
    expect(root.querySelectorAll('.katex')).toHaveLength(1);
    expect(root.querySelector('annotation')?.textContent).toBe('x');
    expect(root.textContent).toContain(source.slice(0, source.indexOf('($x$)')));
  });

  test.each(['Pay $5 and $x$.', '$2 + 2 = 4$'])('numeric text does not suppress valid math: %s', (source) => {
    const root = renderMath(source);
    expect(root.querySelectorAll('.katex')).toHaveLength(1);
    expect(root.querySelector('annotation')?.textContent).toBe(source === '$2 + 2 = 4$' ? '2 + 2 = 4' : 'x');
  });

  test('double-dollar inline and display math keep their original rules', () => {
    const root = renderMath('Inline $$ x + y $$ and $$z$$.\n\n$$\na = b\n\nc = d\n$$');
    expect(root.querySelectorAll('.katex')).toHaveLength(3);
    expect(root.querySelectorAll('.katex-display')).toHaveLength(1);
  });

  test('code and link destinations are never rewritten', () => {
    const root = renderMath('`$X$`\n\n```tex\n$Q \\cdot K^T$\n```\n\n    $V$\n\n[docs](https://example.com/$X$)');
    expect(root.querySelector('.katex')).toBeNull();
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/$X$');
    expect(root.querySelectorAll('code')).toHaveLength(3);
  });
});
