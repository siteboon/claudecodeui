import { describe, it, expect } from 'vitest';
import { exportConversation, type ExportableMessage } from './exportConversation';

const messages: ExportableMessage[] = [
  { role: 'user', content: 'Hello', timestamp: '2026-05-04 10:00' },
  { role: 'assistant', content: 'Hi there!', timestamp: '2026-05-04 10:01' },
];

describe('exportConversation', () => {
  describe('markdown format', () => {
    it('includes title as h1', () => {
      const result = exportConversation(messages, 'markdown', 'Test Chat');
      expect(result).toContain('# Test Chat');
    });

    it('labels user messages as **You**', () => {
      const result = exportConversation(messages, 'markdown');
      expect(result).toContain('### **You**');
    });

    it('labels assistant messages as **Assistant**', () => {
      const result = exportConversation(messages, 'markdown');
      expect(result).toContain('### **Assistant**');
    });

    it('includes timestamps in italics', () => {
      const result = exportConversation(messages, 'markdown');
      expect(result).toContain('_2026-05-04 10:00_');
    });

    it('includes message content', () => {
      const result = exportConversation(messages, 'markdown');
      expect(result).toContain('Hello');
      expect(result).toContain('Hi there!');
    });
  });

  describe('json format', () => {
    it('returns valid JSON', () => {
      const result = exportConversation(messages, 'json', 'Test');
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe('Test');
      expect(parsed.messages).toHaveLength(2);
    });

    it('preserves message roles and content', () => {
      const result = exportConversation(messages, 'json');
      const parsed = JSON.parse(result);
      expect(parsed.messages[0].role).toBe('user');
      expect(parsed.messages[1].content).toBe('Hi there!');
    });
  });

  describe('txt format', () => {
    it('includes title with underline', () => {
      const result = exportConversation(messages, 'txt', 'My Chat');
      expect(result).toContain('My Chat');
      expect(result).toContain('=======');
    });

    it('labels messages with brackets', () => {
      const result = exportConversation(messages, 'txt');
      expect(result).toContain('[You]');
      expect(result).toContain('[Assistant]');
    });
  });

  it('handles empty messages array', () => {
    const result = exportConversation([], 'markdown', 'Empty');
    expect(result).toContain('# Empty');
  });

  it('handles messages without timestamps', () => {
    const noTimestamp: ExportableMessage[] = [{ role: 'user', content: 'Hi' }];
    const result = exportConversation(noTimestamp, 'markdown');
    expect(result).not.toContain('_undefined_');
    expect(result).toContain('Hi');
  });
});
