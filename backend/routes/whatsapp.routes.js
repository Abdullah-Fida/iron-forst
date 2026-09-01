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

// ── POST /api/whatsapp/pair ─── Request Pairing Code
router.post('/pair', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'Phone number required' });
    const result = await whatsappService.requestPairingCode(req.user.gym_id, phone);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/whatsapp/send ─── Send a single WhatsApp message
router.post('/send', async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'Phone and message are required' });
  }

  try {
    const result = await whatsappService.sendMessage(req.user.gym_id, phone, message);
    // Always respond — check for a valid sid to confirm delivery
    if (result.success && result.sid) {
      res.json({ success: true, message: 'Message sent', sid: result.sid });
    } else {
      res.json({ success: false, error: 'Message may not have been delivered. No confirmation received.' });
    }
  } catch (err) {
    console.error('[WhatsApp Send Error]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/whatsapp/test ─── Test send with full debug output
router.post('/test', async (req, res) => {
  const { phone, message } = req.body;
  const testMessage = message || 'This is a test message from Iron Fost Gym System.';
  
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  const gymId = req.user.gym_id;
  const debug = { phone, gymId, steps: [] };

  try {
    // Step 1: Check session
    const session = whatsappService.sessions.get(gymId);
    debug.steps.push({ step: 'session_check', status: session?.status || 'NO_SESSION', hasSocket: !!session?.socket });

    if (!session || session.status !== 'CONNECTED') {
      return res.json({ success: false, error: 'Not connected', debug });
    }

    // Step 2: Format number
    let formatted = String(phone).replace(/[^0-9]/g, '');
    if (formatted.startsWith('0') && formatted.length === 11) formatted = `92${formatted.slice(1)}`;
    else if (formatted.length === 10 && !formatted.startsWith('92')) formatted = `92${formatted}`;
    const jid = `${formatted}@s.whatsapp.net`;
    debug.steps.push({ step: 'format', original: phone, formatted, jid });

    // Step 3: Check if on WhatsApp
    try {
      const [exists] = await session.socket.onWhatsApp(jid);
      debug.steps.push({ step: 'onWhatsApp', result: exists });
    } catch (e) {
      debug.steps.push({ step: 'onWhatsApp', error: e.message });
    }

    // Step 4: Try to send
    const msg = await session.socket.sendMessage(jid, { text: testMessage });
    debug.steps.push({ step: 'sendMessage', success: true, messageId: msg?.key?.id });

    res.json({ success: true, message: 'Test message sent!', debug });
  } catch (err) {
    debug.steps.push({ step: 'error', message: err.message, stack: err.stack?.split('\n').slice(0, 3) });
    res.json({ success: false, error: err.message, debug });
  }
});

// ── POST /api/whatsapp/send-bulk ─── Send bulk WhatsApp messages (async, non-blocking)
router.post('/send-bulk', async (req, res) => {
  const { messages, memberMap } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: 'Messages array is required' });
  }

  const gymId = req.user.gym_id;

  // Fire and forget — respond immediately so the UI doesn't hang
  whatsappService.sendBulkMessages(gymId, messages).then(async (results) => {
    console.log(`[WhatsApp ${gymId}] Bulk send completed:`, JSON.stringify(results));
    
    // Log successful sends as notifications in the DB
    // memberMap is { phone: { member_id, message } } sent from frontend
    if (memberMap && results.successful > 0) {
      try {
        const { supabase } = require('../db/supabase');
        const sentPhones = new Set();
        
        // Build set of phones that failed
        const failedPhones = new Set(results.errors.map(e => e.phone));
        
        for (const msg of messages) {
          const cleanPhone = String(msg.phone).replace(/[^0-9]/g, '');
          if (failedPhones.has(msg.phone)) continue;
          if (sentPhones.has(cleanPhone)) continue;
          sentPhones.add(cleanPhone);
          
          const memberInfo = memberMap[msg.phone];
          if (!memberInfo?.member_id) continue;
          
          // Insert notification as already sent
          await supabase.from('notifications').insert({
            gym_id: gymId,
            member_id: memberInfo.member_id,
            notification_type: 'wa_reminder',
            message_template: msg.message,
            scheduled_for: new Date().toISOString(),
            status: 'sent',
            sent_at: new Date().toISOString()
          });
        }
        console.log(`[WhatsApp ${gymId}] Logged ${sentPhones.size} sent notifications to DB.`);
      } catch (logErr) {
        console.error(`[WhatsApp ${gymId}] Failed to log notifications:`, logErr.message);
      }
    }
  }).catch(err => {
    console.error(`[WhatsApp ${gymId}] Bulk send error:`, err.message);
  });

  res.json({
    success: true,
    message: `Sending ${messages.length} message(s) in the background via WhatsApp.`
  });
});

module.exports = router;
