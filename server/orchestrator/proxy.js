/**
 * Orchestrator Proxy
 *
 * Provides a proxy layer that allows existing WebSocket handlers to work
 * with requests forwarded through the orchestrator. The OrchestratorProxySocket
 * implements a WebSocket-like interface so existing handlers can be reused unchanged.
 */

import { EventEmitter } from "events";
import { createAuthErrorMessage } from "./protocol.js";
import { createGitHubAuthFromEnv } from "./github-auth.js";

/**
 * OrchestratorProxySocket
 *
 * A "virtual WebSocket" that wraps orchestrator client communication.
 * Allows existing handleChatConnection and related handlers to work
 * with orchestrator-proxied requests without modification.
 */
export class OrchestratorProxySocket extends EventEmitter {
  /**
   * Creates a new proxy socket
   * @param {OrchestratorClient} orchestratorClient - The orchestrator client
   * @param {string} requestId - The request ID for this proxied session
   * @param {Object} [options] - Additional options
   * @param {Object} [options.user] - User info to attach (like normal WebSocket)
   */
  constructor(orchestratorClient, requestId, options = {}) {
    super();

    this.orchestratorClient = orchestratorClient;
    this.requestId = requestId;
    this.user = options.user || {
      id: "orchestrator",
      username: "orchestrator",
    };

    // Mimic WebSocket readyState constants
    this.CONNECTING = 0;
    this.OPEN = 1;
    this.CLOSING = 2;
    this.CLOSED = 3;

    // Start in OPEN state since the orchestrator connection is already established
    this._readyState = this.OPEN;

    // Track if this socket has been closed
    this._closed = false;
  }

  /**
   * Gets the current ready state (WebSocket-compatible)
   * @returns {number} Ready state constant
   */
  get readyState() {
    if (this._closed) {
      return this.CLOSED;
    }
    if (!this.orchestratorClient || !this.orchestratorClient.isConnected) {
      return this.CLOSED;
    }
    return this._readyState;
  }

  /**
   * Sends data through the orchestrator connection
   * This is the key method that existing handlers use to send responses.
   * @param {string|Object} data - Data to send
   */
  send(data) {
    if (this._closed || !this.orchestratorClient) {
      console.warn("[ORCHESTRATOR-PROXY] Cannot send, socket closed");
      return;
    }

    // Parse data if it's a string
    let parsedData = data;
    if (typeof data === "string") {
      try {
        parsedData = JSON.parse(data);
      } catch (e) {
        // Not JSON, send as-is wrapped in data field
        parsedData = { raw: data };
      }
    }

    // Forward through orchestrator as a response chunk
    this.orchestratorClient.sendResponseChunk(this.requestId, parsedData);
  }

  /**
   * Closes the proxy socket
   * @param {number} [code] - Close code
   * @param {string} [reason] - Close reason
   */
  close(code, reason) {
    if (this._closed) {
      return;
    }

    this._closed = true;
    this._readyState = this.CLOSED;

    // Send completion message through orchestrator
    if (this.orchestratorClient && this.orchestratorClient.isConnected) {
      this.orchestratorClient.sendResponseComplete(this.requestId, {
        code: code || 1000,
        reason: reason || "Normal close",
      });
    }

    this.emit("close", code, reason);
  }

  /**
   * Terminates the connection immediately
   */
  terminate() {
    this.close(1006, "Terminated");
  }

  /**
   * Simulates receiving a message (for orchestrator to inject user messages)
   * @param {Object} data - Message data from user via orchestrator
   */
  injectMessage(data) {
    if (this._closed) {
      return;
    }

    // Emit as if it came from the WebSocket
    this.emit("message", JSON.stringify(data));
  }

  /**
   * Simulates an error (for orchestrator to inject errors)
   * @param {Error} error - Error object
   */
  injectError(error) {
    this.emit("error", error);
  }
}

/**
 * OrchestratorProxyWriter
 *
 * Wraps OrchestratorProxySocket to match the WebSocketWriter interface
 * used in server/index.js handleChatConnection
 */
export class OrchestratorProxyWriter {
  /**
   * Creates a new proxy writer
   * @param {OrchestratorProxySocket} proxySocket - The proxy socket
   */
  constructor(proxySocket) {
    this.proxySocket = proxySocket;
    this.sessionId = null;
    this.isWebSocketWriter = true;
  }

  /**
   * Sends data through the proxy
   * @param {Object} data - Data to send
   */
  send(data) {
    if (this.proxySocket.readyState === this.proxySocket.OPEN) {
      // Send as JSON (matches WebSocketWriter behavior)
      this.proxySocket.send(data);
    }
  }

  /**
   * Sets the session ID
   * @param {string} sessionId - Session ID
   */
  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  /**
   * Gets the session ID
   * @returns {string|null} Session ID
   */
  getSessionId() {
    return this.sessionId;
  }
}

/**
 * Creates a request handler for orchestrator user requests
 *
 * This factory creates a handler that:
 * 1. Authenticates the request using pass-through GitHub OAuth
 * 2. Creates a proxy socket for each request
 * 3. Routes the request to the appropriate existing handler
 * 4. Manages the proxy socket lifecycle
 *
 * @param {Object} handlers - Object containing handler functions
 * @param {Function} handlers.handleChatMessage - Function to handle chat messages
 * @param {Object} statusHooks - Status tracking hooks
 * @param {Object} [authConfig] - Authentication configuration override
 * @returns {Function} Handler function for user_request events
 */
export function createUserRequestHandler(handlers, statusHooks, authConfig = null) {
  // Track active proxy sockets by request ID
  const activeProxySockets = new Map();

  // Initialize GitHub auth validator from env or config
  const githubAuth = authConfig || createGitHubAuthFromEnv();

  return async function handleUserRequest(orchestratorClient, message) {
    const { request_id: requestId, action, payload } = message;

    // Check if authentication is required (GitHub auth configured)
    if (githubAuth.isConfigured) {
      // Extract auth token from payload
      const authToken = payload?.auth_token;

      // Validate the token
      const authResult = await githubAuth.validate(authToken);

      if (!authResult.authenticated) {
        console.warn(
          `[ORCHESTRATOR-PROXY] Authentication failed for request ${requestId}: ${authResult.error}`
        );
        // Send auth error back through orchestrator
        const errorMsg = createAuthErrorMessage(requestId, authResult.error);
        orchestratorClient.ws?.send(JSON.stringify(errorMsg));
        return null;
      }

      // Authentication succeeded - attach user info to payload
      console.log(
        `[ORCHESTRATOR-PROXY] Authenticated user: ${authResult.user.username} (${authResult.user.authMethod})`
      );
      // Use the validated user info
      payload.user = authResult.user;
    }

    // Create proxy socket for this request
    const proxySocket = new OrchestratorProxySocket(
      orchestratorClient,
      requestId,
      { user: payload?.user },
    );

    // Track connection for status
    const connectionId = `orchestrator-${requestId}`;
    statusHooks?.onConnectionOpen?.(connectionId);

    // Store in active map
    activeProxySockets.set(requestId, proxySocket);

    // Clean up on close
    proxySocket.on("close", () => {
      activeProxySockets.delete(requestId);
      statusHooks?.onConnectionClose?.(connectionId);
    });

    // Create writer wrapper
    const writer = new OrchestratorProxyWriter(proxySocket);

    // Route based on action
    switch (action) {
      case "claude-command":
      case "cursor-command":
      case "codex-command":
      case "abort-session":
      case "claude-permission-response":
      case "cursor-abort":
      case "check-session-status":
      case "get-active-sessions":
        // Inject the message as if it came from a real WebSocket
        // The existing handler will process it via the 'message' event
        if (handlers.handleChatMessage) {
          handlers.handleChatMessage(
            proxySocket,
            writer,
            JSON.stringify({ type: action, ...payload }),
          );
        }
        break;

      case "close":
        // Handle close request
        proxySocket.close(payload?.code, payload?.reason);
        break;

      default:
        console.warn(`[ORCHESTRATOR-PROXY] Unknown action: ${action}`);
        orchestratorClient.sendError(requestId, `Unknown action: ${action}`);
        proxySocket.close(4000, "Unknown action");
    }

    return proxySocket;
  };
}

/**
 * Handles follow-up messages for an existing proxied session
 *
 * @param {Map} activeProxySockets - Map of active proxy sockets
 * @param {string} requestId - Request ID
 * @param {Object} payload - Message payload
 * @returns {boolean} True if handled, false if socket not found
 */
export function handleFollowUpMessage(activeProxySockets, requestId, payload) {
  const proxySocket = activeProxySockets.get(requestId);
  if (!proxySocket) {
    return false;
  }

  proxySocket.injectMessage(payload);
  return true;
}

export default OrchestratorProxySocket;
