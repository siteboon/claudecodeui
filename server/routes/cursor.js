import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import crypto from 'crypto';
import { CURSOR_MODELS } from '../../shared/modelConstants.js';
import { applyCustomSessionNames } from '../database/db.js';

const router = express.Router();

// GET /api/cursor/config - Read Cursor CLI configuration
router.get('/config', async (req, res) => {
  try {
    const configPath = path.join(os.homedir(), '.cursor', 'cli-config.json');
    
    try {
      const configContent = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configContent);
      
      res.json({
        success: true,
        config: config,
        path: configPath
      });
    } catch (error) {
      // Config doesn't exist or is invalid
      console.log('Cursor config not found or invalid:', error.message);
      
      // Return default config
      res.json({
        success: true,
        config: {
          version: 1,
          model: {
            modelId: CURSOR_MODELS.DEFAULT,
            displayName: "GPT-5"
          },
          permissions: {
            allow: [],
            deny: []
          }
        },
        isDefault: true
      });
    }
  } catch (error) {
    console.error('Error reading Cursor config:', error);
    res.status(500).json({ 
      error: 'Failed to read Cursor configuration', 
      details: error.message 
    });
  }
});

// POST /api/cursor/config - Update Cursor CLI configuration
router.post('/config', async (req, res) => {
  try {
    const { permissions, model } = req.body;
    const configPath = path.join(os.homedir(), '.cursor', 'cli-config.json');
    
    // Read existing config or create default
    let config = {
      version: 1,
      editor: {
        vimMode: false
      },
      hasChangedDefaultModel: false,
      privacyCache: {
        ghostMode: false,
        privacyMode: 3,
        updatedAt: Date.now()
      }
    };
    
    try {
      const existing = await fs.readFile(configPath, 'utf8');
      config = JSON.parse(existing);
    } catch (error) {
      // Config doesn't exist, use defaults
      console.log('Creating new Cursor config');
    }
    
    // Update permissions if provided
    if (permissions) {
      config.permissions = {
        allow: permissions.allow || [],
        deny: permissions.deny || []
      };
    }
    
    // Update model if provided
    if (model) {
      config.model = model;
      config.hasChangedDefaultModel = true;
    }
    
    // Ensure directory exists
    const configDir = path.dirname(configPath);
    await fs.mkdir(configDir, { recursive: true });
    
    // Write updated config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    
    res.json({
      success: true,
      config: config,
      message: 'Cursor configuration updated successfully'
    });
  } catch (error) {
    console.error('Error updating Cursor config:', error);
    res.status(500).json({ 
      error: 'Failed to update Cursor configuration', 
      details: error.message 
    });
  }
});

// GET /api/cursor/mcp - Read Cursor MCP servers configuration
router.get('/mcp', async (req, res) => {
  try {
    const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
    
    try {
      const mcpContent = await fs.readFile(mcpPath, 'utf8');
      const mcpConfig = JSON.parse(mcpContent);
      
      // Convert to UI-friendly format
      const servers = [];
      if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object') {
        for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
          const server = {
            id: name,
            name: name,
            type: 'stdio',
            scope: 'cursor',
            config: {},
            raw: config
          };
          
          // Determine transport type and extract config
          if (config.command) {
            server.type = 'stdio';
            server.config.command = config.command;
            server.config.args = config.args || [];
            server.config.env = config.env || {};
          } else if (config.url) {
            server.type = config.transport || 'http';
            server.config.url = config.url;
            server.config.headers = config.headers || {};
          }
          
          servers.push(server);
        }
      }
      
      res.json({
        success: true,
        servers: servers,
        path: mcpPath
      });
    } catch (error) {
      // MCP config doesn't exist
      console.log('Cursor MCP config not found:', error.message);
      res.json({
        success: true,
        servers: [],
        isDefault: true
      });
    }
  } catch (error) {
    console.error('Error reading Cursor MCP config:', error);
    res.status(500).json({ 
      error: 'Failed to read Cursor MCP configuration', 
      details: error.message 
    });
  }
});

// POST /api/cursor/mcp/add - Add MCP server to Cursor configuration
router.post('/mcp/add', async (req, res) => {
  try {
    const { name, type = 'stdio', command, args = [], url, headers = {}, env = {} } = req.body;
    const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
    
    console.log(`➕ Adding MCP server to Cursor config: ${name}`);
    
    // Read existing config or create new
    let mcpConfig = { mcpServers: {} };
    
    try {
      const existing = await fs.readFile(mcpPath, 'utf8');
      mcpConfig = JSON.parse(existing);
      if (!mcpConfig.mcpServers) {
        mcpConfig.mcpServers = {};
      }
    } catch (error) {
      console.log('Creating new Cursor MCP config');
    }
    
    // Build server config based on type
    let serverConfig = {};
    
    if (type === 'stdio') {
      serverConfig = {
        command: command,
        args: args,
        env: env
      };
    } else if (type === 'http' || type === 'sse') {
      serverConfig = {
        url: url,
        transport: type,
        headers: headers
      };
    }
    
    // Add server to config
    mcpConfig.mcpServers[name] = serverConfig;
    
    // Ensure directory exists
    const mcpDir = path.dirname(mcpPath);
    await fs.mkdir(mcpDir, { recursive: true });
    
    // Write updated config
    await fs.writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2));
    
    res.json({
      success: true,
      message: `MCP server "${name}" added to Cursor configuration`,
      config: mcpConfig
    });
  } catch (error) {
    console.error('Error adding MCP server to Cursor:', error);
    res.status(500).json({ 
      error: 'Failed to add MCP server', 
      details: error.message 
    });
  }
});

// DELETE /api/cursor/mcp/:name - Remove MCP server from Cursor configuration
router.delete('/mcp/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
    
    console.log(`🗑️ Removing MCP server from Cursor config: ${name}`);
    
    // Read existing config
    let mcpConfig = { mcpServers: {} };
    
    try {
      const existing = await fs.readFile(mcpPath, 'utf8');
      mcpConfig = JSON.parse(existing);
    } catch (error) {
      return res.status(404).json({ 
        error: 'Cursor MCP configuration not found' 
      });
    }
    
    // Check if server exists
    if (!mcpConfig.mcpServers || !mcpConfig.mcpServers[name]) {
      return res.status(404).json({ 
        error: `MCP server "${name}" not found in Cursor configuration` 
      });
    }
    
    // Remove server from config
    delete mcpConfig.mcpServers[name];
    
    // Write updated config
    await fs.writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2));
    
    res.json({
      success: true,
      message: `MCP server "${name}" removed from Cursor configuration`,
      config: mcpConfig
    });
  } catch (error) {
    console.error('Error removing MCP server from Cursor:', error);
    res.status(500).json({ 
      error: 'Failed to remove MCP server', 
      details: error.message 
    });
  }
});

// POST /api/cursor/mcp/add-json - Add MCP server using JSON format
router.post('/mcp/add-json', async (req, res) => {
  try {
    const { name, jsonConfig } = req.body;
    const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
    
    console.log(`➕ Adding MCP server to Cursor config via JSON: ${name}`);
    
    // Validate and parse JSON config
    let parsedConfig;
    try {
      parsedConfig = typeof jsonConfig === 'string' ? JSON.parse(jsonConfig) : jsonConfig;
    } catch (parseError) {
      return res.status(400).json({ 
        error: 'Invalid JSON configuration', 
        details: parseError.message 
      });
    }
    
    // Read existing config or create new
    let mcpConfig = { mcpServers: {} };
    
    try {
      const existing = await fs.readFile(mcpPath, 'utf8');
      mcpConfig = JSON.parse(existing);
      if (!mcpConfig.mcpServers) {
        mcpConfig.mcpServers = {};
      }
    } catch (error) {
      console.log('Creating new Cursor MCP config');
    }
    
    // Add server to config
    mcpConfig.mcpServers[name] = parsedConfig;
    
    // Ensure directory exists
    const mcpDir = path.dirname(mcpPath);
    await fs.mkdir(mcpDir, { recursive: true });
    
    // Write updated config
    await fs.writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2));
    
    res.json({
      success: true,
      message: `MCP server "${name}" added to Cursor configuration via JSON`,
      config: mcpConfig
    });
  } catch (error) {
    console.error('Error adding MCP server to Cursor via JSON:', error);
    res.status(500).json({ 
      error: 'Failed to add MCP server', 
      details: error.message 
    });
  }
});

// GET /api/cursor/sessions - Get Cursor sessions from SQLite database
router.get('/sessions', async (req, res) => {
  try {
    const { projectPath } = req.query;
    
    // Calculate cwdID hash for the project path (Cursor uses MD5 hash)
    const cwdId = crypto.createHash('md5').update(projectPath || process.cwd()).digest('hex');
    const cursorChatsPath = path.join(os.homedir(), '.cursor', 'chats', cwdId);
    
    
    // Check if the directory exists
    try {
      await fs.access(cursorChatsPath);
    } catch (error) {
      // No sessions for this project
      return res.json({ 
        success: true, 
        sessions: [],
        cwdId: cwdId,
        path: cursorChatsPath
      });
    }
    
    // List all session directories
    const sessionDirs = await fs.readdir(cursorChatsPath);
    const sessions = [];
    
    for (const sessionId of sessionDirs) {
      const sessionPath = path.join(cursorChatsPath, sessionId);
      const storeDbPath = path.join(sessionPath, 'store.db');
      let dbStatMtimeMs = null;
      
      try {
        // Check if store.db exists
        await fs.access(storeDbPath);
        
        // Capture store.db mtime as a reliable fallback timestamp (last activity)
        try {
          const stat = await fs.stat(storeDbPath);
          dbStatMtimeMs = stat.mtimeMs;
        } catch (_) {}

        // Open SQLite database
        const db = await open({
          filename: storeDbPath,
          driver: sqlite3.Database,
          mode: sqlite3.OPEN_READONLY
        });
        
        // Get metadata from meta table
        const metaRows = await db.all(`
          SELECT key, value FROM meta
        `);
        
        let sessionData = {
          id: sessionId,
          name: 'Untitled Session',
          createdAt: null,
          mode: null,
          projectPath: projectPath,
          lastMessage: null,
          messageCount: 0
        };
        
        // Parse meta table entries
        for (const row of metaRows) {
          if (row.value) {
            try {
              // Try to decode as hex-encoded JSON
              const hexMatch = row.value.toString().match(/^[0-9a-fA-F]+$/);
              if (hexMatch) {
                const jsonStr = Buffer.from(row.value, 'hex').toString('utf8');
                const data = JSON.parse(jsonStr);
                
                if (row.key === 'agent') {
                  sessionData.name = data.name || sessionData.name;
                  // Normalize createdAt to ISO string in milliseconds
                  let createdAt = data.createdAt;
                  if (typeof createdAt === 'number') {
                    if (createdAt < 1e12) {
                      createdAt = createdAt * 1000; // seconds -> ms
                    }
                    sessionData.createdAt = new Date(createdAt).toISOString();
                  } else if (typeof createdAt === 'string') {
                    const n = Number(createdAt);
                    if (!Number.isNaN(n)) {
                      const ms = n < 1e12 ? n * 1000 : n;
                      sessionData.createdAt = new Date(ms).toISOString();
                    } else {
                      // Assume it's already an ISO/date string
                      const d = new Date(createdAt);
                      sessionData.createdAt = isNaN(d.getTime()) ? null : d.toISOString();
                    }
                  } else {
                    sessionData.createdAt = sessionData.createdAt || null;
                  }
                  sessionData.mode = data.mode;
                  sessionData.agentId = data.agentId;
                  sessionData.latestRootBlobId = data.latestRootBlobId;
                }
              } else {
                // If not hex, use raw value for simple keys
                if (row.key === 'name') {
                  sessionData.name = row.value.toString();
                }
              }
            } catch (e) {
              console.log(`Could not parse meta value for key ${row.key}:`, e.message);
            }
          }
        }
        
        // Get message count from JSON blobs only (actual messages, not DAG structure)
        try {
          const blobCount = await db.get(`
            SELECT COUNT(*) as count 
            FROM blobs 
            WHERE substr(data, 1, 1) = X'7B'
          `);
          sessionData.messageCount = blobCount.count;
          
          // Get the most recent JSON blob for preview (actual message, not DAG structure)
          const lastBlob = await db.get(`
            SELECT data FROM blobs 
            WHERE substr(data, 1, 1) = X'7B'
            ORDER BY rowid DESC 
            LIMIT 1
          `);
          
          if (lastBlob && lastBlob.data) {
            try {
              // Try to extract readable preview from blob (may contain binary with embedded JSON)
              const raw = lastBlob.data.toString('utf8');
              let preview = '';
              // Attempt direct JSON parse
              try {
                const parsed = JSON.parse(raw);
                if (parsed?.content) {
                  if (Array.isArray(parsed.content)) {
                    const firstText = parsed.content.find(p => p?.type === 'text' && p.text)?.text || '';
                    preview = firstText;
                  } else if (typeof parsed.content === 'string') {
                    preview = parsed.content;
                  }
                }
              } catch (_) {}
              if (!preview) {
                // Strip non-printable and try to find JSON chunk
                const cleaned = raw.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
                const s = cleaned;
                const start = s.indexOf('{');
                const end = s.lastIndexOf('}');
                if (start !== -1 && end > start) {
                  const jsonStr = s.slice(start, end + 1);
                  try {
                    const parsed = JSON.parse(jsonStr);
                    if (parsed?.content) {
                      if (Array.isArray(parsed.content)) {
                        const firstText = parsed.content.find(p => p?.type === 'text' && p.text)?.text || '';
                        preview = firstText;
                      } else if (typeof parsed.content === 'string') {
                        preview = parsed.content;
                      }
                    }
                  } catch (_) {
                    preview = s;
                  }
                } else {
                  preview = s;
                }
              }
              if (preview && preview.length > 0) {
                sessionData.lastMessage = preview.substring(0, 100) + (preview.length > 100 ? '...' : '');
              }
            } catch (e) {
              console.log('Could not parse blob data:', e.message);
            }
          }
        } catch (e) {
          console.log('Could not read blobs:', e.message);
        }
        
        await db.close();

        // Finalize createdAt: use parsed meta value when valid, else fall back to store.db mtime
        if (!sessionData.createdAt) {
          if (dbStatMtimeMs && Number.isFinite(dbStatMtimeMs)) {
            sessionData.createdAt = new Date(dbStatMtimeMs).toISOString();
          }
        }
        
        sessions.push(sessionData);
        
      } catch (error) {
        console.log(`Could not read session ${sessionId}:`, error.message);
      }
    }
    
    // Fallback: ensure createdAt is a valid ISO string (use session directory mtime as last resort)
    for (const s of sessions) {
      if (!s.createdAt) {
        try {
          const sessionDir = path.join(cursorChatsPath, s.id);
          const st = await fs.stat(sessionDir);
          s.createdAt = new Date(st.mtimeMs).toISOString();
        } catch {
          s.createdAt = new Date().toISOString();
        }
      }
    }
    // Sort sessions by creation date (newest first)
    sessions.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    
    applyCustomSessionNames(sessions, 'cursor');

    res.json({
      success: true,
      sessions: sessions,
      cwdId: cwdId,
      path: cursorChatsPath
    });
    
  } catch (error) {
    console.error('Error reading Cursor sessions:', error);
    res.status(500).json({ 
      error: 'Failed to read Cursor sessions', 
      details: error.message 
    });
  }
});
export default router;