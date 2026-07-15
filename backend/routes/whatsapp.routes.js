const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsappService');

// 1. Get WhatsApp connection status / QR code
router.get('/status', (req, res) => {
  const status = whatsappService.getStatus();
  res.json({ success: true, data: status });
});

// 2. Start / Initialize WhatsApp Bot
router.post('/start', async (req, res) => {
  whatsappService.initialize();
  res.json({ success: true, message: 'Initialization started' });
});

// 3. Logout / Disconnect WhatsApp Bot
router.post('/logout', async (req, res) => {
  await whatsappService.logout();
  res.json({ success: true, message: 'Logged out successfully' });
});

// 4. Send a single message
router.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'Phone and message are required' });
  }

  try {
    const result = await whatsappService.sendMessage(phone, message);
    if (result.success) {
      res.json({ success: true, message: 'Message sent' });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Send bulk messages
router.post('/send-bulk', async (req, res) => {
  const { messages } = req.body; // Array of { phone, message }
  
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: 'Messages array is required' });
  }

  try {
    // Run async to not block response
    whatsappService.sendBulkMessages(messages).catch(console.error);
    res.json({ success: true, message: 'Bulk sending started in the background' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
