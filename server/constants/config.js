/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';

/**
 * Environment Flag: AgentX Authentication Forwarding
 * Enables authentication bypass feature for AgentX integration
 */
export const AGENTX_AUTH_FORWARDING = process.env.AGENTX_AUTH_FORWARDING === 'true';

/**
 * Environment Variable: AgentX Authentication Source
 * Specifies the trusted source for authentication forwarding
 */
export const AGENTX_AUTH_SOURCE = process.env.AGENTX_AUTH_SOURCE || '';
