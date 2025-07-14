import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn } from 'child_process';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Direct configuration reading routes

// GET /api/mcp/servers - Get MCP servers from Claude configuration file
router.get('/servers', async (req, res) => {
  try {
    const { scope = 'user' } = req.query;
    console.log('📋 Reading MCP servers from Claude configuration');
    
    // Get the Claude configuration path
    // Try multiple locations for better Docker compatibility
    const possiblePaths = [
      // Direct file mount in Docker
      '/home/user/.claude.json',
      // Environment variable based path
      path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '..', '.claude.json'),
      // Home directory based path
      path.join(os.homedir(), '.claude.json'),
      // Fallback to standard location
      path.join(process.env.HOME || os.homedir(), '.claude.json')
    ];
    
    let claudeConfigPath = null;
    for (const testPath of possiblePaths) {
      const exists = await fs.access(testPath).then(() => true).catch(() => false);
      if (exists) {
        claudeConfigPath = testPath;
        break;
      }
    }
    
    console.log(`🔍 Found Claude config at: ${claudeConfigPath}`);
    
    // Check if the config file exists
    if (!claudeConfigPath) {
      console.log('⚠️ Claude configuration file not found in any of the expected locations');
      console.log('🔍 Searched paths:', possiblePaths);
      return res.json({ success: true, servers: [] });
    }
    
    // Read and parse the configuration
    const configContent = await fs.readFile(claudeConfigPath, 'utf8');
    const claudeConfig = JSON.parse(configContent);
    
    const servers = [];
    
    // Extract global MCP servers
    if (claudeConfig.mcpServers && scope === 'user') {
      console.log(`✅ Found ${Object.keys(claudeConfig.mcpServers).length} global MCP servers`);
      
      for (const [name, config] of Object.entries(claudeConfig.mcpServers)) {
        // Determine server type based on configuration
        let type = 'stdio';
        if (config.url) {
          type = config.transport || 'http';
        }
        
        servers.push({
          id: name,
          name: name,
          type: type,
          scope: 'user',
          config: {
            command: config.command || '',
            args: config.args || [],
            env: config.env || {},
            url: config.url || '',
            headers: config.headers || {},
            timeout: config.timeout || 30000,
            transport: config.transport || type
          },
          created: new Date().toISOString(),
          updated: new Date().toISOString()
        });
      }
    }
    
    // Extract project-specific MCP servers if requested
    if (scope === 'project' && claudeConfig.claudeProjects) {
      const projectPath = req.query.projectPath || process.cwd();
      const projectConfig = claudeConfig.claudeProjects[projectPath];
      
      if (projectConfig && projectConfig.mcpServers) {
        console.log(`✅ Found ${Object.keys(projectConfig.mcpServers).length} project MCP servers`);
        
        for (const [name, config] of Object.entries(projectConfig.mcpServers)) {
          // Determine server type based on configuration
          let type = 'stdio';
          if (config.url) {
            type = config.transport || 'http';
          }
          
          servers.push({
            id: name,
            name: name,
            type: type,
            scope: 'project',
            config: {
              command: config.command || '',
              args: config.args || [],
              env: config.env || {},
              url: config.url || '',
              headers: config.headers || {},
              timeout: config.timeout || 30000,
              transport: config.transport || type
            },
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          });
        }
      }
    }
    
    console.log(`🔍 Returning ${servers.length} MCP servers`);
    res.json({ success: true, servers });
    
  } catch (error) {
    console.error('Error reading MCP servers from config:', error);
    res.status(500).json({ 
      error: 'Failed to read MCP servers', 
      details: error.message,
      servers: [] 
    });
  }
});

// POST /api/mcp/servers - Add MCP server directly to configuration
router.post('/servers', async (req, res) => {
  try {
    const { name, type = 'stdio', scope = 'user', config } = req.body;
    console.log('➕ Adding MCP server to configuration:', name);
    
    // Get the Claude configuration path
    const claudeConfigPath = '/home/user/.claude.json';
    
    // Read current configuration
    const configContent = await fs.readFile(claudeConfigPath, 'utf8');
    const claudeConfig = JSON.parse(configContent);
    
    // Initialize mcpServers if it doesn't exist
    if (!claudeConfig.mcpServers) {
      claudeConfig.mcpServers = {};
    }
    
    // Add the new server
    claudeConfig.mcpServers[name] = {
      command: config.command || '',
      args: config.args || [],
      env: config.env || {},
      ...config
    };
    
    // Write back the configuration
    await fs.writeFile(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
    
    console.log('✅ MCP server added successfully:', name);
    res.json({ success: true, message: 'MCP server added successfully' });
    
  } catch (error) {
    console.error('Error adding MCP server:', error);
    res.status(500).json({ 
      error: 'Failed to add MCP server', 
      details: error.message 
    });
  }
});

// DELETE /api/mcp/servers/:name - Remove MCP server from configuration
router.delete('/servers/:name', async (req, res) => {
  try {
    const { name } = req.params;
    console.log('🗑️ Removing MCP server from configuration:', name);
    
    // Get the Claude configuration path
    const claudeConfigPath = '/home/user/.claude.json';
    
    // Read current configuration
    const configContent = await fs.readFile(claudeConfigPath, 'utf8');
    const claudeConfig = JSON.parse(configContent);
    
    // Check if server exists
    if (!claudeConfig.mcpServers || !claudeConfig.mcpServers[name]) {
      return res.status(404).json({ 
        error: 'MCP server not found', 
        details: `Server '${name}' does not exist` 
      });
    }
    
    // Remove the server
    delete claudeConfig.mcpServers[name];
    
    // Write back the configuration
    await fs.writeFile(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
    
    console.log('✅ MCP server removed successfully:', name);
    res.json({ success: true, message: 'MCP server removed successfully' });
    
  } catch (error) {
    console.error('Error removing MCP server:', error);
    res.status(500).json({ 
      error: 'Failed to remove MCP server', 
      details: error.message 
    });
  }
});

// Claude CLI command routes

// GET /api/mcp/cli/list - List MCP servers using Claude CLI
router.get('/cli/list', async (req, res) => {
  try {
    console.log('📋 Listing MCP servers using Claude CLI');
    
    const { spawn } = await import('child_process');
    const { promisify } = await import('util');
    const exec = promisify(spawn);
    
    const process = spawn('claude', ['mcp', 'list', '-s', 'user'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        res.json({ success: true, output: stdout, servers: parseClaudeListOutput(stdout) });
      } else {
        console.error('Claude CLI error:', stderr);
        res.status(500).json({ error: 'Claude CLI command failed', details: stderr });
      }
    });
    
    process.on('error', (error) => {
      console.error('Error running Claude CLI:', error);
      res.status(500).json({ error: 'Failed to run Claude CLI', details: error.message });
    });
  } catch (error) {
    console.error('Error listing MCP servers via CLI:', error);
    res.status(500).json({ error: 'Failed to list MCP servers', details: error.message });
  }
});

// POST /api/mcp/cli/add - Add MCP server using Claude CLI
router.post('/cli/add', async (req, res) => {
  try {
    const { name, type = 'stdio', command, args = [], url, headers = {}, env = {} } = req.body;
    
    console.log('➕ Adding MCP server using Claude CLI:', name);
    
    const { spawn } = await import('child_process');
    
    let cliArgs = ['mcp', 'add'];
    
    if (type === 'http') {
      cliArgs.push('--transport', 'http', name, '-s', 'user', url);
      // Add headers if provided
      Object.entries(headers).forEach(([key, value]) => {
        cliArgs.push('--header', `${key}: ${value}`);
      });
    } else if (type === 'sse') {
      cliArgs.push('--transport', 'sse', name, '-s', 'user', url);
      // Add headers if provided
      Object.entries(headers).forEach(([key, value]) => {
        cliArgs.push('--header', `${key}: ${value}`);
      });
    } else {
      // stdio (default): claude mcp add <name> -s user <command> [args...]
      cliArgs.push(name, '-s', 'user');
      // Add environment variables
      Object.entries(env).forEach(([key, value]) => {
        cliArgs.push('-e', `${key}=${value}`);
      });
      cliArgs.push(command);
      if (args && args.length > 0) {
        cliArgs.push(...args);
      }
    }
    
    console.log('🔧 Running Claude CLI command:', 'claude', cliArgs.join(' '));
    
    const process = spawn('claude', cliArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        res.json({ success: true, output: stdout, message: `MCP server "${name}" added successfully` });
      } else {
        console.error('Claude CLI error:', stderr);
        res.status(400).json({ error: 'Claude CLI command failed', details: stderr });
      }
    });
    
    process.on('error', (error) => {
      console.error('Error running Claude CLI:', error);
      res.status(500).json({ error: 'Failed to run Claude CLI', details: error.message });
    });
  } catch (error) {
    console.error('Error adding MCP server via CLI:', error);
    res.status(500).json({ error: 'Failed to add MCP server', details: error.message });
  }
});

// DELETE /api/mcp/cli/remove/:name - Remove MCP server using Claude CLI
router.delete('/cli/remove/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    console.log('🗑️ Removing MCP server using Claude CLI:', name);
    
    const { spawn } = await import('child_process');
    
    const process = spawn('claude', ['mcp', 'remove', '-s', 'user', name], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        res.json({ success: true, output: stdout, message: `MCP server "${name}" removed successfully` });
      } else {
        console.error('Claude CLI error:', stderr);
        res.status(400).json({ error: 'Claude CLI command failed', details: stderr });
      }
    });
    
    process.on('error', (error) => {
      console.error('Error running Claude CLI:', error);
      res.status(500).json({ error: 'Failed to run Claude CLI', details: error.message });
    });
  } catch (error) {
    console.error('Error removing MCP server via CLI:', error);
    res.status(500).json({ error: 'Failed to remove MCP server', details: error.message });
  }
});

// GET /api/mcp/cli/get/:name - Get MCP server details using Claude CLI
router.get('/cli/get/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    console.log('📄 Getting MCP server details using Claude CLI:', name);
    
    const { spawn } = await import('child_process');
    
    const process = spawn('claude', ['mcp', 'get', '-s', 'user', name], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        res.json({ success: true, output: stdout, server: parseClaudeGetOutput(stdout) });
      } else {
        console.error('Claude CLI error:', stderr);
        res.status(404).json({ error: 'Claude CLI command failed', details: stderr });
      }
    });
    
    process.on('error', (error) => {
      console.error('Error running Claude CLI:', error);
      res.status(500).json({ error: 'Failed to run Claude CLI', details: error.message });
    });
  } catch (error) {
    console.error('Error getting MCP server details via CLI:', error);
    res.status(500).json({ error: 'Failed to get MCP server details', details: error.message });
  }
});

// Helper functions to parse Claude CLI output
function parseClaudeListOutput(output) {
  // Parse the output from 'claude mcp list' command
  // Format: "name: command/url" or "name: url (TYPE)"
  const servers = [];
  const lines = output.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    if (line.includes(':')) {
      const colonIndex = line.indexOf(':');
      const name = line.substring(0, colonIndex).trim();
      const rest = line.substring(colonIndex + 1).trim();
      
      let type = 'stdio'; // default type
      
      // Check if it has transport type in parentheses like "(SSE)" or "(HTTP)"
      const typeMatch = rest.match(/\((\w+)\)\s*$/);
      if (typeMatch) {
        type = typeMatch[1].toLowerCase();
      } else if (rest.startsWith('http://') || rest.startsWith('https://')) {
        // If it's a URL but no explicit type, assume HTTP
        type = 'http';
      }
      
      if (name) {
        servers.push({
          name,
          type,
          status: 'active'
        });
      }
    }
  }
  
  console.log('🔍 Parsed Claude CLI servers:', servers);
  return servers;
}

function parseClaudeGetOutput(output) {
  // Parse the output from 'claude mcp get <name>' command
  // This is a simple parser - might need adjustment based on actual output format
  try {
    // Try to extract JSON if present
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Otherwise, parse as text
    const server = { raw_output: output };
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('Name:')) {
        server.name = line.split(':')[1]?.trim();
      } else if (line.includes('Type:')) {
        server.type = line.split(':')[1]?.trim();
      } else if (line.includes('Command:')) {
        server.command = line.split(':')[1]?.trim();
      } else if (line.includes('URL:')) {
        server.url = line.split(':')[1]?.trim();
      }
    }
    
    return server;
  } catch (error) {
    return { raw_output: output, parse_error: error.message };
  }
}

export default router;