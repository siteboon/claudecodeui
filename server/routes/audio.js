// Audio streaming routes for TTS integration
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const audioDir = path.join(__dirname, '../temp/audio');
    try {
      await fs.mkdir(audioDir, { recursive: true });
      cb(null, audioDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `tts-${timestamp}-${randomId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    const allowedMimes = [
      'audio/mpeg',
      'audio/wav',
      'audio/mp3',
      'audio/ogg',
      'audio/webm'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  }
});

// Store connected WebSocket clients (will be set by main server)
let connectedClients = new Set();

export function setConnectedClients(clients) {
  connectedClients = clients;
}

// Upload audio file for streaming
router.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const { messageType = 'input', message = '', metadata = {} } = req.body;
    
    // Generate public URL for the audio file
    const audioUrl = `/api/audio/stream/${path.basename(req.file.filename)}`;
    
    console.log(`🎵 Audio uploaded: ${req.file.filename} (${req.file.size} bytes)`);
    
    // Broadcast audio notification to connected clients
    const notification = {
      type: 'audio-notification',
      messageType,
      message,
      audioUrl,
      timestamp: new Date().toISOString(),
      ttsEnabled: true,
      source: 'backend-tts',
      metadata: {
        ...metadata,
        audioFile: req.file.filename,
        fileSize: req.file.size,
        mimeType: req.file.mimetype
      }
    };

    connectedClients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(JSON.stringify(notification));
        } catch (error) {
          console.error('❌ Error sending audio notification:', error.message);
        }
      }
    });

    res.json({
      success: true,
      audioUrl,
      filename: req.file.filename,
      message: 'Audio uploaded and notification sent',
      clientCount: connectedClients.size
    });

  } catch (error) {
    console.error('❌ Audio upload error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Stream audio file
router.get('/stream/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const audioDir = path.join(__dirname, '../temp/audio');
    const filePath = path.join(audioDir, filename);

    // Security check: ensure filename doesn't contain path traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(audioDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    // Get file stats
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;

    // Set appropriate headers
    const ext = path.extname(filename).toLowerCase();
    let mimeType = 'audio/mpeg'; // default
    
    switch (ext) {
      case '.mp3':
        mimeType = 'audio/mpeg';
        break;
      case '.wav':
        mimeType = 'audio/wav';
        break;
      case '.ogg':
        mimeType = 'audio/ogg';
        break;
      case '.webm':
        mimeType = 'audio/webm';
        break;
    }

    res.set({
      'Content-Type': mimeType,
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Range'
    });

    // Handle range requests for better audio streaming
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunkSize
      });

      // Stream the requested range
      const readStream = (await import('fs')).createReadStream(filePath, { start, end });
      readStream.pipe(res);
    } else {
      // Stream entire file
      const readStream = (await import('fs')).createReadStream(filePath);
      readStream.pipe(res);
    }

    console.log(`🎵 Streaming audio: ${filename}`);

  } catch (error) {
    console.error('❌ Audio streaming error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Clean up old audio files
router.delete('/cleanup', async (req, res) => {
  try {
    const audioDir = path.join(__dirname, '../temp/audio');
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    
    let cleanedCount = 0;
    
    try {
      const files = await fs.readdir(audioDir);
      
      for (const file of files) {
        const filePath = path.join(audioDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          cleanedCount++;
          console.log(`🗑️ Cleaned up old audio file: ${file}`);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} old audio files`,
      cleanedCount
    });

  } catch (error) {
    console.error('❌ Audio cleanup error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get audio directory info
router.get('/info', async (req, res) => {
  try {
    const audioDir = path.join(__dirname, '../temp/audio');
    
    let fileCount = 0;
    let totalSize = 0;
    
    try {
      const files = await fs.readdir(audioDir);
      
      for (const file of files) {
        const filePath = path.join(audioDir, file);
        const stats = await fs.stat(filePath);
        fileCount++;
        totalSize += stats.size;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    res.json({
      audioDirectory: audioDir,
      fileCount,
      totalSize,
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100
    });

  } catch (error) {
    console.error('❌ Audio info error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Test notification endpoint (triggers backend TTS)
router.post('/test-notification', async (req, res) => {
  try {
    const { message = 'Audio notifications are working correctly', messageType = 'test' } = req.body;
    
    console.log('🎵 Test notification requested:', message);
    
    // Try to generate actual TTS audio for the test
    const { spawn } = await import('child_process');
    const path = await import('path');
    const fs = await import('fs/promises');
    
    // Path to claudecodeui_notification script
    const scriptPath = path.join(__dirname, '../../../.claude/hooks/utils/claudecodeui_notification.py');
    
    try {
      // Check if the script exists
      await fs.access(scriptPath);
      
      // Call the script to generate and upload TTS audio
      const childProcess = spawn('uv', ['run', scriptPath, messageType, message], {
        stdio: 'pipe',
        timeout: 15000 // 15 second timeout
      });
      
      let output = '';
      let error = '';
      
      childProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      childProcess.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      childProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Backend TTS test completed successfully');
          console.log('📄 Output:', output);
        } else {
          console.error('❌ Backend TTS test failed with code:', code);
          console.error('📄 Error:', error);
          
          // Fallback to text notification
          const fallbackNotification = {
            type: 'audio-notification',
            messageType,
            message,
            timestamp: new Date().toISOString(),
            ttsEnabled: true,
            source: 'test-fallback',
            metadata: {
              source: 'backend-test-fallback',
              testMode: true,
              fallbackReason: 'TTS generation failed'
            }
          };

          connectedClients.forEach(client => {
            if (client.readyState === 1) {
              try {
                client.send(JSON.stringify(fallbackNotification));
              } catch (error) {
                console.error('❌ Error sending fallback notification:', error.message);
              }
            }
          });
        }
      });
      
    } catch (accessError) {
      console.log('⚠️ TTS script not found, sending text notification:', accessError.message);
      
      // Fallback to text notification if script doesn't exist
      const textNotification = {
        type: 'audio-notification',
        messageType,
        message,
        timestamp: new Date().toISOString(),
        ttsEnabled: true,
        source: 'test',
        metadata: {
          source: 'backend-test',
          testMode: true,
          fallbackReason: 'TTS script not available'
        }
      };

      connectedClients.forEach(client => {
        if (client.readyState === 1) {
          try {
            client.send(JSON.stringify(textNotification));
          } catch (error) {
            console.error('❌ Error sending test notification:', error.message);
          }
        }
      });
    }

    res.json({
      success: true,
      message: 'Test notification initiated',
      clientCount: connectedClients.size,
      method: 'backend-tts'
    });

  } catch (error) {
    console.error('❌ Test notification error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;