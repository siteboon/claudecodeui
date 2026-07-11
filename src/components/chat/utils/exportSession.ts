import type { ChatMessage } from '../types/types';

export function exportSessionAsMarkdown(messages: ChatMessage[], sessionId: string): void {
  const mdMessages = messages
    .filter((m) => m.type === 'user' || m.type === 'assistant')
    .map((m) => {
      const role = m.type === 'user' ? 'User' : 'Assistant';
      const time = new Date(m.timestamp).toLocaleString();
      const content = (m.content || m.displayText || '').trim();
      return `## ${role} (${time})\n\n${content}\n`;
    })
    .join('\n---\n\n');

  const markdown = `# Session ${sessionId}\n\n${mdMessages}`;
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${sessionId}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
