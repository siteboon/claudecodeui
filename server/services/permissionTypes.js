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
 * @param message - Deny message
 * @param interrupt - Whether to interrupt execution on deny
 * @returns {Object} SDK-compatible permission result
 */
export function createSdkPermissionResult(decision, updatedInput = null, message = null, interrupt = false) {
  const behavior = (decision === PermissionDecision.ALLOW ||
                    decision === PermissionDecision.ALLOW_SESSION ||
                    decision === PermissionDecision.ALLOW_ALWAYS)
                   ? PermissionBehavior.ALLOW
                   : PermissionBehavior.DENY;

  const result = { behavior };

  // For ALLOW behavior, updatedInput is required and should always be provided
  if (behavior === PermissionBehavior.ALLOW) {
    if (!updatedInput || Object.keys(updatedInput).length === 0) {
      console.error('⚠️ [PermissionTypes] ALLOW result with empty updatedInput!');
      console.error('   This should not happen - original input should have been passed');
    }
    result.updatedInput = updatedInput || {};
  }
  // For future: Add updatedPermissions for allow-always decisions
  if (decision === PermissionDecision.ALLOW_ALWAYS) {
    // This will be implemented in Phase 4 (Memory & Patterns)
    // result.updatedPermissions = { ... };
  }
  if (behavior === PermissionBehavior.DENY) {
    result.message = message || 'Permission denied by user';
    if (interrupt) {
      result.interrupt = interrupt;
    }
  }

  return result;
}

/**
 * WebSocket message types for permission communication
 */
export const WS_MESSAGE_TYPES = {
  PERMISSION_REQUEST: 'permission-request',
  PERMISSION_RESPONSE: 'permission-response',
  PERMISSION_TIMEOUT: 'permission-timeout',
  PERMISSION_QUEUE_STATUS: 'permission-queue-status',
  PERMISSION_CANCELLED: 'permission-cancelled',
  PERMISSION_ERROR: 'permission-error'
};

/**
 * Creates a WebSocket permission request message
 */
export function createPermissionRequestMessage(request) {
  return {
    type: WS_MESSAGE_TYPES.PERMISSION_REQUEST,
    id: request.id,
    toolName: request.toolName,
    input: request.input,
    context: request.context,
    timestamp: request.timestamp,
    expiresAt: request.expiresAt || request.timestamp + PERMISSION_TIMEOUT_MS,
    riskLevel: TOOL_RISK_LEVELS[request.toolName] || RiskLevel.MEDIUM,
    category: TOOL_CATEGORIES[request.toolName] || ToolCategory.OTHER,
    summary: formatPermissionRequest(request.id, request.toolName, request.input).summary
  };
}

/**
 * Creates a WebSocket permission response message
 */
export function createPermissionResponseMessage(requestId, decision, updatedInput = null) {
  return {
    type: WS_MESSAGE_TYPES.PERMISSION_RESPONSE,
    requestId,
    decision,
    updatedInput,
    timestamp: Date.now()
  };
}

/**
 * Creates a WebSocket permission timeout message
 */
export function createPermissionTimeoutMessage(requestId, toolName) {
  return {
    type: WS_MESSAGE_TYPES.PERMISSION_TIMEOUT,
    requestId,
    toolName,
    timestamp: Date.now()
  };
}

/**
 * Creates a WebSocket permission queue status message
 */
export function createPermissionQueueStatusMessage(pending, processing) {
  return {
    type: WS_MESSAGE_TYPES.PERMISSION_QUEUE_STATUS,
    pending,
    processing,
    timestamp: Date.now()
  };
}

/**
 * Creates a WebSocket permission cancelled message
 */
export function createPermissionCancelledMessage(requestId, reason) {
  return {
    type: WS_MESSAGE_TYPES.PERMISSION_CANCELLED,
    requestId,
    reason,
    timestamp: Date.now()
  };
}

/**
 * Creates a WebSocket permission error message
 */
export function createPermissionErrorMessage(requestId, error) {
  return {
    type: WS_MESSAGE_TYPES.PERMISSION_ERROR,
    requestId,
    error: error.message || error,
    timestamp: Date.now()
  };
}

/**
 * Validates a WebSocket permission response message
 */
export function validatePermissionResponse(message) {
  if (!message || typeof message !== 'object') {
    throw new Error('Invalid message format');
  }

  if (message.type !== WS_MESSAGE_TYPES.PERMISSION_RESPONSE) {
    throw new Error('Invalid message type for permission response');
  }

  if (!message.requestId || typeof message.requestId !== 'string') {
    throw new Error('Invalid or missing requestId');
  }

  if (!Object.values(PermissionDecision).includes(message.decision)) {
    throw new Error(`Invalid decision: ${message.decision}`);
  }

  if (message.decision === PermissionDecision.ALLOW && message.updatedInput) {
    if (typeof message.updatedInput !== 'object') {
      throw new Error('updatedInput must be an object');
    }
  }

  return true;
}

/**
 * Validates a WebSocket permission request message
 */
export function validatePermissionRequest(message) {
  if (!message || typeof message !== 'object') {
    throw new Error('Invalid message format');
  }

  if (message.type !== WS_MESSAGE_TYPES.PERMISSION_REQUEST) {
    throw new Error('Invalid message type for permission request');
  }

  if (!message.id || typeof message.id !== 'string') {
    throw new Error('Invalid or missing request id');
  }

  if (!message.toolName || typeof message.toolName !== 'string') {
    throw new Error('Invalid or missing toolName');
  }

  if (!message.input || typeof message.input !== 'object') {
    throw new Error('Invalid or missing input');
  }

  return true;
}
