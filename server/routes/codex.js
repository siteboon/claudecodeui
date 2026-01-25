import express from 'express';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import TOML from '@iarna/toml';
import { getCodexSessions, getCodexSessionMessages, deleteCodexSession } from '../projects.js';

const router = express.Router();

function createCliResponder(res) {
  let responded = false;
  return (status, payload) => {
    if (responded || res.headersSent) {
      return;
    }
    responded = true;
    res.status(status).json(payload);
  };
}

router.get('/config', async (req, res) => {
  try {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    const content = await fs.readFile(configPath, 'utf8');
    const config = TOML.parse(content);

    res.json({
      success: true,
      config: {
        model: config.model || null,
        mcpServers: config.mcp_servers || {},
        approvalMode: config.approval_mode || 'suggest'
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.json({
        success: true,
        config: {
          model: null,
          mcpServers: {},
          approvalMode: 'suggest'
        }
      });
    } else {
      console.error('Error reading Codex config:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const { projectPath } = req.query;

    if (!projectPath) {
      return res.status(400).json({ success: false, error: 'projectPath query parameter required' });
    }

    const sessions = await getCodexSessions(projectPath);
    res.json({ success: true, sessions });
  } catch (error) {
    console.error('Error fetching Codex sessions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit, offset } = req.query;

    const result = await getCodexSessionMessages(
      sessionId,
      limit ? parseInt(limit, 10) : null,
      offset ? parseInt(offset, 10) : 0
    );

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching Codex session messages:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await deleteCodexSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error(`Error deleting Codex session ${req.params.sessionId}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// MCP Server Management Routes

router.get('/mcp/cli/list', async (req, res) => {
  try {
    const respond = createCliResponder(res);
    const proc = spawn('codex', ['mcp', 'list'], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        respond(200, { success: true, output: stdout, servers: parseCodexListOutput(stdout) });
      } else {
        respond(500, { error: 'Codex CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'Codex CLI not installed' : 'Failed to run Codex CLI',
        details: error.message,
        code: error.code
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list MCP servers', details: error.message });
  }
});

router.post('/mcp/cli/add', async (req, res) => {
  try {
    const { name, command, args = [], env = {} } = req.body;

    if (!name || !command) {
      return res.status(400).json({ error: 'name and command are required' });
    }

    // Build: codex mcp add <name> [-e KEY=VAL]... -- <command> [args...]
    let cliArgs = ['mcp', 'add', name];

    Object.entries(env).forEach(([key, value]) => {
      cliArgs.push('-e', `${key}=${value}`);
    });

    cliArgs.push('--', command);

    if (args && args.length > 0) {
      cliArgs.push(...args);
    }

    const respond = createCliResponder(res);
    const proc = spawn('codex', cliArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        respond(200, { success: true, output: stdout, message: `MCP server "${name}" added successfully` });
      } else {
        respond(400, { error: 'Codex CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'Codex CLI not installed' : 'Failed to run Codex CLI',
        details: error.message,
        code: error.code
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add MCP server', details: error.message });
  }
});

router.delete('/mcp/cli/remove/:name', async (req, res) => {
  try {
    const { name } = req.params;

    const respond = createCliResponder(res);
    const proc = spawn('codex', ['mcp', 'remove', name], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        respond(200, { success: true, output: stdout, message: `MCP server "${name}" removed successfully` });
      } else {
        respond(400, { error: 'Codex CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'Codex CLI not installed' : 'Failed to run Codex CLI',
        details: error.message,
        code: error.code
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove MCP server', details: error.message });
  }
});

router.get('/mcp/cli/get/:name', async (req, res) => {
  try {
    const { name } = req.params;

    const respond = createCliResponder(res);
    const proc = spawn('codex', ['mcp', 'get', name], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        respond(200, { success: true, output: stdout, server: parseCodexGetOutput(stdout) });
      } else {
        respond(404, { error: 'Codex CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'Codex CLI not installed' : 'Failed to run Codex CLI',
        details: error.message,
        code: error.code
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get MCP server details', details: error.message });
  }
});

router.get('/mcp/config/read', async (req, res) => {
  try {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');

    let configData = null;

    try {
      const fileContent = await fs.readFile(configPath, 'utf8');
      configData = TOML.parse(fileContent);
    } catch (error) {
      // Config file doesn't exist
    }

    if (!configData) {
      return res.json({ success: true, configPath, servers: [] });    }

    const servers = [];

    if (configData.mcp_servers && typeof configData.mcp_servers === 'object') {
      for (const [name, config] of Object.entries(configData.mcp_servers)) {
        servers.push({
          id: name,
          name: name,
          type: 'stdio',
          scope: 'user',
          config: {
            command: config.command || '',
            args: config.args || [],
            env: config.env || {}
          },
          raw: config
        });
      }
    }

    res.json({ success: true, configPath, servers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read Codex configuration', details: error.message });
  }
});

function parseCodexListOutput(output) {
  const servers = [];
  const lines = output.split('\n').filter(line => line.trim());

  for (const line of lines) {
    if (line.includes(':')) {
      const colonIndex = line.indexOf(':');
      const name = line.substring(0, colonIndex).trim();

      if (!name) continue;

      const rest = line.substring(colonIndex + 1).trim();
      let description = rest;
      let status = 'unknown';

      if (rest.includes('✓') || rest.includes('✗')) {
        const statusMatch = rest.match(/(.*?)\s*-\s*([✓✗].*)$/);
        if (statusMatch) {
          description = statusMatch[1].trim();
          status = statusMatch[2].includes('✓') ? 'connected' : 'failed';
        }
      }

      servers.push({ name, type: 'stdio', status, description });
    }
  }

  return servers;
}

function parseCodexGetOutput(output) {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    const server = { raw_output: output };
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.includes('Name:')) server.name = line.split(':')[1]?.trim();
      else if (line.includes('Type:')) server.type = line.split(':')[1]?.trim();
      else if (line.includes('Command:')) server.command = line.split(':')[1]?.trim();
    }

    return server;
  } catch (error) {
    return { raw_output: output, parse_error: error.message };
  }
}

export default router;
