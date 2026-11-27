import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import { splitStreamingMarkdown } from '@/modules/chat/utils/streamingMarkdown';

vi.mock('@/modules/command-palette', () => ({
  usePaletteOps: () => ({ openFileInEditor: vi.fn(), openDirectory: vi.fn() }),
}));

const { MarkdownBody } = await import('@/modules/chat/transcript/Markdown');

const ATTENTION_STEPS = String.raw`## 어텐션 계산

$$\operatorname{Attention}(Q,K,V)=\operatorname{softmax}(QK^T/\sqrt{d_k})V$$

1. **Q, K, V 생성:** 임베딩 벡터($X$)에 가중치 행렬($W_Q, W_K, W_V$)을 곱합니다.
2. **유사도 계산 ($Q \cdot K^T$):** Query와 Key를 내적합니다.
3. **확률 변환:** $\sqrt{d_k}$으로 나눕니다.
4. **정보 결합 ($\times V$):** **Value($V$)**에 곱합니다.`;

test('the attention explanation renders inline math inside Korean prose and bold labels', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(<MarkdownBody>{ATTENTION_STEPS}</MarkdownBody>);
  expect(root.querySelectorAll('.katex')).toHaveLength(7);
  expect(root.querySelectorAll('strong .katex')).toHaveLength(2);
  expect(root.querySelector('.katex-error')).toBeNull();
  expect(root.textContent).not.toContain('$');
});

test('a single-dollar-only message activates the math plugin, including user line breaks', () => {
  for (const breaks of [false, true]) {
    const html = renderToStaticMarkup(<MarkdownBody breaks={breaks}>{'입력 $X$\n출력 $V$'}</MarkdownBody>);
    expect(html.match(/class="katex"/g)).toHaveLength(2);
    expect(html.includes('<br')).toBe(breaks);
  }
});

test.each([
  'Intro.\n\n입력 $X$와 $Q \\cdot K^T$.\n\nAfter.',
  'Prices $5 and $7.\n\nThen $x^2$.\n\nAfter.',
  'Pay $5 and $7 ($x$), then $5-$𝟟 ($y$).',
  'Intro.\n\n$x\ny$\n\nAfter.',
])('every streaming prefix matches the reopened message: %s', (source) => {
  const normalize = (html: string) => html.replace(/>\n</g, '><');
  for (let end = 1; end <= source.length; end += 1) {
    const prefix = source.slice(0, end);
    const { settled, pending } = splitStreamingMarkdown(prefix);
    const whole = renderToStaticMarkup(<MarkdownBody>{prefix}</MarkdownBody>);
    const split = renderToStaticMarkup(<>
      {settled && <MarkdownBody>{settled}</MarkdownBody>}
      {pending && <MarkdownBody>{pending}</MarkdownBody>}
    </>);
    expect(normalize(split), `prefix ${end}`).toBe(normalize(whole));
  }
});

test('chat preserves mixed prices and following formulas', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(<MarkdownBody>{'Pay $5 and $7 ($x$), then $5-$𝟟 ($y$).'}</MarkdownBody>);
  expect(Array.from(root.querySelectorAll('annotation'), (node) => node.textContent)).toEqual(['x', 'y']);
  expect(root.textContent).toContain('Pay $5 and $7 (');
  expect(root.textContent).toContain('then $5-$𝟟 (');
});
