const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const whatsappService = require('../services/whatsappService');

// All routes require authentication
router.use(authenticate);

// ── GET /api/whatsapp/status ─── Check Baileys connection status
router.get('/status', async (req, res) => {
  const status = await whatsappService.getStatus(req.user.gym_id);
  res.json({ success: true, data: status });
});

// ── POST /api/whatsapp/logout ─── Disconnect Baileys session
router.post('/logout', async (req, res) => {
  await whatsappService.logout(req.user.gym_id);
  res.json({ success: true, message: 'Logged out successfully' });
});

// ── POST /api/whatsapp/send ─── Send a single WhatsApp message
router.post('/send', async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'Phone and message are required' });
  }

  try {
    const result = await whatsappService.sendMessage(req.user.gym_id, phone, message);
    if (result.success) {
      res.json({ success: true, message: 'Message sent', sid: result.sid });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/whatsapp/send-bulk ─── Send bulk WhatsApp messages (async, non-blocking)
router.post('/send-bulk', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: 'Messages array is required' });
  }

  // Fire and forget — respond immediately so the UI doesn't hang
  whatsappService.sendBulkMessages(req.user.gym_id, messages).then(results => {
    console.log(`[WhatsApp ${req.user.gym_id}] Bulk send completed:`, results);
  }).catch(err => {
    console.error(`[WhatsApp ${req.user.gym_id}] Bulk send error:`, err.message);
  });

  res.json({
    success: true,
    message: `Sending ${messages.length} message(s) in the background via WhatsApp.`
  });
});

module.exports = router;
