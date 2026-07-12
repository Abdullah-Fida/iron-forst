const fingerprintService = require('../services/fingerprintService');
const mqttService = require('../services/mqttService');

/**
 * Parses ADMS plain text body for values like `PIN=15\tSN=123\t...`
 * Format varies depending on device settings.
 */
const parseAdmsText = (text) => {
  const result = {};
  const lines = text.split('\n');
  lines.forEach(line => {
    const pairs = line.split('\t');
    pairs.forEach(pair => {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) {
        result[key.trim()] = value.trim();
      }
    });
  });
  return result;
};

/**
 * Handle incoming POST requests from ZKTeco SenseFace M2F-LR
 */
const handleAdmsEvent = async (req, res) => {
  try {
    console.log('\n📥 --- FINGERPRINT DEVICE REQUEST ---');
    console.log(`Method: ${req.method}`);
    console.log(`URL: ${req.originalUrl}`);
    console.log('Query Params:', JSON.stringify(req.query, null, 2));
    console.log('Raw Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Raw Body:', typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2));
    
    let payload = req.body;
    
    // ZKTeco sometimes sends data as raw text in the body or URL parameters.
    // If it's plain text (iclock cdata style)
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      payload = parseAdmsText(req.body.toString());
      console.log('Parsed ADMS Text:', JSON.stringify(payload, null, 2));
    } 
    // Mix of query and body depending on standard vs custom push
    const data = { ...req.query, ...payload };
    console.log('Combined Extract Data:', JSON.stringify(data, null, 2));
    console.log('-------------------------------------\n');

    // Extract relevant fields
    // Standard ZKTeco fields: PIN (User ID), SN (Device Serial), TIME, Verify_Mode, event type
    const fingerprintId = data.PIN || data.userid || data.user_id;
    const deviceSerial = data.SN || process.env.DEVICE_NAME || 'SenseFace-M2F-LR';
    const time = data.TIME || data.time || new Date().toISOString();

    if (!fingerprintId) {
      // If heartbeat or unknown request, just return OK so device doesn't error out
      return res.send('OK'); 
    }

    // 1. Check Membership
    const validation = await fingerprintService.validateMembership(fingerprintId);
    
    // 2. Open Door if valid
    if (validation.isValid) {
      await mqttService.publishOpenDoor(
        validation.memberId,
        fingerprintId,
        deviceSerial,
        time
      );
    }

    // 3. Log Access
    await fingerprintService.logAccess(
      validation.memberId,
      fingerprintId,
      time,
      deviceSerial,
      validation.status
    );

    // 4. Respond to Device
    // Standard ZKTeco devices expect "OK" as plain text to clear their buffer.
    res.set('Content-Type', 'text/plain');
    return res.send('OK');
    
  } catch (error) {
    console.error('❌ ADMS Error:', error.message);
    // Never crash, and usually better to return OK so device doesn't get stuck retrying
    // unless you want it to retry, but returning 500 might cause log buildup on device.
    res.set('Content-Type', 'text/plain');
    res.send('ERROR');
  }
};

module.exports = {
  handleAdmsEvent
};
