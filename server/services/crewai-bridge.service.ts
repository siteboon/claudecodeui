export type CrewAIBridgeConfig = {
  mode: 'local' | 'cloud' | 'hybrid';
  localProjectPath: string;
  cloudApiKey?: string;
  cloudEndpoint?: string;
};

export type CrewAIRunOptions = {
  projectPath: string;
  inputs: Record<string, string>;
  nineRouterBaseUrl?: string;
};

export type CrewAIAgentOutput = {
  agentRole: string;
  task: string;
  output: string;
};

export type CrewAIRunResult = {
  success: boolean;
  outputs: CrewAIAgentOutput[];
  exitCode: number;
  error?: string;
};

export type CrewAISpawnArgs = {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
};

export const CREWAI_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function validateCrewAIConfig(
  config: CrewAIBridgeConfig,
): { valid: boolean; error?: string } {
  if (config.mode === 'local' || config.mode === 'hybrid') {
    if (!config.localProjectPath) {
      return { valid: false, error: 'localProjectPath is required for local/hybrid mode' };
    }
  }

  if (config.mode === 'cloud' || config.mode === 'hybrid') {
    if (!config.cloudApiKey) {
      return { valid: false, error: 'cloudApiKey is required for cloud/hybrid mode' };
    }
  }

  return { valid: true };
}

export function buildCrewAISpawnArgs(options: CrewAIRunOptions): CrewAISpawnArgs {
  const env: Record<string, string> = {};

  if (Object.keys(options.inputs).length > 0) {
    env.CREWAI_INPUTS = JSON.stringify(options.inputs);
  }

  if (options.nineRouterBaseUrl) {
    env.LITELLM_BASE_URL = options.nineRouterBaseUrl;
  }

  return {
    command: 'uv',
    args: ['run', 'run_crew'],
    cwd: options.projectPath,
    env,
  };
}

export function parseCrewAIOutput(stdout: string): CrewAIAgentOutput[] {
  if (!stdout.trim()) {
    return [];
  }

  const outputs: CrewAIAgentOutput[] = [];
  const lines = stdout.split('\n');
  let currentAgent: string | null = null;
  let currentTask = '';
  let currentOutput: string[] = [];

  for (const line of lines) {
    const agentMatch = line.match(/^# Agent:\s*(.+)$/);
    if (agentMatch) {
      if (currentAgent) {
        outputs.push({
          agentRole: currentAgent,
          task: currentTask,
          output: currentOutput.join('\n').trim(),
        });
      }
      currentAgent = agentMatch[1].trim();
      currentTask = '';
      currentOutput = [];
      continue;
    }

    const taskMatch = line.match(/^## Task:\s*(.+)$/);
    if (taskMatch && currentAgent) {
      currentTask = taskMatch[1].trim();
      continue;
    }

    if (currentAgent) {
      currentOutput.push(line);
    }
  }

  if (currentAgent) {
    outputs.push({
      agentRole: currentAgent,
      task: currentTask,
      output: currentOutput.join('\n').trim(),
    });
  }

  return outputs;
}
