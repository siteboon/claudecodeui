import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Recursively scan directory for command files (.md)
 * @param {string} dir - Directory to scan
 * @param {string} baseDir - Base directory for relative paths
 * @param {string} namespace - Namespace for commands (e.g., 'project', 'user')
 * @returns {Promise<Array>} Array of command objects
 */
async function scanCommandsDirectory(dir, baseDir, namespace) {
  const commands = [];

  try {
    // Check if directory exists
    await fs.access(dir);

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subCommands = await scanCommandsDirectory(fullPath, baseDir, namespace);
        commands.push(...subCommands);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Parse markdown file for metadata
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const { data: frontmatter, content: commandContent } = matter(content);

          // Calculate relative path from baseDir for command name
          const relativePath = path.relative(baseDir, fullPath);
          // Remove .md extension and convert to command name
          const commandName = '/' + relativePath.replace(/\.md$/, '').replace(/\\/g, '/');

          // Extract description from frontmatter or first line of content
          let description = frontmatter.description || '';
          if (!description) {
            const firstLine = commandContent.trim().split('\n')[0];
            description = firstLine.replace(/^#+\s*/, '').trim();
          }

          commands.push({
            name: commandName,
            path: fullPath,
            relativePath,
            description,
            namespace,
            metadata: frontmatter
          });
        } catch (err) {
          console.error(`Error parsing command file ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be accessed - this is okay
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.error(`Error scanning directory ${dir}:`, err.message);
    }
  }

  return commands;
}

/**
 * Built-in commands that are always available
 */
const builtInCommands = [
  {
    name: '/help',
    description: 'Show help documentation for Claude Code',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/clear',
    description: 'Clear the conversation history',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/model',
    description: 'Switch or view the current AI model',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/cost',
    description: 'Display token usage and cost information',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/memory',
    description: 'Open CLAUDE.md memory file for editing',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/config',
    description: 'Open settings and configuration',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/status',
    description: 'Show system status and version information',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/rewind',
    description: 'Rewind the conversation to a previous state',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  }
];

/**
 * Built-in command handlers
 * Each handler returns { type: 'builtin', action: string, data: any }
 */
const builtInHandlers = {
  '/help': async (args, context) => {
    const helpText = `# Claude Code Commands

## Built-in Commands

${builtInCommands.map(cmd => `### ${cmd.name}
${cmd.description}
`).join('\n')}

## Custom Commands

Custom commands can be created in:
- Project: \`.claude/commands/\` (project-specific)
- User: \`~/.claude/commands/\` (available in all projects)

### Command Syntax

- **Arguments**: Use \`$ARGUMENTS\` for all args or \`$1\`, \`$2\`, etc. for positional
- **File Includes**: Use \`@filename\` to include file contents
- **Bash Commands**: Use \`!command\` to execute bash commands

### Examples

\`\`\`markdown
/mycommand arg1 arg2
\`\`\`
`;

    return {
      type: 'builtin',
      action: 'help',
      data: {
        content: helpText,
        format: 'markdown'
      }
    };
  },

  '/clear': async (args, context) => {
    return {
      type: 'builtin',
      action: 'clear',
      data: {
        message: 'Conversation history cleared'
      }
    };
  },

  '/model': async (args, context) => {
    // Read available models from config or defaults
    const availableModels = {
      claude: [
        'claude-sonnet-4.5',
        'claude-sonnet-4',
        'claude-opus-4',
        'claude-sonnet-3.5'
      ],
      cursor: [
        'gpt-5',
        'sonnet-4',
        'opus-4.1'
      ]
    };

    const currentProvider = context?.provider || 'claude';
    const currentModel = context?.model || 'claude-sonnet-4.5';

    return {
      type: 'builtin',
      action: 'model',
      data: {
        current: {
          provider: currentProvider,
          model: currentModel
        },
        available: availableModels,
        message: args.length > 0
          ? `Switching to model: ${args[0]}`
          : `Current model: ${currentModel}`
      }
    };
  },

  '/cost': async (args, context) => {
    // Calculate token usage and cost
    const sessionId = context?.sessionId;
    const tokenUsage = context?.tokenUsage || { used: 0, total: 200000 };

    const costPerMillion = {
      'claude-sonnet-4.5': { input: 3, output: 15 },
      'claude-sonnet-4': { input: 3, output: 15 },
      'claude-opus-4': { input: 15, output: 75 },
      'gpt-5': { input: 5, output: 15 }
    };

    const model = context?.model || 'claude-sonnet-4.5';
    const rates = costPerMillion[model] || costPerMillion['claude-sonnet-4.5'];

    // Estimate 70% input, 30% output
    const estimatedInputTokens = Math.floor(tokenUsage.used * 0.7);
    const estimatedOutputTokens = Math.floor(tokenUsage.used * 0.3);

    const inputCost = (estimatedInputTokens / 1000000) * rates.input;
    const outputCost = (estimatedOutputTokens / 1000000) * rates.output;
    const totalCost = inputCost + outputCost;

    return {
      type: 'builtin',
      action: 'cost',
      data: {
        tokenUsage: {
          used: tokenUsage.used,
          total: tokenUsage.total,
          percentage: ((tokenUsage.used / tokenUsage.total) * 100).toFixed(1)
        },
        cost: {
          input: inputCost.toFixed(4),
          output: outputCost.toFixed(4),
          total: totalCost.toFixed(4),
          currency: 'USD'
        },
        model,
        rates
      }
    };
  },

  '/status': async (args, context) => {
    // Read version from package.json
    const packageJsonPath = path.join(path.dirname(__dirname), '..', 'package.json');
    let version = 'unknown';
    let packageName = 'claude-code-ui';

    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      version = packageJson.version;
      packageName = packageJson.name;
    } catch (err) {
      console.error('Error reading package.json:', err);
    }

    const uptime = process.uptime();
    const uptimeMinutes = Math.floor(uptime / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeFormatted = uptimeHours > 0
      ? `${uptimeHours}h ${uptimeMinutes % 60}m`
      : `${uptimeMinutes}m`;

    return {
      type: 'builtin',
      action: 'status',
      data: {
        version,
        packageName,
        uptime: uptimeFormatted,
        uptimeSeconds: Math.floor(uptime),
        model: context?.model || 'claude-sonnet-4.5',
        provider: context?.provider || 'claude',
        nodeVersion: process.version,
        platform: process.platform
      }
    };
  },

  '/memory': async (args, context) => {
    const projectPath = context?.projectPath;

    if (!projectPath) {
      return {
        type: 'builtin',
        action: 'memory',
        data: {
          error: 'No project selected',
          message: 'Please select a project to access its CLAUDE.md file'
        }
      };
    }

    const claudeMdPath = path.join(projectPath, 'CLAUDE.md');

    // Check if CLAUDE.md exists
    let exists = false;
    try {
      await fs.access(claudeMdPath);
      exists = true;
    } catch (err) {
      // File doesn't exist
    }

    return {
      type: 'builtin',
      action: 'memory',
      data: {
        path: claudeMdPath,
        exists,
        message: exists
          ? `Opening CLAUDE.md at ${claudeMdPath}`
          : `CLAUDE.md not found at ${claudeMdPath}. Create it to store project-specific instructions.`
      }
    };
  },

  '/config': async (args, context) => {
    return {
      type: 'builtin',
      action: 'config',
      data: {
        message: 'Opening settings...'
      }
    };
  },

  '/rewind': async (args, context) => {
    const steps = args[0] ? parseInt(args[0]) : 1;

    if (isNaN(steps) || steps < 1) {
      return {
        type: 'builtin',
        action: 'rewind',
        data: {
          error: 'Invalid steps parameter',
          message: 'Usage: /rewind [number] - Rewind conversation by N steps (default: 1)'
        }
      };
    }

    return {
      type: 'builtin',
      action: 'rewind',
      data: {
        steps,
        message: `Rewinding conversation by ${steps} step${steps > 1 ? 's' : ''}...`
      }
    };
  }
};

/**
 * POST /api/commands/list
 * List all available commands from project and user directories
 */
router.post('/list', async (req, res) => {
  try {
    const { projectPath } = req.body;
    const allCommands = [...builtInCommands];

    // Scan project-level commands (.claude/commands/)
    if (projectPath) {
      const projectCommandsDir = path.join(projectPath, '.claude', 'commands');
      const projectCommands = await scanCommandsDirectory(
        projectCommandsDir,
        projectCommandsDir,
        'project'
      );
      allCommands.push(...projectCommands);
    }

    // Scan user-level commands (~/.claude/commands/)
    const homeDir = os.homedir();
    const userCommandsDir = path.join(homeDir, '.claude', 'commands');
    const userCommands = await scanCommandsDirectory(
      userCommandsDir,
      userCommandsDir,
      'user'
    );
    allCommands.push(...userCommands);

    // Separate built-in and custom commands
    const customCommands = allCommands.filter(cmd => cmd.namespace !== 'builtin');

    // Sort commands alphabetically by name
    customCommands.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      builtIn: builtInCommands,
      custom: customCommands,
      count: allCommands.length
    });
  } catch (error) {
    console.error('Error listing commands:', error);
    res.status(500).json({
      error: 'Failed to list commands',
      message: error.message
    });
  }
});

/**
 * POST /api/commands/load
 * Load a specific command file and return its content and metadata
 */
router.post('/load', async (req, res) => {
  try {
    const { commandPath } = req.body;

    if (!commandPath) {
      return res.status(400).json({
        error: 'Command path is required'
      });
    }

    // Security: Prevent path traversal
    const resolvedPath = path.resolve(commandPath);
    if (!resolvedPath.startsWith(path.resolve(os.homedir())) &&
        !resolvedPath.includes('.claude/commands')) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Command must be in .claude/commands directory'
      });
    }

    // Read and parse the command file
    const content = await fs.readFile(commandPath, 'utf8');
    const { data: metadata, content: commandContent } = matter(content);

    res.json({
      path: commandPath,
      metadata,
      content: commandContent
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Command not found',
        message: `Command file not found: ${req.body.commandPath}`
      });
    }

    console.error('Error loading command:', error);
    res.status(500).json({
      error: 'Failed to load command',
      message: error.message
    });
  }
});

/**
 * POST /api/commands/execute
 * Execute a command with argument replacement
 * This endpoint prepares the command content but doesn't execute bash commands yet
 * (that will be handled in the command parser utility)
 */
router.post('/execute', async (req, res) => {
  try {
    const { commandName, commandPath, args = [], context = {} } = req.body;

    if (!commandName) {
      return res.status(400).json({
        error: 'Command name is required'
      });
    }

    // Handle built-in commands
    const handler = builtInHandlers[commandName];
    if (handler) {
      try {
        const result = await handler(args, context);
        return res.json({
          ...result,
          command: commandName
        });
      } catch (error) {
        console.error(`Error executing built-in command ${commandName}:`, error);
        return res.status(500).json({
          error: 'Command execution failed',
          message: error.message,
          command: commandName
        });
      }
    }

    // Handle custom commands
    if (!commandPath) {
      return res.status(400).json({
        error: 'Command path is required for custom commands'
      });
    }

    // Load command content
    // Security: validate commandPath is within allowed directories
    {
      const resolvedPath = path.resolve(commandPath);
      const userBase = path.resolve(path.join(os.homedir(), '.claude', 'commands'));
      const projectBase = context?.projectPath
        ? path.resolve(path.join(context.projectPath, '.claude', 'commands'))
        : null;
      const isUnder = (base) => {
        const rel = path.relative(base, resolvedPath);
        return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      };
      if (!(isUnder(userBase) || (projectBase && isUnder(projectBase)))) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Command must be in .claude/commands directory'
        });
      }
    }
    const content = await fs.readFile(commandPath, 'utf8');
    const { data: metadata, content: commandContent } = matter(content);
    // Basic argument replacement (will be enhanced in command parser utility)
    let processedContent = commandContent;

    // Replace $ARGUMENTS with all arguments joined
    const argsString = args.join(' ');
    processedContent = processedContent.replace(/\$ARGUMENTS/g, argsString);

    // Replace $1, $2, etc. with positional arguments
    args.forEach((arg, index) => {
      const placeholder = `$${index + 1}`;
      processedContent = processedContent.replace(new RegExp(`\\${placeholder}\\b`, 'g'), arg);
    });

    res.json({
      type: 'custom',
      command: commandName,
      content: processedContent,
      metadata,
      hasFileIncludes: processedContent.includes('@'),
      hasBashCommands: processedContent.includes('!')
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Command not found',
        message: `Command file not found: ${req.body.commandPath}`
      });
    }

    console.error('Error executing command:', error);
    res.status(500).json({
      error: 'Failed to execute command',
      message: error.message
    });
  }
});

export default router;
