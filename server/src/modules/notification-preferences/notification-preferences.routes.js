import express from 'express';
import { notificationPreferencesDb } from '@/shared/database/repositories/notification-preferences.js';

const router = express.Router();

// ===============================
// Notification Preferences
// ===============================

router.get('/', async (req, res) => {
  try {
    const preferences = notificationPreferencesDb.getNotificationPreferences(req.user.id);
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
});

router.put('/', async (req, res) => {
  try {
    const preferences = notificationPreferencesDb.updateNotificationPreferences(req.user.id, req.body || {});
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error saving notification preferences:', error);
    res.status(500).json({ error: 'Failed to save notification preferences' });
  }
});

export default router;
