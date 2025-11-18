import express from "express";
import { apiKeysDb, credentialsDb, modelProvidersDb } from "../database/db.js";
import {
  updateClaudeSettingsForProvider,
  readClaudeSettings,
  SETTINGS_PATH,
} from "../utils/claude-settings.js";

const router = express.Router();

// ===============================
// API Keys Management
// ===============================

// Get all API keys for the authenticated user
router.get("/api-keys", async (req, res) => {
  try {
    const apiKeys = apiKeysDb.getApiKeys(req.user.id);
    // Don't send the full API key in the list for security
    const sanitizedKeys = apiKeys.map((key) => ({
      ...key,
      api_key: key.api_key.substring(0, 10) + "...",
    }));
    res.json({ apiKeys: sanitizedKeys });
  } catch (error) {
    console.error("Error fetching API keys:", error);
    res.status(500).json({ error: "Failed to fetch API keys" });
  }
});

// Create a new API key
router.post("/api-keys", async (req, res) => {
  try {
    const { keyName } = req.body;

    if (!keyName || !keyName.trim()) {
      return res.status(400).json({ error: "Key name is required" });
    }

    const result = apiKeysDb.createApiKey(req.user.id, keyName.trim());
    res.json({
      success: true,
      apiKey: result,
    });
  } catch (error) {
    console.error("Error creating API key:", error);
    res.status(500).json({ error: "Failed to create API key" });
  }
});

// Delete an API key
router.delete("/api-keys/:keyId", async (req, res) => {
  try {
    const { keyId } = req.params;
    const success = apiKeysDb.deleteApiKey(req.user.id, parseInt(keyId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "API key not found" });
    }
  } catch (error) {
    console.error("Error deleting API key:", error);
    res.status(500).json({ error: "Failed to delete API key" });
  }
});

// Toggle API key active status
router.patch("/api-keys/:keyId/toggle", async (req, res) => {
  try {
    const { keyId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive must be a boolean" });
    }

    const success = apiKeysDb.toggleApiKey(
      req.user.id,
      parseInt(keyId),
      isActive
    );

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "API key not found" });
    }
  } catch (error) {
    console.error("Error toggling API key:", error);
    res.status(500).json({ error: "Failed to toggle API key" });
  }
});

// ===============================
// Generic Credentials Management
// ===============================

// Get all credentials for the authenticated user (optionally filtered by type)
router.get("/credentials", async (req, res) => {
  try {
    const { type } = req.query;
    const credentials = credentialsDb.getCredentials(req.user.id, type || null);
    // Don't send the actual credential values for security
    res.json({ credentials });
  } catch (error) {
    console.error("Error fetching credentials:", error);
    res.status(500).json({ error: "Failed to fetch credentials" });
  }
});

// Create a new credential
router.post("/credentials", async (req, res) => {
  try {
    const { credentialName, credentialType, credentialValue, description } =
      req.body;

    if (!credentialName || !credentialName.trim()) {
      return res.status(400).json({ error: "Credential name is required" });
    }

    if (!credentialType || !credentialType.trim()) {
      return res.status(400).json({ error: "Credential type is required" });
    }

    if (!credentialValue || !credentialValue.trim()) {
      return res.status(400).json({ error: "Credential value is required" });
    }

    const result = credentialsDb.createCredential(
      req.user.id,
      credentialName.trim(),
      credentialType.trim(),
      credentialValue.trim(),
      description?.trim() || null
    );

    res.json({
      success: true,
      credential: result,
    });
  } catch (error) {
    console.error("Error creating credential:", error);
    res.status(500).json({ error: "Failed to create credential" });
  }
});

// Delete a credential
router.delete("/credentials/:credentialId", async (req, res) => {
  try {
    const { credentialId } = req.params;
    const success = credentialsDb.deleteCredential(
      req.user.id,
      parseInt(credentialId)
    );

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Credential not found" });
    }
  } catch (error) {
    console.error("Error deleting credential:", error);
    res.status(500).json({ error: "Failed to delete credential" });
  }
});

// Toggle credential active status
router.patch("/credentials/:credentialId/toggle", async (req, res) => {
  try {
    const { credentialId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive must be a boolean" });
    }

    const success = credentialsDb.toggleCredential(
      req.user.id,
      parseInt(credentialId),
      isActive
    );

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Credential not found" });
    }
  } catch (error) {
    console.error("Error toggling credential:", error);
    res.status(500).json({ error: "Failed to toggle credential" });
  }
});

// ===============================
// Model Provider Management
// ===============================

// List all configured model providers (API replacement)
router.get("/model-providers", async (req, res) => {
  try {
    const providers = modelProvidersDb.getProviders(req.user.id);
    const active = modelProvidersDb.getActiveProvider(req.user.id);

    res.json({
      providers,
      activeProviderId: active?.id || null,
    });
  } catch (error) {
    console.error("Error fetching model providers:", error);
    res.status(500).json({ error: "Failed to fetch model providers" });
  }
});

// Create a new provider entry
router.post("/model-providers", async (req, res) => {
  try {
    const { providerName, apiBaseUrl, apiKey, modelId, description } = req.body;

    if (!providerName?.trim() || !apiBaseUrl?.trim() || !apiKey?.trim()) {
      return res.status(400).json({
        error: "Provider name, API base URL, and API key are required",
      });
    }

    const result = modelProvidersDb.createProvider(
      req.user.id,
      providerName.trim(),
      apiBaseUrl.trim(),
      apiKey.trim(),
      modelId?.trim() || null,
      description?.trim() || null
    );

    // If this is the first provider (automatically activated), update settings.json
    if (result.isActive) {
      try {
        const activeProvider = modelProvidersDb.getActiveProvider(req.user.id);
        await updateClaudeSettingsForProvider(activeProvider);
        console.log(
          `✅ Created and activated first provider: ${providerName} in settings.json`
        );
      } catch (settingsError) {
        console.error(
          "⚠️ Failed to update settings.json for new provider:",
          settingsError
        );
      }
    }

    res.json({ success: true, provider: result });
  } catch (error) {
    console.error("Error creating model provider:", error);
    res.status(500).json({ error: "Failed to create model provider" });
  }
});

// Set active provider
router.patch("/model-providers/:providerId/activate", async (req, res) => {
  try {
    const { providerId } = req.params;
    const success = modelProvidersDb.setActiveProvider(
      req.user.id,
      parseInt(providerId)
    );

    if (success) {
      // Get the activated provider details
      const activeProvider = modelProvidersDb.getActiveProvider(req.user.id);

      // Update ~/.claude/settings.json with the new provider configuration
      try {
        await updateClaudeSettingsForProvider(activeProvider);
        console.log(
          `✅ Updated ~/.claude/settings.json for provider: ${activeProvider.provider_name}`
        );
      } catch (settingsError) {
        console.error(
          "⚠️ Failed to update settings.json (provider is still active in database):",
          settingsError
        );
        // Don't fail the request if settings.json update fails
        // The provider is still active in the database and will work for API calls
      }

      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Provider not found" });
    }
  } catch (error) {
    console.error("Error activating model provider:", error);
    res.status(500).json({ error: "Failed to activate model provider" });
  }
});

// Delete provider
router.delete("/model-providers/:providerId", async (req, res) => {
  try {
    const { providerId } = req.params;
    const success = modelProvidersDb.deleteProvider(
      req.user.id,
      parseInt(providerId)
    );

    if (success) {
      // After deletion, check if there's a new active provider
      const activeProvider = modelProvidersDb.getActiveProvider(req.user.id);

      // Update ~/.claude/settings.json
      try {
        await updateClaudeSettingsForProvider(activeProvider);
        if (activeProvider) {
          console.log(
            `✅ Switched to provider: ${activeProvider.provider_name} in settings.json`
          );
        } else {
          console.log("✅ Cleared custom provider settings from settings.json");
        }
      } catch (settingsError) {
        console.error(
          "⚠️ Failed to update settings.json after deletion:",
          settingsError
        );
      }

      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Provider not found" });
    }
  } catch (error) {
    console.error("Error deleting model provider:", error);
    res.status(500).json({ error: "Failed to delete model provider" });
  }
});

// Debug endpoint: Get current Claude settings.json content
router.get("/claude-settings", async (req, res) => {
  try {
    const settings = await readClaudeSettings();
    res.json({
      path: SETTINGS_PATH,
      settings: settings,
    });
  } catch (error) {
    console.error("Error reading Claude settings:", error);
    res.status(500).json({ error: "Failed to read Claude settings" });
  }
});

export default router;
