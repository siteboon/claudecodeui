import path from 'node:path';

import type {
  CliFileSystem,
  CliOutput,
  SandboxCommandService,
} from '@/shared/types.js';
import { terminalTextStyles } from '@/shared/utils.js';

type SandboxServiceDependencies = {
  fileSystem: Pick<CliFileSystem, 'pathExists'>;
  output: CliOutput;
  homeDirectory: string;
  runSandboxCommand(argumentsList: string[], inheritOutput?: boolean): string;
  spawnDetachedSandbox(argumentsList: string[]): void;
  wait(milliseconds: number): Promise<void>;
};

type SandboxOptions = {
  subcommand: 'create' | 'ls' | 'stop' | 'start' | 'rm' | 'logs' | 'help';
  workspace: string | null;
  agent: string;
  name: string | null;
  port: number;
  template: string;
  environmentVariables: string[];
};

const SANDBOX_TEMPLATES: Record<string, string> = {
  claude: 'docker.io/cloudcliai/sandbox:claude-code',
  codex: 'docker.io/cloudcliai/sandbox:codex',
};

const SANDBOX_SECRETS: Record<string, string> = {
  claude: 'anthropic',
  codex: 'openai',
};

function parseSandboxArguments(argumentsList: string[], homeDirectory: string): SandboxOptions {
  const parsedOptions: Omit<SandboxOptions, 'subcommand' | 'template'> & {
    subcommand: SandboxOptions['subcommand'] | null;
    template: string | null;
  } = {
    subcommand: null,
    workspace: null,
    agent: 'claude',
    name: null,
    port: 3001,
    template: null,
    environmentVariables: [],
  };
  const subcommands: SandboxOptions['subcommand'][] = [
    'ls',
    'stop',
    'start',
    'rm',
    'logs',
    'help',
  ];

  for (let argumentIndex = 0; argumentIndex < argumentsList.length; argumentIndex += 1) {
    const argument = argumentsList[argumentIndex];
    if (argumentIndex === 0 && subcommands.includes(argument as SandboxOptions['subcommand'])) {
      parsedOptions.subcommand = argument as SandboxOptions['subcommand'];
    } else if (argument === '--agent' || argument === '-a') {
      parsedOptions.agent = argumentsList[++argumentIndex];
    } else if (argument === '--name' || argument === '-n') {
      parsedOptions.name = argumentsList[++argumentIndex];
    } else if (argument === '--port') {
      parsedOptions.port = Number.parseInt(argumentsList[++argumentIndex], 10);
    } else if (argument === '--template' || argument === '-t') {
      parsedOptions.template = argumentsList[++argumentIndex];
    } else if (argument === '--env' || argument === '-e') {
      parsedOptions.environmentVariables.push(argumentsList[++argumentIndex]);
    } else if (!argument.startsWith('-')) {
      if (!parsedOptions.subcommand) {
        parsedOptions.workspace = argument;
      } else {
        parsedOptions.name = argument;
      }
    }
  }

  const subcommand = parsedOptions.subcommand ?? 'create';
  const expandedWorkspace = parsedOptions.workspace?.replace(/^~/, homeDirectory) ?? null;
  const name = parsedOptions.name
    ?? (expandedWorkspace ? path.basename(path.resolve(expandedWorkspace)) : null);
  const template = parsedOptions.template
    ?? SANDBOX_TEMPLATES[parsedOptions.agent]
    ?? SANDBOX_TEMPLATES.claude;

  return { ...parsedOptions, subcommand, name, template };
}

function readCommandError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const commandError = error as Error & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  return String(commandError.stdout || commandError.stderr || commandError.message || '');
}

function showSandboxHelp(output: CliOutput): void {
  output.log(`
${terminalTextStyles.bright('CloudCLI Sandbox')} — Run CloudCLI inside Docker Sandboxes

Usage:
  cloudcli sandbox <workspace>            Create and start a sandbox
  cloudcli sandbox <subcommand> [name]    Manage sandboxes

Subcommands:
  ${terminalTextStyles.bright('(default)')}    Create a sandbox and start the web UI
  ${terminalTextStyles.bright('ls')}           List all sandboxes
  ${terminalTextStyles.bright('start')}        Restart a stopped sandbox and re-launch the web UI
  ${terminalTextStyles.bright('stop')}         Stop a sandbox (preserves state)
  ${terminalTextStyles.bright('rm')}           Remove a sandbox
  ${terminalTextStyles.bright('logs')}         Show CloudCLI server logs
  ${terminalTextStyles.bright('help')}         Show this help

Options:
  -a, --agent <agent>       Agent to use: claude, codex (default: claude)
  -n, --name <name>         Sandbox name (default: derived from workspace folder)
  -t, --template <image>    Custom template image
  -e, --env <KEY=VALUE>     Set environment variable (repeatable)
      --port <port>         Host port for the web UI (default: 3001)

Examples:
  $ cloudcli sandbox ~/my-project
  $ cloudcli sandbox ~/my-project --agent codex --port 8080
  $ cloudcli sandbox ~/my-project --env SERVER_PORT=8080 --env HOST=0.0.0.0
  $ cloudcli sandbox ls
  $ cloudcli sandbox stop my-project
  $ cloudcli sandbox start my-project
  $ cloudcli sandbox rm my-project

Prerequisites:
  1. Install sbx CLI: https://docs.docker.com/ai/sandboxes/get-started/
  2. Authenticate and store your API key:
       sbx login
       sbx secret set -g anthropic   # for Claude
       sbx secret set -g openai      # for Codex

Advanced usage:
  For branch mode, multiple workspaces, memory limits, network policies,
  or passing prompts to the agent, use sbx directly with the template:

    sbx run --template docker.io/cloudcliai/sandbox:claude-code claude ~/my-project --branch my-feature
    sbx run --template docker.io/cloudcliai/sandbox:claude-code claude ~/project ~/libs:ro --memory 8g

  Full Docker Sandboxes docs: https://docs.docker.com/ai/sandboxes/usage/
`);
}

function requireSandboxName(options: SandboxOptions, output: CliOutput): string | null {
  if (options.name) {
    return options.name;
  }

  output.error(`\n${terminalTextStyles.error('❌')} Sandbox name required: cloudcli sandbox ${options.subcommand} <name>\n`);
  return null;
}

function publishSandboxPort(
  options: SandboxOptions,
  dependencies: SandboxServiceDependencies,
): boolean {
  const sandboxName = options.name as string;
  dependencies.output.log(`${terminalTextStyles.info('▶')} Forwarding port ${options.port} → 3001...`);
  try {
    dependencies.runSandboxCommand(
      ['ports', sandboxName, '--publish', `${options.port}:3001`],
    );
    return true;
  } catch (error) {
    const errorMessage = readCommandError(error);
    if (!errorMessage.includes('address already in use')) {
      throw error;
    }

    const alternativePort = options.port + 1;
    dependencies.output.log(
      `${terminalTextStyles.warn('⚠')}  Port ${options.port} in use, trying ${alternativePort}...`,
    );
    try {
      dependencies.runSandboxCommand(
        ['ports', sandboxName, '--publish', `${alternativePort}:3001`],
      );
      options.port = alternativePort;
      return true;
    } catch {
      dependencies.output.error(
        `${terminalTextStyles.error('❌')} Ports ${options.port} and ${alternativePort} both in use. Use --port to specify a free port.`,
      );
      return false;
    }
  }
}

/**
 * Creates the Sandbox command service used by the CLI composition root and
 * focused unit tests. Filesystem, subprocess, clock, home, and output access are
 * all required adapters so the service has no production singleton fallbacks.
 */
export function createSandboxCommandService(
  dependencies: SandboxServiceDependencies,
): SandboxCommandService {
  return {
    async execute(argumentsList) {
      const options = parseSandboxArguments(argumentsList, dependencies.homeDirectory);
      if (options.subcommand === 'help') {
        showSandboxHelp(dependencies.output);
        return 0;
      }

      if (options.name && !/^[\w-]+$/.test(options.name)) {
        dependencies.output.error(
          `\n${terminalTextStyles.error('❌')} Invalid sandbox name: ${options.name}`,
        );
        dependencies.output.log('   Names may only contain letters, numbers, hyphens, and underscores.\n');
        return 1;
      }

      try {
        dependencies.runSandboxCommand(['version']);
      } catch {
        dependencies.output.error(
          `\n${terminalTextStyles.error('❌')} ${terminalTextStyles.bright('sbx')} CLI not found.\n`,
        );
        dependencies.output.log(`   Install it from: ${terminalTextStyles.info('https://docs.docker.com/ai/sandboxes/get-started/')}`);
        dependencies.output.log(`   Then run: ${terminalTextStyles.bright('sbx login')}`);
        dependencies.output.log(`   And store your API key: ${terminalTextStyles.bright('sbx secret set -g anthropic')}\n`);
        return 1;
      }

      switch (options.subcommand) {
        case 'ls':
          dependencies.runSandboxCommand(['ls'], true);
          return 0;

        case 'stop':
        case 'rm': {
          const sandboxName = requireSandboxName(options, dependencies.output);
          if (!sandboxName) {
            return 1;
          }
          dependencies.runSandboxCommand([options.subcommand, sandboxName], true);
          return 0;
        }

        case 'logs': {
          const sandboxName = requireSandboxName(options, dependencies.output);
          if (!sandboxName) {
            return 1;
          }
          try {
            dependencies.runSandboxCommand(
              ['exec', sandboxName, 'bash', '-c', 'cat /tmp/cloudcli-ui.log'],
              true,
            );
          } catch (error) {
            dependencies.output.error(
              `\n${terminalTextStyles.error('❌')} Could not read logs: ${readCommandError(error) || 'Is the sandbox running?'}\n`,
            );
          }
          return 0;
        }

        case 'start': {
          const sandboxName = requireSandboxName(options, dependencies.output);
          if (!sandboxName) {
            return 1;
          }
          dependencies.output.log(
            `\n${terminalTextStyles.info('▶')} Starting sandbox ${terminalTextStyles.bright(sandboxName)}...`,
          );
          dependencies.spawnDetachedSandbox(['run', sandboxName]);
          await dependencies.wait(5_000);
          dependencies.output.log(`${terminalTextStyles.info('▶')} Launching CloudCLI web server...`);
          dependencies.runSandboxCommand([
            'exec',
            sandboxName,
            'bash',
            '-c',
            'nohup cloudcli start --port 3001 > /tmp/cloudcli-ui.log 2>&1 & disown',
          ]);
          if (!publishSandboxPort(options, dependencies)) {
            return 1;
          }
          dependencies.output.log(`\n${terminalTextStyles.ok('✔')} ${terminalTextStyles.bright('CloudCLI is ready!')}`);
          dependencies.output.log(`  ${terminalTextStyles.info('→')} ${terminalTextStyles.bright(`http://localhost:${options.port}`)}\n`);
          return 0;
        }

        case 'create': {
          if (!options.workspace) {
            dependencies.output.error(
              `\n${terminalTextStyles.error('❌')} Workspace path required: cloudcli sandbox <path>\n`,
            );
            dependencies.output.log(`   Example: ${terminalTextStyles.bright('cloudcli sandbox ~/my-project')}\n`);
            return 1;
          }

          const workspace = options.workspace.startsWith('~')
            ? options.workspace.replace(/^~/, dependencies.homeDirectory)
            : path.resolve(options.workspace);
          if (!dependencies.fileSystem.pathExists(workspace)) {
            dependencies.output.error(
              `\n${terminalTextStyles.error('❌')} Workspace path not found: ${terminalTextStyles.dim(workspace)}\n`,
            );
            return 1;
          }

          const sandboxName = options.name as string;
          const secret = SANDBOX_SECRETS[options.agent] || 'anthropic';
          try {
            const secretList = dependencies.runSandboxCommand(['secret', 'ls']);
            if (!secretList.includes(secret)) {
              dependencies.output.error(
                `\n${terminalTextStyles.error('❌')} No ${terminalTextStyles.bright(secret)} API key found.\n`,
              );
              dependencies.output.log(`   Run: ${terminalTextStyles.bright(`sbx secret set -g ${secret}`)}\n`);
              return 1;
            }
          } catch {
            // Older sbx versions may not expose `secret ls`; creation can still
            // proceed and let sbx report a credential error itself.
          }

          dependencies.output.log(`\n${terminalTextStyles.bright('CloudCLI Sandbox')}`);
          dependencies.output.log(terminalTextStyles.dim('─'.repeat(50)));
          dependencies.output.log(`  Agent:     ${terminalTextStyles.info(options.agent)} ${terminalTextStyles.dim(`(${secret} credentials)`)}`);
          dependencies.output.log(`  Workspace: ${terminalTextStyles.dim(workspace)}`);
          dependencies.output.log(`  Name:      ${terminalTextStyles.dim(sandboxName)}`);
          dependencies.output.log(`  Template:  ${terminalTextStyles.dim(options.template)}`);
          dependencies.output.log(`  Port:      ${terminalTextStyles.dim(String(options.port))}`);
          if (options.environmentVariables.length > 0) {
            dependencies.output.log(`  Env:       ${terminalTextStyles.dim(options.environmentVariables.join(', '))}`);
          }
          dependencies.output.log(terminalTextStyles.dim('─'.repeat(50)));

          dependencies.output.log(
            `\n${terminalTextStyles.info('▶')} Creating sandbox ${terminalTextStyles.bright(sandboxName)}...`,
          );
          dependencies.spawnDetachedSandbox([
            'run',
            '--template',
            options.template,
            '--name',
            sandboxName,
            options.agent,
            workspace,
          ]);
          await dependencies.wait(5_000);

          if (options.environmentVariables.length > 0) {
            dependencies.output.log(`${terminalTextStyles.info('▶')} Setting environment variables...`);
            const validEnvironmentVariables = options.environmentVariables
              .filter((environmentVariable) => /^\w+=.+$/.test(environmentVariable));
            const exports = validEnvironmentVariables
              .map((environmentVariable) => `export ${environmentVariable}`)
              .join('\n');
            if (exports) {
              dependencies.runSandboxCommand([
                'exec',
                sandboxName,
                'bash',
                '-c',
                `echo '${exports}' >> /etc/sandbox-persistent.sh`,
              ]);
            }
            const invalidEnvironmentVariables = options.environmentVariables
              .filter((environmentVariable) => !/^\w+=.+$/.test(environmentVariable));
            if (invalidEnvironmentVariables.length > 0) {
              dependencies.output.log(
                `${terminalTextStyles.warn('⚠')}  Skipped invalid env vars: ${invalidEnvironmentVariables.join(', ')} (expected KEY=VALUE)`,
              );
            }
          }

          dependencies.output.log(`${terminalTextStyles.info('▶')} Launching CloudCLI web server...`);
          dependencies.runSandboxCommand([
            'exec',
            sandboxName,
            'bash',
            '-c',
            'nohup cloudcli start --port 3001 > /tmp/cloudcli-ui.log 2>&1 & disown',
          ]);
          if (!publishSandboxPort(options, dependencies)) {
            return 1;
          }

          dependencies.output.log(`\n${terminalTextStyles.ok('✔')} ${terminalTextStyles.bright('CloudCLI is ready!')}`);
          dependencies.output.log(`  ${terminalTextStyles.info('→')} Open ${terminalTextStyles.bright(`http://localhost:${options.port}`)}`);
          dependencies.output.log(`\n${terminalTextStyles.dim('  Manage with:')}`);
          dependencies.output.log(`  ${terminalTextStyles.dim('$')} sbx ls`);
          dependencies.output.log(`  ${terminalTextStyles.dim('$')} sbx stop ${sandboxName}`);
          dependencies.output.log(`  ${terminalTextStyles.dim('$')} sbx start ${sandboxName}`);
          dependencies.output.log(`  ${terminalTextStyles.dim('$')} sbx rm ${sandboxName}`);
          dependencies.output.log(`\n${terminalTextStyles.dim('  Or install globally:')} npm install -g @cloudcli-ai/cloudcli\n`);
          return 0;
        }

        default:
          showSandboxHelp(dependencies.output);
          return 0;
      }
    },
  };
}
