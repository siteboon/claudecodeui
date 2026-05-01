import type { McpFormState, McpProvider, McpScope, McpTransport } from './types';

export const MCP_PROVIDER_NAMES: Record<McpProvider, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
  groq: 'Groq',
};

export const MCP_SUPPORTED_SCOPES: Record<McpProvider, McpScope[]> = {
  claude: ['user', 'project', 'local'],
  cursor: ['user', 'project'],
  codex: ['user', 'project'],
  gemini: ['user', 'project'],
  groq: ['user', 'project'],
};

export const MCP_SUPPORTED_TRANSPORTS: Record<McpProvider, McpTransport[]> = {
  claude: ['stdio', 'http', 'sse'],
  cursor: ['stdio', 'http'],
  codex: ['stdio', 'http'],
  gemini: ['stdio', 'http', 'sse'],
  groq: ['stdio', 'http'],
};

export const MCP_GLOBAL_SUPPORTED_SCOPES: McpScope[] = ['user', 'project'];

export const MCP_GLOBAL_SUPPORTED_TRANSPORTS: McpTransport[] = ['stdio', 'http'];

export const MCP_PROVIDER_BUTTON_CLASSES: Record<McpProvider, string> = {
  claude: 'bg-purple-600 text-white hover:bg-purple-700',
  cursor: 'bg-purple-600 text-white hover:bg-purple-700',
  codex: 'bg-gray-800 text-white hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600',
  gemini: 'bg-blue-600 text-white hover:bg-blue-700',
  groq: 'bg-orange-600 text-white hover:bg-orange-700',
};

export const MCP_SUPPORTS_WORKING_DIRECTORY: Record<McpProvider, boolean> = {
  claude: false,
  cursor: false,
  codex: true,
  gemini: true,
  groq: false,
};

export const DEFAULT_MCP_FORM: McpFormState = {
  name: '',
  scope: 'user',
  workspacePath: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  cwd: '',
  url: '',
  headers: {},
  envVars: [],
  bearerTokenEnvVar: '',
  envHttpHeaders: {},
  importMode: 'form',
  jsonInput: '',
};
