import { Router } from 'express';
import { dingtalkDb } from '../database/db.js';
import { initDingTalkStream, disconnectDingTalkStream, isDingTalkConnected, getDingTalkStatus, getAccessToken } from '../dingtalk-stream.js';

const router = Router();

// GET /api/dingtalk/config — get config (secrets masked)
router.get('/config', (req, res) => {
  try {
    const config = dingtalkDb.getConfig(req.user.id);
    if (!config) {
      return res.json({ configured: false });
    }

    res.json({
      configured: true,
      clientId: config.client_id,
      clientSecret: config.client_secret ? '••••' + config.client_secret.slice(-4) : '',
      isActive: config.is_active,
      createdAt: config.created_at,
      updatedAt: config.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dingtalk/config — save config
router.post('/config', (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;

    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'clientId and clientSecret are required' });
    }

    const result = dingtalkDb.saveConfig(req.user.id, {
      clientId,
      clientSecret,
    });

    res.json({ success: true, id: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dingtalk/config — delete config and disconnect
router.delete('/config', async (req, res) => {
  try {
    if (isDingTalkConnected()) {
      await disconnectDingTalkStream();
    }
    dingtalkDb.deleteConfig(req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dingtalk/status — connection status
router.get('/status', (req, res) => {
  try {
    const status = getDingTalkStatus();
    res.json({
      connected: isDingTalkConnected(),
      ...status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dingtalk/connect — manual connect
router.post('/connect', async (req, res) => {
  try {
    const config = dingtalkDb.getConfig(req.user.id);
    if (!config) {
      return res.status(400).json({ error: 'DingTalk not configured. Save config first.' });
    }

    await initDingTalkStream({
      clientId: config.client_id,
      clientSecret: config.client_secret,
    });

    res.json({ success: true, connected: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dingtalk/disconnect — manual disconnect
router.post('/disconnect', async (req, res) => {
  try {
    await disconnectDingTalkStream();
    res.json({ success: true, connected: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dingtalk/test-credentials — test if credentials are valid
router.post('/test-credentials', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'clientId and clientSecret are required' });
    }

    const token = await getAccessToken(clientId, clientSecret);
    res.json({ success: true, valid: !!token });
  } catch (err) {
    res.json({ success: false, valid: false, error: err.message });
  }
});

// GET /api/dingtalk/conversations — list conversations
router.get('/conversations', (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const conversations = dingtalkDb.listConversations(parseInt(limit), parseInt(offset));
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dingtalk/conversations/:id/messages — get messages for a conversation
router.get('/conversations/:id/messages', (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const messages = dingtalkDb.getMessages(parseInt(req.params.id), parseInt(limit), parseInt(offset));
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dingtalk/conversations/:id/reset — reset a conversation
router.post('/conversations/:id/reset', (req, res) => {
  try {
    dingtalkDb.resetConversation(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
