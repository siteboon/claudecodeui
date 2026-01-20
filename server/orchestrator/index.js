/**
 * Orchestrator Module
 *
 * Provides functionality for connecting claudecodeui to a central orchestrator
 * server. This enables:
 * - Registration with the orchestrator
 * - Token-based authentication
 * - Status reporting
 * - User request proxying
 */

// Re-export protocol types and functions
export {
  OutboundMessageTypes,
  InboundMessageTypes,
  StatusValues,
  CommandTypes,
  createRegisterMessage,
  createStatusUpdateMessage,
  createPingMessage,
  createResponseMessage,
  createResponseChunkMessage,
  createResponseCompleteMessage,
  createErrorMessage,
  createAuthErrorMessage,
  createHttpProxyResponseMessage,
  serialize,
  parse,
  validateInboundMessage,
} from "./protocol.js";

// Re-export GitHub authentication
export {
  validateGitHubToken,
  createGitHubAuthFromEnv,
  authenticateOrchestratorRequest,
  getGitHubUser,
  checkOrgMembership,
  checkTeamMembership,
  checkUserAllowed,
} from "./github-auth.js";

// Re-export client
export { OrchestratorClient } from "./client.js";

// Re-export status tracker
export {
  StatusTracker,
  getStatusTracker,
  createStatusHooks,
} from "./status-tracker.js";

// Re-export proxy components
export {
  OrchestratorProxySocket,
  OrchestratorProxyWriter,
  createUserRequestHandler,
  handleFollowUpMessage,
} from "./proxy.js";

/**
 * Creates and configures an orchestrator client from environment variables
 *
 * @param {Object} [overrides] - Configuration overrides
 * @returns {Promise<OrchestratorClient|null>} Configured client or null if not in client mode
 */
export async function createOrchestratorClientFromEnv(overrides = {}) {
  const { OrchestratorClient } = await import("./client.js");

  // Check if orchestrator mode is enabled
  const mode = overrides.mode || process.env.ORCHESTRATOR_MODE || "standalone";
  if (mode !== "client") {
    return null;
  }

  const url = overrides.url || process.env.ORCHESTRATOR_URL;
  const token = overrides.token || process.env.ORCHESTRATOR_TOKEN;

  if (!url) {
    console.warn(
      "[ORCHESTRATOR] ORCHESTRATOR_URL not set, running in standalone mode",
    );
    return null;
  }

  if (!token) {
    console.warn(
      "[ORCHESTRATOR] ORCHESTRATOR_TOKEN not set, running in standalone mode",
    );
    return null;
  }

  const config = {
    url,
    token,
    clientId: overrides.clientId || process.env.ORCHESTRATOR_CLIENT_ID,
    reconnectInterval:
      overrides.reconnectInterval ||
      parseInt(process.env.ORCHESTRATOR_RECONNECT_INTERVAL) ||
      5000,
    heartbeatInterval:
      overrides.heartbeatInterval ||
      parseInt(process.env.ORCHESTRATOR_HEARTBEAT_INTERVAL) ||
      30000,
    metadata: overrides.metadata || {},
  };

  return new OrchestratorClient(config);
}

/**
 * Initializes the orchestrator integration
 *
 * This function:
 * 1. Creates the orchestrator client (if in client mode)
 * 2. Sets up status tracking hooks
 * 3. Connects to the orchestrator
 * 4. Sets up user request handling
 *
 * @param {Object} options - Initialization options
 * @param {Object} options.handlers - Handler functions for proxied requests
 * @param {Object} [options.config] - Configuration overrides
 * @returns {Promise<Object|null>} Object with client, statusHooks, and requestHandler, or null if standalone
 */
export async function initializeOrchestrator(options = {}) {
  const { handlers = {}, config = {} } = options;

  // Import dynamically to avoid circular dependencies
  const { OrchestratorClient } = await import("./client.js");
  const { createStatusHooks } = await import("./status-tracker.js");
  const { createUserRequestHandler } = await import("./proxy.js");

  // Check mode
  const mode = config.mode || process.env.ORCHESTRATOR_MODE || "standalone";
  if (mode !== "client") {
    console.log("[ORCHESTRATOR] Running in standalone mode");
    return null;
  }

  const url = config.url || process.env.ORCHESTRATOR_URL;
  const token = config.token || process.env.ORCHESTRATOR_TOKEN;

  if (!url || !token) {
    console.warn(
      "[ORCHESTRATOR] URL or token not configured, running in standalone mode",
    );
    return null;
  }

  // Determine callback URL for HTTP proxying
  // If not explicitly set, construct from PORT and public hostname
  const callbackUrl =
    config.callbackUrl || process.env.ORCHESTRATOR_CALLBACK_URL || null;

  // Create client
  const client = new OrchestratorClient({
    url,
    token,
    clientId: config.clientId || process.env.ORCHESTRATOR_CLIENT_ID,
    reconnectInterval:
      config.reconnectInterval ||
      parseInt(process.env.ORCHESTRATOR_RECONNECT_INTERVAL) ||
      5000,
    heartbeatInterval:
      config.heartbeatInterval ||
      parseInt(process.env.ORCHESTRATOR_HEARTBEAT_INTERVAL) ||
      30000,
    metadata: config.metadata || {},
    callbackUrl,
  });

  // Create status hooks
  const statusHooks = createStatusHooks(client);

  // Create request handler
  const requestHandler = createUserRequestHandler(handlers, statusHooks);

  // Set up user request handling
  client.on("user_request", (message) => {
    requestHandler(client, message);
  });

  // Log connection events
  client.on("connected", () => {
    console.log("[ORCHESTRATOR] Connected to orchestrator");
  });

  client.on("disconnected", ({ code, reason }) => {
    console.log(
      `[ORCHESTRATOR] Disconnected from orchestrator: ${code} ${reason || ""}`,
    );
  });

  client.on("error", (error) => {
    console.error("[ORCHESTRATOR] Error:", error.message);
  });

  // Connect
  try {
    await client.connect();
    console.log("[ORCHESTRATOR] Successfully connected and registered");
  } catch (error) {
    console.warn(
      "[ORCHESTRATOR] Orchestrator unavailable, running in standalone mode:",
      error.message,
    );
    // Return null so callers know orchestrator is not available
    return null;
  }

  return {
    client,
    statusHooks,
    requestHandler,
  };
}
