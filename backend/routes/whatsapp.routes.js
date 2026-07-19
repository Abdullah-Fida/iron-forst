const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const whatsappService = require('../services/whatsappService');

// All routes require authentication
router.use(authenticate);

// ── GET /api/whatsapp/status ─── Check if Twilio is configured and ready
router.get('/status', (req, res) => {
  const status = whatsappService.getStatus();
  res.json({ success: true, data: status });
});

// ── POST /api/whatsapp/send ─── Send a single WhatsApp message
router.post('/send', async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'Phone and message are required' });
  }

  try {
    const result = await whatsappService.sendMessage(phone, message);
    if (result.success) {
      res.json({ success: true, message: 'Message sent', sid: result.sid });
    } else {
      res.status(400).json({ success: false, error: result.message });
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
  whatsappService.sendBulkMessages(messages).then(results => {
    console.log('[WhatsApp] Bulk send completed:', results);
  }).catch(err => {
    console.error('[WhatsApp] Bulk send error:', err.message);
  });

  res.json({
    success: true,
    message: `Sending ${messages.length} message(s) in the background via Twilio.`
  });
});

module.exports = router;
