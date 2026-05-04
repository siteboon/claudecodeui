import { describe, it, expect } from 'vitest';
import { detectArtifacts, type DetectedArtifact } from './ArtifactDetector';

describe('detectArtifacts', () => {
  it('returns empty array for plain text', () => {
    expect(detectArtifacts('Hello world')).toEqual([]);
  });

  it('detects HTML content in code blocks', () => {
    const md = '```html\n<div><h1>Hello</h1></div>\n```';
    const result = detectArtifacts(md);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('html');
    expect(result[0].content).toBe('<div><h1>Hello</h1></div>');
    expect(result[0].title).toBe('HTML');
  });

  it('detects SVG content in code blocks', () => {
    const md = '```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n```';
    const result = detectArtifacts(md);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('svg');
  });

  it('detects React/JSX content in code blocks', () => {
    const md = '```jsx\nexport default function App() { return <div>Hello</div>; }\n```';
    const result = detectArtifacts(md);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('react');
  });

  it('detects TSX content as React', () => {
    const md = '```tsx\nexport default function App(): JSX.Element { return <div>Hello</div>; }\n```';
    const result = detectArtifacts(md);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('react');
  });

  it('detects Mermaid diagrams', () => {
    const md = '```mermaid\ngraph TD\n  A-->B\n```';
    const result = detectArtifacts(md);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('mermaid');
  });

  it('detects multiple artifacts in one message', () => {
    const md = '```html\n<h1>Hi</h1>\n```\nSome text\n```mermaid\ngraph TD\n  A-->B\n```';
    const result = detectArtifacts(md);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('html');
    expect(result[1].type).toBe('mermaid');
  });

  it('ignores non-renderable code blocks', () => {
    const md = '```python\nprint("hello")\n```';
    expect(detectArtifacts(md)).toEqual([]);
  });

  it('detects inline SVG without code block markers', () => {
    const content = 'Here is a diagram:\n<svg viewBox="0 0 100 100"><rect width="50" height="50"/></svg>';
    const result = detectArtifacts(content);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('svg');
  });

  it('generates unique ids for detected artifacts', () => {
    const md = '```html\n<h1>A</h1>\n```\n```html\n<h1>B</h1>\n```';
    const result = detectArtifacts(md);
    expect(result[0].id).not.toBe(result[1].id);
  });

  it('uses language as title hint for code blocks', () => {
    const md = '```mermaid\ngraph TD\n  A-->B\n```';
    const result = detectArtifacts(md);
    expect(result[0].title).toBe('Mermaid Diagram');
  });
});
