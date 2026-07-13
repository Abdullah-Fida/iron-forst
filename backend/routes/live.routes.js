const express = require('express');
const { authenticate, requireGymOwner } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/live/feed
 * Server-Sent Events (SSE) endpoint.
 * The frontend opens an EventSource to this URL and receives real-time
 * scan events pushed from the fingerprintController whenever a device
 * posts an ATTLOG record.
 *
 * Auth: JWT token passed as ?token= query param (EventSource can't set headers).
 */
router.get('/feed', (req, res) => {
  // --- Auth via query param (EventSource limitation) ---
  const jwt = require('jsonwebtoken');
  const token = req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token required' });
  }

  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  // --- SSE setup ---
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx compatibility
  });

  // Send an initial comment so the browser knows the connection is alive
  res.write(':connected\n\n');

  // Keep-alive heartbeat every 25 seconds
  const heartbeat = setInterval(() => {
    res.write(':ping\n\n');
  }, 25000);

  // Listen for scan events scoped to this gym
  const events = req.app.locals.events;
  const channel = `scan:${user.gym_id}`;

  const onScan = (payload) => {
    res.write(`event: scan\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  events.on(channel, onScan);

  // Cleanup when client disconnects
  req.on('close', () => {
    clearInterval(heartbeat);
    events.off(channel, onScan);
  });
});

module.exports = router;
