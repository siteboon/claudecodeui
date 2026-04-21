import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CURSOR_MODELS } from '../../shared/modelConstants.js';

const router = express.Router();

// GET /api/cursor/config - Read Cursor CLI configuration.
router.get('/config', async (req, res) => {
  try {
    const configPath = path.join(os.homedir(), '.cursor', 'cli-config.json');

    try {
      const configContent = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configContent);

      res.json({
        success: true,
        config,
        path: configPath,
      });
    } catch (error) {
      // Config doesn't exist or is invalid, so return the UI default shape.
      console.log('Cursor config not found or invalid:', error.message);

      res.json({
        success: true,
        config: {
          version: 1,
          model: {
            modelId: CURSOR_MODELS.DEFAULT,
            displayName: 'GPT-5',
          },
          permissions: {
            allow: [],
            deny: [],
          },
        },
        isDefault: true,
      });
    }
  } catch (error) {
    console.error('Error reading Cursor config:', error);
    res.status(500).json({
      error: 'Failed to read Cursor configuration',
      details: error.message,
    });
  }
});

export default router;
