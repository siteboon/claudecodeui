export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  
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
    // Route API requests
    switch (path) {
      case 'projects':
        return handleProjects(request, corsHeaders);
      case 'config':
        return handleConfig(request, corsHeaders);
      case 'auth/status':
        return handleAuthStatus(request, corsHeaders);
      case 'auth/login':
        return handleLogin(request, corsHeaders);
      default:
        if (path.startsWith('projects/')) {
          return handleProjectOperations(path, request, corsHeaders);
        }
        return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
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

// Handle projects endpoint
async function handleProjects(request, corsHeaders) {
  if (request.method === 'GET') {
    // Return sample projects (in real app, this would come from database)
    const projects = [
      {
        name: 'demo-project',
        displayName: 'Demo Project',
        path: '/demo',
        lastModified: new Date().toISOString(),
        description: 'A sample project for demonstration'
      },
      {
        name: 'my-website',
        displayName: 'My Website',
        path: '/website',
        lastModified: new Date().toISOString(),
        description: 'Personal website project'
      }
    ];
    
    return new Response(JSON.stringify(projects), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (request.method === 'POST') {
    const body = await request.json();
    // In real app, create project in database
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Project created successfully',
      project: { ...body, id: Date.now() }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Handle config endpoint
async function handleConfig(request, corsHeaders) {
  const config = {
    claudeApiKey: process.env.CLAUDE_API_KEY || 'demo-key',
    cursorApiKey: process.env.CURSOR_API_KEY || 'demo-key',
    autoExpandTools: false,
    wsUrl: 'wss://your-backend-domain.com'
  };
  
  return new Response(JSON.stringify(config), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Handle auth status
async function handleAuthStatus(request, corsHeaders) {
  // Check for auth token
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // In real app, validate token
    return new Response(JSON.stringify({ 
      authenticated: true, 
      user: { username: 'demo-user', role: 'user' }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify({ 
    authenticated: false, 
    user: null 
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Handle login
async function handleLogin(request, corsHeaders) {
  if (request.method === 'POST') {
    const { username, password } = await request.json();
    
    // Simple demo authentication
    if (username === 'demo' && password === 'demo') {
      const token = `demo-token-${Date.now()}`;
      return new Response(JSON.stringify({ 
        success: true, 
        token,
        user: { username, role: 'user' }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Invalid credentials' 
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}


// Handle project-specific operations
async function handleProjectOperations(path, request, corsHeaders) {
  const parts = path.split('/');
  const projectName = parts[1];
  const operation = parts[2];
  
  if (operation === 'sessions') {
    if (request.method === 'GET') {
      const sessions = [
        {
          id: 'session-1',
          name: 'First Session',
          lastModified: new Date().toISOString(),
          messageCount: 5
        },
        {
          id: 'session-2',
          name: 'Second Session',
          lastModified: new Date().toISOString(),
          messageCount: 3
        }
      ];
      
      return new Response(JSON.stringify(sessions), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
  
  if (operation === 'files') {
    if (request.method === 'GET') {
      const files = [
        {
          name: 'index.html',
          path: '/index.html',
          type: 'file',
          size: 1024,
          lastModified: new Date().toISOString()
        },
        {
          name: 'style.css',
          path: '/style.css',
          type: 'file',
          size: 2048,
          lastModified: new Date().toISOString()
        }
      ];
      
      return new Response(JSON.stringify(files), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
  
  return new Response(JSON.stringify({ error: 'Operation not supported' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}