/**
 * MCP SERVER DETECTION UTILITY
 * ============================
 * 
 * Centralized utility for detecting MCP server configurations.
 * Used across TaskMaster integration and other MCP-dependent features.
 */

import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Check if task-master-ai MCP server is configured
 * Reads directly from Claude configuration files like claude-cli.js does
 * @returns {Promise<Object>} MCP detection result
 */
export async function detectTaskMasterMCPServer() {
    try {
        // Read Claude configuration files directly (same logic as mcp.js)
        const homeDir = os.homedir();
        const configPaths = [
            path.join(homeDir, '.claude.json'),
            path.join(homeDir, '.claude', 'settings.json')
        ];
        
        let configData = null;
        let configPath = null;
        
        // Try to read from either config file
        for (const filepath of configPaths) {
            try {
                const fileContent = await fsPromises.readFile(filepath, 'utf8');
                configData = JSON.parse(fileContent);
                configPath = filepath;
                break;
            } catch (error) {
                // File doesn't exist or is not valid JSON, try next
                continue;
            }
        }
        
        if (!configData) {
            return {
                hasMCPServer: false,
                reason: 'No Claude configuration file found',
                hasConfig: false
            };
        }

        // Look for task-master-ai in user-scoped MCP servers
        let taskMasterServer = null;
        if (configData.mcpServers && typeof configData.mcpServers === 'object') {
            const serverEntry = Object.entries(configData.mcpServers).find(([name, config]) => 
                name === 'task-master-ai' || 
                name.includes('task-master') ||
                (config && config.command && config.command.includes('task-master'))
            );
            
            if (serverEntry) {
                const [name, config] = serverEntry;
                taskMasterServer = {
                    name,
                    scope: 'user',
                    config,
                    type: config.command ? 'stdio' : (config.url ? 'http' : 'unknown')
                };
            }
        }

        // Also check project-specific MCP servers if not found globally
        if (!taskMasterServer && configData.projects) {
            for (const [projectPath, projectConfig] of Object.entries(configData.projects)) {
                if (projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
                    const serverEntry = Object.entries(projectConfig.mcpServers).find(([name, config]) => 
                        name === 'task-master-ai' || 
                        name.includes('task-master') ||
                        (config && config.command && config.command.includes('task-master'))
                    );
                    
                    if (serverEntry) {
                        const [name, config] = serverEntry;
                        taskMasterServer = {
                            name,
                            scope: 'local',
                            projectPath,
                            config,
                            type: config.command ? 'stdio' : (config.url ? 'http' : 'unknown')
                        };
                        break;
                    }
                }
            }
        }

        if (taskMasterServer) {
            const isValid = !!(taskMasterServer.config && 
                             (taskMasterServer.config.command || taskMasterServer.config.url));
            const hasEnvVars = !!(taskMasterServer.config && 
                                taskMasterServer.config.env && 
                                Object.keys(taskMasterServer.config.env).length > 0);

            return {
                hasMCPServer: true,
                isConfigured: isValid,
                hasApiKeys: hasEnvVars,
                scope: taskMasterServer.scope,
                config: {
                    command: taskMasterServer.config?.command,
                    args: taskMasterServer.config?.args || [],
                    url: taskMasterServer.config?.url,
                    envVars: hasEnvVars ? Object.keys(taskMasterServer.config.env) : [],
                    type: taskMasterServer.type
                }
            };
        } else {
            // Get list of available servers for debugging
            const availableServers = [];
            if (configData.mcpServers) {
                availableServers.push(...Object.keys(configData.mcpServers));
            }
            if (configData.projects) {
                for (const projectConfig of Object.values(configData.projects)) {
                    if (projectConfig.mcpServers) {
                        availableServers.push(...Object.keys(projectConfig.mcpServers).map(name => `local:${name}`));
                    }
                }
            }

            return {
                hasMCPServer: false,
                reason: 'task-master-ai not found in configured MCP servers',
                hasConfig: true,
                configPath,
                availableServers
            };
        }
    } catch (error) {
        console.error('Error detecting MCP server config:', error);
        return {
            hasMCPServer: false,
            reason: `Error checking MCP config: ${error.message}`,
            hasConfig: false
        };
    }
}

/**
 * Get all configured MCP servers (not just TaskMaster)
 * @returns {Promise<Object>} All MCP servers configuration
 */
export async function getAllMCPServers() {
    try {
        const homeDir = os.homedir();
        const configPaths = [
            path.join(homeDir, '.claude.json'),
            path.join(homeDir, '.claude', 'settings.json')
        ];
        
        let configData = null;
        let configPath = null;
        
        // Try to read from either config file
        for (const filepath of configPaths) {
            try {
                const fileContent = await fsPromises.readFile(filepath, 'utf8');
                configData = JSON.parse(fileContent);
                configPath = filepath;
                break;
            } catch (error) {
                continue;
            }
        }
        
        if (!configData) {
            return {
                hasConfig: false,
                servers: {},
                projectServers: {}
            };
        }

        return {
            hasConfig: true,
            configPath,
            servers: configData.mcpServers || {},
            projectServers: configData.projects || {}
        };
    } catch (error) {
        console.error('Error getting all MCP servers:', error);
        return {
            hasConfig: false,
            error: error.message,
            servers: {},
            projectServers: {}
        };
    }
}