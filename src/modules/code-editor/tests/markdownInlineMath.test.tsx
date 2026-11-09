import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import MarkdownPreview from '@/modules/code-editor/markdown/MarkdownPreview';

test('the preview renders the same single-dollar formulas and preserves prices', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <MarkdownPreview content={String.raw`벡터($X$), **유사도 ($Q \cdot K^T$)**, $\sqrt{d_k}$; prices $5 and $7.`} />,
  );
  expect(root.querySelectorAll('.katex')).toHaveLength(3);
  expect(root.querySelector('.katex-error')).toBeNull();
  expect(root.textContent).toContain('prices $5 and $7.');
});
