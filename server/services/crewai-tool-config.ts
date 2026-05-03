export type AgentToolConfig = {
  agentRole: string;
  allowedTools: string[];
  deniedTools: string[];
  mcpServers: string[];
};

export const DEFAULT_AGENT_TOOLS: string[] = [
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
];

export const ELEVATED_AGENT_TOOLS: string[] = [
  ...DEFAULT_AGENT_TOOLS,
  'Bash',
  'Write',
  'Edit',
];

export function filterToolsForAgent(
  agentRole: string,
  config: AgentToolConfig | undefined,
): string[] {
  if (!config) {
    return [...DEFAULT_AGENT_TOOLS];
  }

  if (config.allowedTools.length > 0) {
    return [...config.allowedTools];
  }

  if (config.deniedTools.length > 0) {
    return DEFAULT_AGENT_TOOLS.filter(
      (tool) => !config.deniedTools.includes(tool),
    );
  }

  return [...DEFAULT_AGENT_TOOLS];
}

export function isToolAllowed(
  toolName: string,
  config: AgentToolConfig,
): boolean {
  if (config.deniedTools.includes(toolName)) {
    return false;
  }

  if (config.allowedTools.length > 0) {
    return config.allowedTools.includes(toolName);
  }

  return DEFAULT_AGENT_TOOLS.includes(toolName);
}
