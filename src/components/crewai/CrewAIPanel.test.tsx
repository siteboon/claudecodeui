import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import CrewAIPanel from './CrewAIPanel';
import CrewAISummary from './CrewAISummary';
import type { CrewAIAgentStatus } from './types';

describe('CrewAIPanel', () => {
  it('renders agent list when agents are provided', () => {
    const agents: CrewAIAgentStatus[] = [
      { role: 'Researcher', status: 'working', task: 'Research topic', output: 'Searching...' },
      { role: 'Writer', status: 'idle', task: '', output: '' },
    ];
    render(<CrewAIPanel agents={agents} isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Researcher')).toBeDefined();
    expect(screen.getByText('Writer')).toBeDefined();
  });

  it('shows empty state when no agents', () => {
    render(<CrewAIPanel agents={[]} isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/no agents/i)).toBeDefined();
  });

  it('is hidden when isOpen is false', () => {
    const agents: CrewAIAgentStatus[] = [
      { role: 'Researcher', status: 'working', task: 'Research', output: '' },
    ];
    const { container } = render(<CrewAIPanel agents={agents} isOpen={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('CrewAISummary', () => {
  it('renders crew status summary in chat', () => {
    const agents: CrewAIAgentStatus[] = [
      { role: 'Researcher', status: 'complete', task: 'Research done', output: 'Found info' },
      { role: 'Writer', status: 'working', task: 'Writing report', output: '' },
    ];
    render(<CrewAISummary agents={agents} crewName="Research Crew" />);
    expect(screen.getByText('Research Crew')).toBeDefined();
    expect(screen.getByText(/Researcher/)).toBeDefined();
    expect(screen.getByText(/Writer/)).toBeDefined();
  });

  it('shows completed state when all agents are complete', () => {
    const agents: CrewAIAgentStatus[] = [
      { role: 'Researcher', status: 'complete', task: 'Done', output: 'Result' },
    ];
    render(<CrewAISummary agents={agents} crewName="Test Crew" />);
    expect(screen.getByText(/complete/i)).toBeDefined();
  });
});
