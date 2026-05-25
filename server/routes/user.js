import express from 'express';
import { spawn } from 'child_process';

import { authenticateToken } from '../middleware/auth.js';
import { getSystemGitConfig } from '../utils/gitConfig.js';

const router = express.Router();

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => { reject(error); });
    child.on('close', (code) => {
      if (code === 0) { resolve({ stdout, stderr }); return; }
      const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

router.get('/git-config', authenticateToken, async (req, res) => {
  try {
    const systemConfig = await getSystemGitConfig();
    res.json({
      success: true,
      gitName: systemConfig.git_name || null,
      gitEmail: systemConfig.git_email || null,
    });
  } catch (error) {
    console.error('Error getting git config:', error);
    res.status(500).json({ error: 'Failed to get git configuration' });
  }
});

router.post('/git-config', authenticateToken, async (req, res) => {
  try {
    const { gitName, gitEmail } = req.body;

    if (!gitName || !gitEmail) {
      return res.status(400).json({ error: 'Git name and email are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(gitEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    await spawnAsync('git', ['config', '--global', 'user.name', gitName]);
    await spawnAsync('git', ['config', '--global', 'user.email', gitEmail]);

    res.json({ success: true, gitName, gitEmail });
  } catch (error) {
    console.error('Error updating git config:', error);
    res.status(500).json({ error: 'Failed to update git configuration' });
  }
});

router.post('/complete-onboarding', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'Onboarding completed successfully' });
});

router.get('/onboarding-status', authenticateToken, (req, res) => {
  res.json({ success: true, hasCompletedOnboarding: true });
});

export default router;
