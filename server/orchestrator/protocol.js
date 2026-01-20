/**
 * Orchestrator Protocol
 *
 * Defines message types and serialization/parsing for communication
 * between claudecodeui and the orchestrator server.
 */

/**
 * Message Types (Outbound: claudecodeui → Orchestrator)
 */
export const OutboundMessageTypes = {
  REGISTER: "register",
  STATUS_UPDATE: "status_update",
  PING: "ping",
  RESPONSE: "response",
  RESPONSE_CHUNK: "response_chunk",
  RESPONSE_COMPLETE: "response_complete",
  ERROR: "error",
  HTTP_PROXY_RESPONSE: "http_proxy_response",
};

/**
 * Message Types (Inbound: Orchestrator → claudecodeui)
 */
export const InboundMessageTypes = {
  REGISTERED: "registered",
  PONG: "pong",
  COMMAND: "command",
  ERROR: "error",
  USER_REQUEST: "user_request",
  HTTP_PROXY_REQUEST: "http_proxy_request",
};

/**
 * Status values for status updates
 */
export const StatusValues = {
  IDLE: "idle",
  ACTIVE: "active",
  BUSY: "busy",
};

/**
 * Command types from orchestrator
 */
export const CommandTypes = {
  DISCONNECT: "disconnect",
  REFRESH_STATUS: "refresh_status",
};

/**
 * Creates a registration message
 * @param {string} clientId - Unique client identifier
 * @param {string} userToken - Authentication token from orchestrator
 * @param {Object} metadata - Additional client metadata
 * @returns {Object} Registration message
 */
export function createRegisterMessage(clientId, userToken, metadata = {}) {
  return {
    type: OutboundMessageTypes.REGISTER,
    client_id: clientId,
    user_token: userToken,
    metadata: {
      hostname: metadata.hostname || "",
      project: metadata.project || "",
      status: metadata.status || StatusValues.IDLE,
      version: metadata.version || "1.0.0",
      ...metadata,
    },
  };
}

/**
 * Creates a status update message
 * @param {string} clientId - Unique client identifier
 * @param {string} status - Current status (idle, active, busy)
 * @returns {Object} Status update message
 */
export function createStatusUpdateMessage(clientId, status) {
  return {
    type: OutboundMessageTypes.STATUS_UPDATE,
    client_id: clientId,
    status,
  };
}

/**
 * Creates a ping message
 * @param {string} clientId - Unique client identifier
 * @returns {Object} Ping message
 */
export function createPingMessage(clientId) {
  return {
    type: OutboundMessageTypes.PING,
    client_id: clientId,
  };
}

/**
 * Creates a response message (for proxied requests)
 * @param {string} requestId - Original request ID
 * @param {Object} data - Response data
 * @returns {Object} Response message
 */
export function createResponseMessage(requestId, data) {
  return {
    type: OutboundMessageTypes.RESPONSE,
    request_id: requestId,
    data,
  };
}

/**
 * Creates a response chunk message (for streaming)
 * @param {string} requestId - Original request ID
 * @param {Object} data - Chunk data
 * @returns {Object} Response chunk message
 */
export function createResponseChunkMessage(requestId, data) {
  return {
    type: OutboundMessageTypes.RESPONSE_CHUNK,
    request_id: requestId,
    data,
  };
}

/**
 * Creates a response complete message
 * @param {string} requestId - Original request ID
 * @param {Object} data - Final data (optional)
 * @returns {Object} Response complete message
 */
export function createResponseCompleteMessage(requestId, data = null) {
  return {
    type: OutboundMessageTypes.RESPONSE_COMPLETE,
    request_id: requestId,
    ...(data !== null && data !== undefined && { data }),
  };
}

/**
 * Creates an error message
 * @param {string} requestId - Request ID (if applicable)
 * @param {string} message - Error message
 * @returns {Object} Error message
 */
export function createErrorMessage(requestId, message) {
  return {
    type: OutboundMessageTypes.ERROR,
    ...(requestId && { request_id: requestId }),
    message,
  };
}

/**
 * Serializes a message to JSON string
 * @param {Object} message - Message object
 * @returns {string} JSON string
 */
export function serialize(message) {
  return JSON.stringify(message);
}

/**
 * Parses a JSON string to message object
 * @param {string} data - JSON string
 * @returns {Object|null} Parsed message or null if invalid
 */
export function parse(data) {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error("[ORCHESTRATOR] Failed to parse message:", error.message);
    return null;
  }
}

/**
 * Validates an inbound message has required fields
 * @param {Object} message - Message to validate
 * @returns {boolean} True if valid
 */
export function validateInboundMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (!message.type) {
    return false;
  }

  // Validate specific message types
  switch (message.type) {
    case InboundMessageTypes.REGISTERED:
      return typeof message.success === "boolean";

    case InboundMessageTypes.PONG:
      return true;

    case InboundMessageTypes.COMMAND:
      return typeof message.command === "string";

    case InboundMessageTypes.ERROR:
      return typeof message.message === "string";

    case InboundMessageTypes.USER_REQUEST:
      // user_request message structure:
      // {
      //   type: "user_request",
      //   request_id: string,          // Unique request identifier
      //   action: string,              // Action to perform (e.g., "claude-command")
      //   payload: {
      //     auth_token?: string,       // GitHub OAuth token for pass-through auth
      //     user?: {                   // Optional pre-validated user info
      //       id: string,
      //       username: string,
      //       email?: string
      //     },
      //     ...                        // Action-specific payload data
      //   }
      // }
      return (
        typeof message.request_id === "string" &&
        typeof message.action === "string"
      );

    case InboundMessageTypes.HTTP_PROXY_REQUEST:
      // http_proxy_request message structure:
      // {
      //   type: "http_proxy_request",
      //   request_id: string,          // Unique request identifier
      //   method: string,              // HTTP method (GET, POST, etc.)
      //   path: string,                // Request path
      //   headers: [[string, string]], // Headers as key-value pairs
      //   body?: string,               // Optional request body
      //   query?: string,              // Optional query string
      //   proxy_base?: string,         // Base path for URL rewriting (e.g., "/clients/{id}/proxy")
      // }
      return (
        typeof message.request_id === "string" &&
        typeof message.method === "string" &&
        typeof message.path === "string"
      );

    default:
      // Unknown message types are considered valid (forward compatibility)
      return true;
  }
}

/**
 * Creates an auth error response message
 * @param {string} requestId - Request ID
 * @param {string} error - Error message
 * @returns {Object} Auth error message
 */
export function createAuthErrorMessage(requestId, error) {
  return {
    type: OutboundMessageTypes.ERROR,
    request_id: requestId,
    auth_error: true,
    message: error,
  };
}

/**
 * Creates an HTTP proxy response message
 * @param {string} requestId - Original request ID
 * @param {number} status - HTTP status code
 * @param {Array<[string, string]>} headers - Response headers as [key, value] pairs
 * @param {string} body - Response body
 * @returns {Object} HTTP proxy response message
 */
export function createHttpProxyResponseMessage(
  requestId,
  status,
  headers,
  body,
) {
  return {
    type: OutboundMessageTypes.HTTP_PROXY_RESPONSE,
    request_id: requestId,
    status,
    headers,
    body,
  };
}
