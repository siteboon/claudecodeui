/**
 * Permission Types and Constants
 *
 * This module defines the type structures, enums, and constants used
 * by the interactive permission system for the Claude Code UI.
 */

/**
 * Permission decision types that can be made by the user
 */
export const PermissionDecision = {
  ALLOW: 'allow',
  DENY: 'deny',
  ALLOW_SESSION: 'allow-session',
  ALLOW_ALWAYS: 'allow-always'
};

/**
 * Permission behavior types for SDK responses
 */
export const PermissionBehavior = {
  ALLOW: 'allow',
  DENY: 'deny'
};

/**
 * Tool risk levels for categorization
 */
export const RiskLevel = {
  LOW: 'low',       // Read-only operations
  MEDIUM: 'medium', // Write operations to non-critical files
  HIGH: 'high'      // System commands, destructive operations
};

/**
 * Tool categories for grouping similar operations
 */
export const ToolCategory = {
  FILE_READ: 'file-read',
  FILE_WRITE: 'file-write',
  SYSTEM_COMMAND: 'system-command',
  NETWORK: 'network',
  PROCESS: 'process',
  OTHER: 'other'
};

/**
 * Constants for permission system
 */
export const PERMISSION_TIMEOUT_MS = 30000; // 30 seconds
export const DEFAULT_QUEUE_CLEANUP_INTERVAL_MS = 60000; // 1 minute
export const MAX_QUEUE_SIZE = 100; // Maximum pending permission requests

/**
 * Tool risk mapping - categorizes tools by their risk level
 */
export const TOOL_RISK_LEVELS = {
  // Low risk - read-only operations
  Read: RiskLevel.LOW,
  Glob: RiskLevel.LOW,
  Grep: RiskLevel.LOW,
  TodoRead: RiskLevel.LOW,

  // Medium risk - file modifications
  Write: RiskLevel.MEDIUM,
  Edit: RiskLevel.MEDIUM,
  TodoWrite: RiskLevel.MEDIUM,
  NotebookEdit: RiskLevel.MEDIUM,

  // High risk - system operations
  Bash: RiskLevel.HIGH,
  Task: RiskLevel.HIGH,
  WebFetch: RiskLevel.HIGH,
  KillShell: RiskLevel.HIGH,
  SlashCommand: RiskLevel.HIGH,
  Skill: RiskLevel.HIGH
};

/**
 * Tool category mapping
 */
export const TOOL_CATEGORIES = {
  // File operations
  Read: ToolCategory.FILE_READ,
  Glob: ToolCategory.FILE_READ,
  Grep: ToolCategory.FILE_READ,
  Write: ToolCategory.FILE_WRITE,
  Edit: ToolCategory.FILE_WRITE,
  NotebookEdit: ToolCategory.FILE_WRITE,

  // System operations
  Bash: ToolCategory.SYSTEM_COMMAND,
  BashOutput: ToolCategory.SYSTEM_COMMAND,
  KillShell: ToolCategory.PROCESS,

  // Network operations
  WebFetch: ToolCategory.NETWORK,

  // Task/process operations
  Task: ToolCategory.PROCESS,
  SlashCommand: ToolCategory.PROCESS,
  Skill: ToolCategory.PROCESS,

  // Todo operations
  TodoRead: ToolCategory.OTHER,
  TodoWrite: ToolCategory.OTHER,

  // Other
  AskUserQuestion: ToolCategory.OTHER,
  ExitPlanMode: ToolCategory.OTHER
};

/**
 * Permission request structure
 * @typedef {Object} PermissionRequest
 * @property {string} id - Unique request identifier
 * @property {string} toolName - Name of the tool being invoked
 * @property {Object} input - Tool input parameters
 * @property {number} timestamp - Request creation timestamp
 * @property {Function} resolver - Promise resolver function
 * @property {Function} rejector - Promise rejector function
 * @property {AbortSignal} [abortSignal] - Optional abort signal from SDK
 */

/**
 * Permission response structure from user
 * @typedef {Object} PermissionResponse
 * @property {string} requestId - ID of the permission request
 * @property {string} decision - User decision (from PermissionDecision enum)
 * @property {Object} [updatedInput] - Optional modified input parameters
 * @property {boolean} [remember] - Whether to remember this decision
 */

/**
 * SDK permission result structure
 * @typedef {Object} SdkPermissionResult
 * @property {string} behavior - 'allow' or 'deny'
 * @property {Object} [updatedInput] - Optional modified input
 * @property {Object} [updatedPermissions] - Optional permission updates
 */

/**
 * Creates a formatted permission request for frontend display
 * @param {string} id - Request ID
 * @param {string} toolName - Tool name
 * @param {Object} input - Tool input
 * @returns {Object} Formatted request for frontend
 */
export function formatPermissionRequest(id, toolName, input) {
  const riskLevel = TOOL_RISK_LEVELS[toolName] || RiskLevel.MEDIUM;
  const category = TOOL_CATEGORIES[toolName] || ToolCategory.OTHER;

  // Create a summary of the operation
  let summary = '';
  switch (toolName) {
    case 'Bash':
      summary = input.command ? `Execute: ${input.command.substring(0, 100)}...` : 'Execute command';
      break;
    case 'Read':
      summary = `Read file: ${input.file_path}`;
      break;
    case 'Write':
      summary = `Write to: ${input.file_path}`;
      break;
    case 'Edit':
      summary = `Edit file: ${input.file_path}`;
      break;
    case 'WebFetch':
      summary = `Fetch URL: ${input.url}`;
      break;
    default:
      summary = `Use tool: ${toolName}`;
  }

  return {
    id,
    toolName,
    input,
    summary,
    riskLevel,
    category,
    timestamp: Date.now()
  };
}

/**
 * Creates an SDK permission result from a user decision
 * @param {string} decision - User decision
 * @param {Object} [updatedInput] - Optional modified input
 * @returns {Object} SDK-compatible permission result
 */
export function createSdkPermissionResult(decision, updatedInput = null) {
  const behavior = (decision === PermissionDecision.ALLOW ||
                    decision === PermissionDecision.ALLOW_SESSION ||
                    decision === PermissionDecision.ALLOW_ALWAYS)
                   ? PermissionBehavior.ALLOW
                   : PermissionBehavior.DENY;

  const result = { behavior };

  if (updatedInput) {
    result.updatedInput = updatedInput;
  }

  // For future: Add updatedPermissions for allow-always decisions
  if (decision === PermissionDecision.ALLOW_ALWAYS) {
    // This will be implemented in Phase 4 (Memory & Patterns)
    // result.updatedPermissions = { ... };
  }

  return result;
}