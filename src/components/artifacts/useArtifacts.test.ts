import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useArtifacts } from './useArtifacts';

describe('useArtifacts', () => {
  it('starts with empty artifacts and panel closed', () => {
    const { result } = renderHook(() => useArtifacts());
    expect(result.current.artifacts).toEqual([]);
    expect(result.current.isPanelOpen).toBe(false);
    expect(result.current.activeArtifactId).toBeNull();
  });

  it('toggles panel open/closed', () => {
    const { result } = renderHook(() => useArtifacts());
    act(() => result.current.togglePanel());
    expect(result.current.isPanelOpen).toBe(true);
    act(() => result.current.togglePanel());
    expect(result.current.isPanelOpen).toBe(false);
  });

  it('adds artifact from detected content', () => {
    const { result } = renderHook(() => useArtifacts());
    act(() => {
      result.current.addArtifact({
        id: 'det-1',
        type: 'html',
        title: 'HTML',
        content: '<h1>Hello</h1>',
      });
    });
    expect(result.current.artifacts).toHaveLength(1);
    expect(result.current.artifacts[0].title).toBe('HTML');
    expect(result.current.artifacts[0].versions).toHaveLength(1);
  });

  it('creates a new version when adding artifact with same id', () => {
    const { result } = renderHook(() => useArtifacts());
    act(() => {
      result.current.addArtifact({ id: 'det-1', type: 'html', title: 'HTML', content: '<h1>V1</h1>' });
    });
    act(() => {
      result.current.updateArtifact('det-1', '<h1>V2</h1>');
    });
    expect(result.current.artifacts).toHaveLength(1);
    expect(result.current.artifacts[0].versions).toHaveLength(2);
    expect(result.current.artifacts[0].content).toBe('<h1>V2</h1>');
  });

  it('selects an artifact and opens panel', () => {
    const { result } = renderHook(() => useArtifacts());
    act(() => {
      result.current.addArtifact({ id: 'det-1', type: 'html', title: 'HTML', content: '<h1>Hi</h1>' });
    });
    act(() => {
      result.current.selectArtifact('det-1');
    });
    expect(result.current.activeArtifactId).toBe('det-1');
    expect(result.current.isPanelOpen).toBe(true);
  });

  it('closePanel closes and deselects', () => {
    const { result } = renderHook(() => useArtifacts());
    act(() => {
      result.current.addArtifact({ id: 'det-1', type: 'html', title: 'HTML', content: '<h1>Hi</h1>' });
      result.current.selectArtifact('det-1');
    });
    act(() => result.current.closePanel());
    expect(result.current.isPanelOpen).toBe(false);
    expect(result.current.activeArtifactId).toBeNull();
  });

  it('processMessage detects and adds artifacts from message text', () => {
    const { result } = renderHook(() => useArtifacts());
    act(() => {
      result.current.processMessage('msg-1', '```html\n<h1>Hello</h1>\n```');
    });
    expect(result.current.artifacts).toHaveLength(1);
    expect(result.current.artifacts[0].content).toBe('<h1>Hello</h1>');
  });

  it('processMessage is idempotent for same messageId', () => {
    const { result } = renderHook(() => useArtifacts());
    act(() => {
      result.current.processMessage('msg-1', '```html\n<h1>Hello</h1>\n```');
    });
    act(() => {
      result.current.processMessage('msg-1', '```html\n<h1>Hello</h1>\n```');
    });
    expect(result.current.artifacts).toHaveLength(1);
  });

  it('clearArtifacts resets state', () => {
    const { result } = renderHook(() => useArtifacts());
    act(() => {
      result.current.addArtifact({ id: 'det-1', type: 'html', title: 'HTML', content: '<h1>Hi</h1>' });
      result.current.selectArtifact('det-1');
    });
    act(() => result.current.clearArtifacts());
    expect(result.current.artifacts).toEqual([]);
    expect(result.current.activeArtifactId).toBeNull();
  });
});
