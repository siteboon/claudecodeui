/**
 * Utility functions for managing ~/.claude/settings.json
 * This file is used by Claude Code CLI for environment configuration
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

/**
 * Reads the current settings.json file
 * @returns {Promise<Object>} Settings object
 */
async function readClaudeSettings() {
  try {
    // Ensure directory exists
    const settingsDir = path.dirname(SETTINGS_PATH);
    await fs.mkdir(settingsDir, { recursive: true });

    // Try to read existing file
    try {
      const content = await fs.readFile(SETTINGS_PATH, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      // File doesn't exist or is invalid, return default structure
      if (error.code === "ENOENT") {
        console.log("📝 No existing settings.json found, will create new one");
        return {
          env: {},
          permissions: {
            allow: [],
            deny: [],
          },
        };
      }
      throw error;
    }
  } catch (error) {
    console.error("Error reading Claude settings:", error);
    throw error;
  }
}

/**
 * Writes settings to ~/.claude/settings.json
 * @param {Object} settings - Settings object to write
 */
async function writeClaudeSettings(settings) {
  try {
    // Ensure directory exists
    const settingsDir = path.dirname(SETTINGS_PATH);
    await fs.mkdir(settingsDir, { recursive: true });

    // Write with pretty formatting
    await fs.writeFile(
      SETTINGS_PATH,
      JSON.stringify(settings, null, 2),
      "utf-8"
    );
    console.log(`✅ Updated ${SETTINGS_PATH}`);
  } catch (error) {
    console.error("Error writing Claude settings:", error);
    throw error;
  }
}

/**
 * Updates environment variables in settings.json for a model provider
 * @param {Object} provider - Provider object with api_base_url, api_key, model_id
 * @returns {Promise<void>}
 */
async function updateClaudeSettingsForProvider(provider) {
  try {
    console.log(
      `🔄 Updating ~/.claude/settings.json for provider: ${
        provider?.provider_name || "default"
      }`
    );

    const settings = await readClaudeSettings();

    if (!provider) {
      // No provider - use default Anthropic settings or clear custom settings
      console.log(
        "ℹ️ No provider specified, using default Anthropic configuration"
      );

      // Remove custom base URL if it exists
      if (settings.env?.ANTHROPIC_BASE_URL) {
        delete settings.env.ANTHROPIC_BASE_URL;
      }
      if (settings.env?.ANTHROPIC_AUTH_TOKEN) {
        delete settings.env.ANTHROPIC_AUTH_TOKEN;
      }
      // Keep ANTHROPIC_API_KEY if it exists (user might have set it manually)

      await writeClaudeSettings(settings);
      return;
    }

    // Ensure env object exists
    if (!settings.env) {
      settings.env = {};
    }

    // Update API key
    if (provider.api_key) {
      // Use ANTHROPIC_AUTH_TOKEN for LLM gateways (per official docs)
      // Claude Code SDK checks both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY
      settings.env.ANTHROPIC_AUTH_TOKEN = provider.api_key;
      settings.env.ANTHROPIC_API_KEY = provider.api_key; // For backwards compatibility
      console.log("🔑 Updated API keys in settings.json");
    }

    // Update base URL
    if (provider.api_base_url) {
      settings.env.ANTHROPIC_BASE_URL = provider.api_base_url;
      console.log(`🌐 Updated ANTHROPIC_BASE_URL to: ${provider.api_base_url}`);
    } else {
      // Remove custom base URL if provider doesn't specify one
      if (settings.env.ANTHROPIC_BASE_URL) {
        delete settings.env.ANTHROPIC_BASE_URL;
        console.log("🌐 Removed custom ANTHROPIC_BASE_URL");
      }
    }

    // Update model ID if specified
    if (provider.model_id) {
      settings.env.ANTHROPIC_MODEL = provider.model_id;
      // Also set the small/fast model to the same value for consistency
      settings.env.ANTHROPIC_SMALL_FAST_MODEL = provider.model_id;
      console.log(`🤖 Updated model to: ${provider.model_id}`);
    } else {
      // Remove model override if not specified
      if (settings.env.ANTHROPIC_MODEL) {
        delete settings.env.ANTHROPIC_MODEL;
      }
      if (settings.env.ANTHROPIC_SMALL_FAST_MODEL) {
        delete settings.env.ANTHROPIC_SMALL_FAST_MODEL;
      }
      console.log("🤖 Removed model override, will use default");
    }

    // Write updated settings
    await writeClaudeSettings(settings);

    console.log(
      `✅ Successfully updated settings.json for provider: ${provider.provider_name}`
    );
  } catch (error) {
    console.error("Error updating Claude settings for provider:", error);
    throw error;
  }
}

/**
 * Backs up the current settings.json file
 * @returns {Promise<string>} Path to backup file
 */
async function backupClaudeSettings() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${SETTINGS_PATH}.backup-${timestamp}`;

    try {
      await fs.copyFile(SETTINGS_PATH, backupPath);
      console.log(`📦 Created backup: ${backupPath}`);
      return backupPath;
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log("ℹ️ No existing settings.json to backup");
        return null;
      }
      throw error;
    }
  } catch (error) {
    console.error("Error backing up Claude settings:", error);
    throw error;
  }
}

export {
  readClaudeSettings,
  writeClaudeSettings,
  updateClaudeSettingsForProvider,
  backupClaudeSettings,
  SETTINGS_PATH,
};
