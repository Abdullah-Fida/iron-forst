const express = require('express');
const router = express.Router();
const { handleAdmsEvent } = require('../controllers/fingerprintController');

// POST /adms
// Main endpoint for receiving ZKTeco SenseFace M2F-LR events
router.post('/', express.text({ type: '*/*' }), handleAdmsEvent);

// Optional: GET /adms
// Some ZKTeco devices use GET requests to pull commands from the server
// Just returning OK keeps the device happy if it tries to poll.
router.get('/', (req, res) => {
  res.send('OK');
});

module.exports = router;
