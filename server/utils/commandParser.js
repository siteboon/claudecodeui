import matter from 'gray-matter';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const MAX_INCLUDE_DEPTH = 3;
const BASH_TIMEOUT = 30000; // 30 seconds
const BASH_COMMAND_ALLOWLIST = [
  'echo',
  'ls',
  'pwd',
  'date',
  'whoami',
  'git',
  'npm',
  'node',
  'cat',
  'grep',
  'find',
  'task-master'
];

/**
 * Parse a markdown command file and extract frontmatter and content
 * @param {string} content - Raw markdown content
 * @returns {object} Parsed command with data (frontmatter) and content
 */
export function parseCommand(content) {
  try {
    const parsed = matter(content);
    return {
      data: parsed.data || {},
      content: parsed.content || '',
      raw: content
    };
  } catch (error) {
    throw new Error(`Failed to parse command: ${error.message}`);
  }
}

/**
 * Replace argument placeholders in content
 * @param {string} content - Content with placeholders
 * @param {string|array} args - Arguments to replace (string or array)
 * @returns {string} Content with replaced arguments
 */
export function replaceArguments(content, args) {
  if (!content) return content;

  let result = content;

  // Convert args to array if it's a string
  const argsArray = Array.isArray(args) ? args : (args ? [args] : []);

  // Replace $ARGUMENTS with all arguments joined by space
  const allArgs = argsArray.join(' ');
  result = result.replace(/\$ARGUMENTS/g, allArgs);

  // Replace positional arguments $1-$9
  for (let i = 1; i <= 9; i++) {
    const regex = new RegExp(`\\$${i}`, 'g');
    const value = argsArray[i - 1] || '';
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * Validate file path to prevent directory traversal
 * @param {string} filePath - Path to validate
 * @param {string} basePath - Base directory path
 * @returns {boolean} True if path is safe
 */
export function isPathSafe(filePath, basePath) {
  const resolvedPath = path.resolve(basePath, filePath);
  const resolvedBase = path.resolve(basePath);
  return resolvedPath.startsWith(resolvedBase);
}

/**
 * Process file includes in content (@filename syntax)
 * @param {string} content - Content with @filename includes
 * @param {string} basePath - Base directory for resolving file paths
 * @param {number} depth - Current recursion depth
 * @returns {Promise<string>} Content with includes resolved
 */
export async function processFileIncludes(content, basePath, depth = 0) {
  if (!content) return content;

  // Prevent infinite recursion
  if (depth >= MAX_INCLUDE_DEPTH) {
    throw new Error(`Maximum include depth (${MAX_INCLUDE_DEPTH}) exceeded`);
  }

  // Match @filename patterns (at start of line or after whitespace)
  const includePattern = /(?:^|\s)@([^\s]+)/gm;
  const matches = [...content.matchAll(includePattern)];

  if (matches.length === 0) {
    return content;
  }

  let result = content;

  for (const match of matches) {
    const fullMatch = match[0];
    const filename = match[1];

    // Security: prevent directory traversal
    if (!isPathSafe(filename, basePath)) {
      throw new Error(`Invalid file path (directory traversal detected): ${filename}`);
    }

    try {
      const filePath = path.resolve(basePath, filename);
      const fileContent = await fs.readFile(filePath, 'utf-8');

      // Recursively process includes in the included file
      const processedContent = await processFileIncludes(fileContent, basePath, depth + 1);

      // Replace the @filename with the file content
      result = result.replace(fullMatch, fullMatch.startsWith(' ') ? ' ' + processedContent : processedContent);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filename}`);
      }
      throw error;
    }
  }

  return result;
}

/**
 * Validate bash command against allowlist
 * @param {string} command - Command to validate
 * @returns {boolean} True if command is allowed
 */
export function isBashCommandAllowed(command) {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return false;

  // Extract the first word (the actual command)
  const firstWord = trimmedCommand.split(/\s+/)[0];

  // Check if it's in the allowlist
  return BASH_COMMAND_ALLOWLIST.some(allowed =>
    firstWord === allowed || firstWord.startsWith(allowed + '/')
  );
}

/**
 * Sanitize bash command output
 * @param {string} output - Raw command output
 * @returns {string} Sanitized output
 */
export function sanitizeOutput(output) {
  if (!output) return '';

  // Remove control characters except \t, \n, \r
  return [...output]
    .filter(ch => {
      const code = ch.charCodeAt(0);
      return code === 9  // \t
          || code === 10 // \n
          || code === 13 // \r
          || (code >= 32 && code !== 127);
    })
    .join('');
}

/**
 * Process bash commands in content (!command syntax)
 * @param {string} content - Content with !command syntax
 * @param {object} options - Options for bash execution
 * @returns {Promise<string>} Content with bash commands executed and replaced
 */
export async function processBashCommands(content, options = {}) {
  if (!content) return content;

  const { cwd = process.cwd(), timeout = BASH_TIMEOUT } = options;

  // Match !command patterns (at start of line or after whitespace)
  const commandPattern = /(?:^|\n)!(.+?)(?=\n|$)/g;
  const matches = [...content.matchAll(commandPattern)];

  if (matches.length === 0) {
    return content;
  }

  let result = content;

  for (const match of matches) {
    const fullMatch = match[0];
    const command = match[1].trim();

    // Security: validate command against allowlist
    if (!isBashCommandAllowed(command)) {
      throw new Error(`Command not allowed: ${command}`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB max output
        shell: '/bin/bash'
      });

      const output = sanitizeOutput(stdout || stderr || '');

      // Replace the !command with the output
      result = result.replace(fullMatch, fullMatch.startsWith('\n') ? '\n' + output : output);
    } catch (error) {
      if (error.killed) {
        throw new Error(`Command timeout: ${command}`);
      }
      throw new Error(`Command failed: ${command} - ${error.message}`);
    }
  }

  return result;
}
