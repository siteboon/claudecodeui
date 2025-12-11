/**
 * SSH Config Parser
 * Parses ~/.ssh/config to auto-discover SSH hosts
 * Based on Windows Terminal's SshHostGenerator
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// SSH config file paths
const SSH_SYSTEM_CONFIG_PATH = process.platform === 'win32'
    ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'ssh', 'ssh_config')
    : '/etc/ssh/ssh_config';

const SSH_USER_CONFIG_PATH = path.join(os.homedir(), '.ssh', 'config');

/**
 * Parse a single SSH config file
 * @param {string} configPath - Path to the SSH config file
 * @returns {Array} Array of host configurations
 */
function parseConfigFile(configPath) {
    const hosts = [];

    try {
        if (!fs.existsSync(configPath)) {
            return hosts;
        }

        const content = fs.readFileSync(configPath, 'utf-8');
        const lines = content.split('\n');

        let currentHost = null;

        for (const line of lines) {
            const trimmedLine = line.trim();

            // Skip comments and empty lines
            if (!trimmedLine || trimmedLine.startsWith('#')) {
                continue;
            }

            // Parse key-value pairs
            const match = trimmedLine.match(/^\s*(\w+)\s+(.+)$/);
            if (!match) {
                continue;
            }

            const [, key, value] = match;
            const keyLower = key.toLowerCase();

            if (keyLower === 'host') {
                // Save previous host if exists
                if (currentHost && currentHost.name && !currentHost.name.includes('*')) {
                    hosts.push(currentHost);
                }

                // Start new host
                currentHost = {
                    name: value,
                    hostname: null,
                    port: 22,
                    user: null,
                    identityFile: null
                };
            } else if (currentHost) {
                switch (keyLower) {
                    case 'hostname':
                        currentHost.hostname = value;
                        break;
                    case 'port':
                        currentHost.port = parseInt(value, 10) || 22;
                        break;
                    case 'user':
                        currentHost.user = value;
                        break;
                    case 'identityfile':
                        // Expand ~ to home directory
                        currentHost.identityFile = value.replace(/^~/, os.homedir());
                        break;
                }
            }
        }

        // Don't forget the last host
        if (currentHost && currentHost.name && !currentHost.name.includes('*')) {
            hosts.push(currentHost);
        }
    } catch (error) {
        console.error(`[SSH Config] Error parsing ${configPath}:`, error.message);
    }

    return hosts;
}

/**
 * Get all SSH hosts from system and user config files
 * @returns {Array} Array of all discovered SSH hosts
 */
export function discoverSSHHosts() {
    const allHosts = [];
    const seenNames = new Set();

    // Parse user config first (higher priority)
    const userHosts = parseConfigFile(SSH_USER_CONFIG_PATH);
    for (const host of userHosts) {
        if (!seenNames.has(host.name)) {
            allHosts.push({ ...host, source: 'user' });
            seenNames.add(host.name);
        }
    }

    // Parse system config
    const systemHosts = parseConfigFile(SSH_SYSTEM_CONFIG_PATH);
    for (const host of systemHosts) {
        if (!seenNames.has(host.name)) {
            allHosts.push({ ...host, source: 'system' });
            seenNames.add(host.name);
        }
    }

    return allHosts;
}

/**
 * Get SSH config file paths
 * @returns {Object} Paths to SSH config files
 */
export function getSSHConfigPaths() {
    return {
        user: SSH_USER_CONFIG_PATH,
        system: SSH_SYSTEM_CONFIG_PATH,
        userExists: fs.existsSync(SSH_USER_CONFIG_PATH),
        systemExists: fs.existsSync(SSH_SYSTEM_CONFIG_PATH)
    };
}

export default { discoverSSHHosts, getSSHConfigPaths };
