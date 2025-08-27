export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/mcp/', '');
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Route MCP requests
    switch (path) {
      case 'config/read':
        return handleMCPConfigRead(request, corsHeaders);
      case 'cli/list':
        return handleMCPCliList(request, corsHeaders);
      case 'servers':
        return handleMCPServers(request, corsHeaders);
      case 'cli/add':
        return handleMCPCliAdd(request, corsHeaders);
      case 'cli/remove':
        return handleMCPCliRemove(request, corsHeaders);
      case 'cli/add-json':
        return handleMCPCliAddJson(request, corsHeaders);
      default:
        if (path.startsWith('servers/')) {
          return handleMCPServerOperations(path, request, corsHeaders);
        }
        return new Response(JSON.stringify({ error: 'MCP endpoint not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// MCP Config Read
async function handleMCPConfigRead(request, corsHeaders) {
  const config = {
    mcpServers: {
      'claude-cli': {
        command: 'claude',
        args: ['--api-key', 'your-api-key'],
        description: 'Claude CLI for AI interactions'
      },
      'cursor-cli': {
        command: 'cursor',
        args: ['--config', 'cursor.json'],
        description: 'Cursor CLI for code operations'
      }
    },
    settings: {
      autoStart: true,
      timeout: 30000,
      maxRetries: 3
    }
  };
  
  return new Response(JSON.stringify(config), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// MCP CLI List
async function handleMCPCliList(request, corsHeaders) {
  const cliList = [
    {
      id: 'claude-cli',
      name: 'Claude CLI',
      version: '1.0.0',
      status: 'running',
      description: 'AI assistant CLI tool'
    },
    {
      id: 'cursor-cli',
      name: 'Cursor CLI',
      version: '2.1.0',
      status: 'stopped',
      description: 'Code editor CLI tool'
    },
    {
      id: 'git-cli',
      name: 'Git CLI',
      version: '2.40.0',
      status: 'running',
      description: 'Version control CLI tool'
    }
  ];
  
  return new Response(JSON.stringify(cliList), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// MCP Servers
async function handleMCPServers(request, corsHeaders) {
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') || 'user';
  
  const servers = [
    {
      id: 'server-1',
      name: 'Local Development Server',
      host: 'localhost',
      port: 3001,
      status: 'online',
      scope,
      lastSeen: new Date().toISOString()
    },
    {
      id: 'server-2',
      name: 'Production Server',
      host: 'api.example.com',
      port: 443,
      status: 'online',
      scope,
      lastSeen: new Date().toISOString()
    }
  ];
  
  return new Response(JSON.stringify(servers), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// MCP CLI Add
async function handleMCPCliAdd(request, corsHeaders) {
  if (request.method === 'POST') {
    const { name, command, args, description } = await request.json();
    
    const newCli = {
      id: `cli-${Date.now()}`,
      name,
      command,
      args: args || [],
      description: description || '',
      status: 'stopped',
      version: '1.0.0'
    };
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'CLI tool added successfully',
      cli: newCli
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// MCP CLI Remove
async function handleMCPCliRemove(request, corsHeaders) {
  const url = new URL(request.url);
  const serverId = url.pathname.split('/').pop();
  const scope = url.searchParams.get('scope') || 'user';
  
  if (request.method === 'DELETE') {
    return new Response(JSON.stringify({ 
      success: true, 
      message: `CLI tool ${serverId} removed successfully`,
      removedId: serverId,
      scope
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// MCP CLI Add JSON
async function handleMCPCliAddJson(request, corsHeaders) {
  if (request.method === 'POST') {
    const { jsonConfig } = await request.json();
    
    try {
      const config = JSON.parse(jsonConfig);
      const newCli = {
        id: `cli-${Date.now()}`,
        ...config,
        status: 'stopped',
        version: config.version || '1.0.0'
      };
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'CLI tool added from JSON successfully',
        cli: newCli
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Invalid JSON configuration'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
}

// MCP Server Operations
async function handleMCPServerOperations(path, request, corsHeaders) {
  const parts = path.split('/');
  const serverId = parts[1];
  const operation = parts[2];
  
  if (operation === 'test') {
    if (request.method === 'GET') {
      const scope = new URL(request.url).searchParams.get('scope') || 'user';
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: `Server ${serverId} is responding`,
        serverId,
        scope,
        responseTime: Math.random() * 100 + 50,
        status: 'online'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
  
  if (operation === 'tools') {
    if (request.method === 'GET') {
      const scope = new URL(request.url).searchParams.get('scope') || 'user';
      
      const tools = [
        {
          name: 'file_operations',
          description: 'Read and write files',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['read', 'write', 'delete'] },
              path: { type: 'string', description: 'File path' }
            }
          }
        },
        {
          name: 'git_operations',
          description: 'Git version control operations',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', enum: ['status', 'commit', 'push', 'pull'] },
              branch: { type: 'string', description: 'Git branch' }
            }
          }
        }
      ];
      
      return new Response(JSON.stringify({ 
        serverId,
        scope,
        tools
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
  
  return new Response(JSON.stringify({ error: 'Server operation not supported' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}