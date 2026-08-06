import path from 'node:path';

type TaskmasterServiceDependencies = {
    readTextFile(filePath: string): Promise<string>;
    getHomeDirectory(): string;
};

/**
 * Creates TaskMaster status workflows for the TaskMaster composition root.
 * The returned service is consumed by TaskMaster routes so filesystem and
 * environment access remain explicit production dependencies.
 */
export function createTaskmasterService(dependencies: TaskmasterServiceDependencies) {
    return {
        /** Detects TaskMaster in the user's Claude MCP configuration without exposing secret values. */
        async detectMcpServer() {
            const homeDirectory = dependencies.getHomeDirectory();
            const configurationPaths = [
                path.join(homeDirectory, '.claude.json'),
                path.join(homeDirectory, '.claude', 'settings.json'),
            ];
            let configuration: Record<string, unknown> | null = null;
            let configurationPath: string | null = null;

            for (const candidatePath of configurationPaths) {
                try {
                    const parsedConfiguration = JSON.parse(
                        await dependencies.readTextFile(candidatePath),
                    ) as unknown;
                    if (typeof parsedConfiguration === 'object' && parsedConfiguration !== null) {
                        configuration = parsedConfiguration as Record<string, unknown>;
                        configurationPath = candidatePath;
                        break;
                    }
                } catch {
                    // A missing or malformed candidate must not prevent checking the fallback file.
                }
            }

            if (!configuration) {
                return {
                    hasMCPServer: false,
                    reason: 'No Claude configuration file found',
                    hasConfig: false,
                };
            }

            const serverGroups: Array<{
                scope: string;
                projectPath?: string;
                servers: Record<string, unknown>;
            }> = [];

            if (typeof configuration.mcpServers === 'object' && configuration.mcpServers !== null) {
                serverGroups.push({
                    scope: 'user',
                    servers: configuration.mcpServers as Record<string, unknown>,
                });
            }

            if (typeof configuration.projects === 'object' && configuration.projects !== null) {
                for (const [projectPath, projectValue] of Object.entries(configuration.projects)) {
                    const projectConfiguration = typeof projectValue === 'object' && projectValue !== null
                        ? projectValue as Record<string, unknown>
                        : {};

                    if (
                        typeof projectConfiguration.mcpServers === 'object'
                        && projectConfiguration.mcpServers !== null
                    ) {
                        serverGroups.push({
                            scope: 'local',
                            projectPath,
                            servers: projectConfiguration.mcpServers as Record<string, unknown>,
                        });
                    }
                }
            }

            for (const serverGroup of serverGroups) {
                for (const [serverName, serverValue] of Object.entries(serverGroup.servers)) {
                    const serverConfiguration = typeof serverValue === 'object' && serverValue !== null
                        ? serverValue as Record<string, unknown>
                        : {};
                    const command = typeof serverConfiguration.command === 'string'
                        ? serverConfiguration.command
                        : null;
                    const url = typeof serverConfiguration.url === 'string'
                        ? serverConfiguration.url
                        : null;
                    const isTaskmasterServer = serverName === 'task-master-ai'
                        || serverName.includes('task-master')
                        || command?.includes('task-master');

                    if (!isTaskmasterServer) {
                        continue;
                    }

                    const environmentVariables = (
                        typeof serverConfiguration.env === 'object'
                        && serverConfiguration.env !== null
                    )
                        ? serverConfiguration.env as Record<string, unknown>
                        : {};

                    return {
                        hasMCPServer: true,
                        isConfigured: Boolean(command || url),
                        hasApiKeys: Object.keys(environmentVariables).length > 0,
                        scope: serverGroup.scope,
                        ...(serverGroup.projectPath ? { projectPath: serverGroup.projectPath } : {}),
                        config: {
                            command,
                            args: Array.isArray(serverConfiguration.args) ? serverConfiguration.args : [],
                            url,
                            envVars: Object.keys(environmentVariables),
                            type: command ? 'stdio' : url ? 'http' : 'unknown',
                        },
                    };
                }
            }

            return {
                hasMCPServer: false,
                reason: 'task-master-ai not found in configured MCP servers',
                hasConfig: true,
                configPath: configurationPath,
                availableServers: serverGroups.flatMap((serverGroup) => Object.keys(serverGroup.servers)),
            };
        },
    };
}
