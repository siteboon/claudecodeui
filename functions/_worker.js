export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle API routes
    if (url.pathname.startsWith('/api/')) {
      // Route to appropriate function handler
      const apiPath = url.pathname.replace('/api/', '');
      
      try {
        // Import and call the appropriate handler
        if (apiPath.startsWith('auth/')) {
          const { onRequest } = await import('./auth/[[path]].js');
          return onRequest({ request, env, ctx });
        }
        
        if (apiPath.startsWith('projects/')) {
          const { onRequest } = await import('./projects/[[path]].js');
          return onRequest({ request, env, ctx });
        }
        
        if (apiPath.startsWith('git/')) {
          const { onRequest } = await import('./git/[[path]].js');
          return onRequest({ request, env, ctx });
        }
        
        if (apiPath.startsWith('mcp/')) {
          const { onRequest } = await import('./mcp/[[path]].js');
          return onRequest({ request, env, ctx });
        }
        
        if (apiPath.startsWith('cursor/')) {
          const { onRequest } = await import('./cursor/[[path]].js');
          return onRequest({ request, env, ctx });
        }
        
        if (apiPath === 'transcribe') {
          const { onRequest } = await import('./transcribe.js');
          return onRequest({ request, env, ctx });
        }
        
        // Default API handler
        const { onRequest } = await import('./api/[[path]].js');
        return onRequest({ request, env, ctx });
        
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: 'API handler not found',
          path: apiPath,
          message: error.message
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Handle WebSocket connections
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') === 'websocket') {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        
        server.accept();
        
        // Send welcome message
        server.send(JSON.stringify({
          type: 'welcome',
          message: 'Connected to Claude Code UI WebSocket',
          timestamp: new Date().toISOString()
        }));
        
        // Handle messages
        server.addEventListener('message', (event) => {
          try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data, server);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        });
        
        server.addEventListener('close', () => {
          console.log('WebSocket connection closed');
        });
        
        server.addEventListener('error', (error) => {
          console.error('WebSocket error:', error);
        });
        
        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }
    }
    
    // For all other routes, serve the SPA
    if (!url.pathname.includes('.')) {
      const indexResponse = await env.ASSETS.fetch('/index.html');
      return new Response(indexResponse.body, {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    // For static assets, serve normally
    return env.ASSETS.fetch(request);
  }
};

// WebSocket message handler
function handleWebSocketMessage(data, server) {
  const { type, content, project, session } = data;
  
  switch (type) {
    case 'chat':
      // Simulate AI response
      setTimeout(() => {
        const response = {
          type: 'ai_response',
          content: `This is a simulated AI response to: "${content}". In a real implementation, this would be processed by Claude AI.`,
          timestamp: new Date().toISOString(),
          project,
          session
        };
        server.send(JSON.stringify(response));
      }, 1000);
      break;
      
    case 'project_update':
      // Simulate project update
      const update = {
        type: 'project_updated',
        project,
        changes: ['file1.js', 'file2.css'],
        timestamp: new Date().toISOString()
      };
      server.send(JSON.stringify(update));
      break;
      
    case 'file_change':
      // Simulate file change notification
      const fileChange = {
        type: 'file_changed',
        file: content,
        project,
        timestamp: new Date().toISOString()
      };
      server.send(JSON.stringify(fileChange));
      break;
      
    case 'ping':
      // Respond to ping
      server.send(JSON.stringify({
        type: 'pong',
        timestamp: new Date().toISOString()
      }));
      break;
      
    default:
      // Echo back unknown message types
      server.send(JSON.stringify({
        type: 'echo',
        original: data,
        timestamp: new Date().toISOString()
      }));
  }
}