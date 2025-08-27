export async function onRequest(context) {
  const { request, env } = context;
  
  // Check if this is a WebSocket upgrade request
  if (request.headers.get('Upgrade') === 'websocket') {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    // Accept the WebSocket connection
    server.accept();
    
    // Handle WebSocket events
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
    
    // Send welcome message
    server.send(JSON.stringify({
      type: 'welcome',
      message: 'Connected to Claude Code UI WebSocket',
      timestamp: new Date().toISOString()
    }));
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
  
  // Handle regular HTTP requests
  return new Response('WebSocket endpoint - use WebSocket protocol', {
    status: 400,
    headers: { 'Content-Type': 'text/plain' }
  });
}

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