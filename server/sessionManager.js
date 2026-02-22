import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

class SessionManager {
  constructor() {
    // Store sessions in memory with conversation history
    this.sessions = new Map();
    this.sessionsDir = path.join(os.homedir(), '.gemini', 'sessions');
    this.initSessionsDir();
  }

  async initSessionsDir() {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    } catch (error) {
      // console.error('Error creating sessions directory:', error);
    }
  }

  // Create a new session
  createSession(sessionId, projectPath) {
    const session = {
      id: sessionId,
      projectPath: projectPath,
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date()
    };
    
    this.sessions.set(sessionId, session);
    this.saveSession(sessionId);
    
    return session;
  }

  // Add a message to session
  addMessage(sessionId, role, content) {
    let session = this.sessions.get(sessionId);
    
    if (!session) {
      // Create session if it doesn't exist
      session = this.createSession(sessionId, '');
    }
    
    const message = {
      role: role, // 'user' or 'assistant'
      content: content,
      timestamp: new Date()
    };
    
    session.messages.push(message);
    session.lastActivity = new Date();
    
    this.saveSession(sessionId);
    
    return session;
  }

  // Get session by ID
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  // Get all sessions for a project
  getProjectSessions(projectPath) {
    const sessions = [];
    
    for (const [id, session] of this.sessions) {
      if (session.projectPath === projectPath) {
        sessions.push({
          id: session.id,
          summary: this.getSessionSummary(session),
          messageCount: session.messages.length,
          lastActivity: session.lastActivity
        });
      }
    }
    
    return sessions.sort((a, b) => 
      new Date(b.lastActivity) - new Date(a.lastActivity)
    );
  }

  // Get session summary
  getSessionSummary(session) {
    if (session.messages.length === 0) {
      return 'New Session';
    }
    
    // Find first user message
    const firstUserMessage = session.messages.find(m => m.role === 'user');
    if (firstUserMessage) {
      const content = firstUserMessage.content;
      return content.length > 50 ? content.substring(0, 50) + '...' : content;
    }
    
    return 'New Session';
  }

  // Build conversation context for Gemini
  buildConversationContext(sessionId, maxMessages = 10) {
    const session = this.sessions.get(sessionId);
    
    if (!session || session.messages.length === 0) {
      return '';
    }
    
    // Get last N messages for context
    const recentMessages = session.messages.slice(-maxMessages);
    
    let context = '以下は過去の会話履歴です:\n\n';
    
    for (const msg of recentMessages) {
      if (msg.role === 'user') {
        context += `ユーザー: ${msg.content}\n`;
      } else {
        context += `アシスタント: ${msg.content}\n`;
      }
    }
    
    context += '\n上記の会話履歴を踏まえて、次の質問に答えてください:\n';
    
    return context;
  }

  // Save session to disk
  async saveSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    try {
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      await fs.writeFile(filePath, JSON.stringify(session, null, 2));
    } catch (error) {
      // console.error('Error saving session:', error);
    }
  }

  // Load sessions from disk
  async loadSessions() {
    try {
      const files = await fs.readdir(this.sessionsDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.sessionsDir, file);
            const data = await fs.readFile(filePath, 'utf8');
            const session = JSON.parse(data);
            
            // Convert dates
            session.createdAt = new Date(session.createdAt);
            session.lastActivity = new Date(session.lastActivity);
            session.messages.forEach(msg => {
              msg.timestamp = new Date(msg.timestamp);
            });
            
            this.sessions.set(session.id, session);
          } catch (error) {
            // console.error(`Error loading session ${file}:`, error);
          }
        }
      }
    } catch (error) {
      // console.error('Error loading sessions:', error);
    }
  }

  // Delete a session
  async deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    
    try {
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      await fs.unlink(filePath);
    } catch (error) {
      // console.error('Error deleting session file:', error);
    }
  }

  // Get session messages for display
  getSessionMessages(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    
    return session.messages.map(msg => ({
      type: 'message',
      message: {
        role: msg.role,
        content: msg.content
      },
      timestamp: msg.timestamp.toISOString()
    }));
  }
}

// Singleton instance
const sessionManager = new SessionManager();

// Load existing sessions on startup
sessionManager.loadSessions();

export default sessionManager;