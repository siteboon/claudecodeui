import express from 'express';
import tunnelService from '../services/tunnelService.js';

const router = express.Router();

// Start tunnel
router.post('/start', async (req, res) => {
  try {
    // In development, we need to tunnel to the Vite dev server port
    // In production, we tunnel to the Express server port
    const isDevelopment = process.env.NODE_ENV === 'development';
    const tunnelPort = isDevelopment ? (process.env.VITE_PORT || 3001) : (process.env.PORT || 3000);
    
    console.log(`Starting tunnel in ${isDevelopment ? 'development' : 'production'} mode on port ${tunnelPort}`);
    
    const result = await tunnelService.start(tunnelPort);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error starting tunnel:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stop tunnel
router.post('/stop', async (req, res) => {
  try {
    const result = await tunnelService.stop();
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error stopping tunnel:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get tunnel status
router.get('/status', (req, res) => {
  try {
    const status = tunnelService.getStatus();
    
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('Error getting tunnel status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get shareable link
router.post('/share', (req, res) => {
  try {
    const url = tunnelService.getShareableUrl();
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'No active tunnel'
      });
    }
    
    // Generate a simple shareable response
    // In the future, we could generate QR codes or shortened URLs here
    res.json({
      success: true,
      url: url,
      shareText: `Access Claude Code UI from: ${url}`,
      qrCodeData: null // Placeholder for future QR code implementation
    });
  } catch (error) {
    console.error('Error generating share link:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;