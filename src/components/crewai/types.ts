export type CrewAIAgentStatus = {
  role: string;
  status: 'idle' | 'working' | 'complete' | 'error';
  task: string;
  output: string;
};

export type CrewAICrewStatus = {
  crewName: string;
  agents: CrewAIAgentStatus[];
  status: 'idle' | 'running' | 'complete' | 'error';
  startedAt?: number;
  completedAt?: number;
};
