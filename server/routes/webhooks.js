// Webhook endpoints for external integrations (like claude-code-hooks)
import express from 'express';

const router = express.Router();

// Store connected WebSocket clients globally
let connectedClients = new Set();

// Function to set connected clients from main server
export function setConnectedClients(clients) {
  connectedClients = clients;
}

// Broadcast audio notification to all connected clients
function broadcastAudioNotification(messageType, customMessage = '', metadata = {}) {
  const notification = {
    type: 'audio-notification',
    messageType,
    message: customMessage || `Claude ${messageType} notification`,
    timestamp: new Date().toISOString(),
    ttsEnabled: true,
    voice: 'nova',
    metadata,
    source: 'webhook'
  };
  
  console.log(`🔊 Webhook broadcasting audio notification: ${notification.message}`);
  
  connectedClients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(JSON.stringify(notification));
      } catch (error) {
        console.error('❌ Error sending webhook audio notification:', error.message);
      }
    }
  });
}

// Webhook endpoint for Claude Code hooks integration
router.post('/audio-notification', (req, res) => {
  try {
    const { messageType, message, metadata } = req.body;
    
    console.log('🎯 Webhook received audio notification request:', {
      messageType,
      message,
      metadata
    });
    
    // Validate required fields
    if (!messageType) {
      return res.status(400).json({ 
        error: 'messageType is required',
        example: { messageType: 'input', message: 'Claude needs your input', metadata: {} }
      });
    }
    
    // Broadcast to connected clients
    broadcastAudioNotification(messageType, message, metadata || {});
    
    res.json({ 
      success: true, 
      message: 'Audio notification sent to connected clients',
      clientCount: connectedClients.size
    });
    
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connectedClients: connectedClients.size,
    timestamp: new Date().toISOString()
  });
});

// Get notification types and examples
router.get('/notification-types', (req, res) => {
  res.json({
    messageTypes: [
      { type: 'input', description: 'Claude needs user input', example: 'Claude is waiting for you' },
      { type: 'complete', description: 'Task completed', example: 'Task completed successfully' },
      { type: 'error', description: 'Error occurred', example: 'Something went wrong' },
      { type: 'session_start', description: 'New session started', example: 'New session started' },
      { type: 'session_end', description: 'Session ended', example: 'Session ended' }
    ],
    webhookUrl: '/api/webhooks/audio-notification',
    method: 'POST',
    bodyExample: {
      messageType: 'input',
      message: 'Your agent needs your input',
      metadata: { source: 'claude-hooks', hookType: 'notification' }
    }
  });
});

export default router;