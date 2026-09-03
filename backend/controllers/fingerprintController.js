const fingerprintService = require('../services/fingerprintService');
const mqttService = require('../services/mqttService');

/**
 * Parses ADMS plain text body for KEY=VALUE pairs (used by OPTIONS table etc.)
 */
const parseAdmsKeyValue = (text) => {
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
 * Parses ZKTeco ATTLOG (attendance log) rows.
 * Format: PIN\tTIME\tSTATUS\tVERIFY\tWORK_CODE\tRESERVED...
 * Each line is one attendance record. Multiple lines = multiple scans.
 * Example: "1\t2026-07-12 19:32:47\t255\t1\t0\t0\t0\t0\t0\t0"
 */
const parseAttLog = (text) => {
  const records = [];
  const lines = text.trim().split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const fields = trimmed.split('\t');
    if (fields.length >= 2) {
      records.push({
        PIN: fields[0]?.trim(),
        TIME: fields[1]?.trim(),
        STATUS: fields[2]?.trim() || '0',
        VERIFY: fields[3]?.trim() || '0',   // 1=fingerprint, 15=face
      });
    }
  }
  return records;
};

/**
 * Handle incoming POST requests from ZKTeco SenseFace M2F-LR
 */
const handleAdmsEvent = async (req, res) => {
  try {
    const table = req.query.table || '';
    const deviceSerial = req.query.SN || process.env.DEVICE_NAME || 'SenseFace-M2F-LR';
    
    console.log('\n📥 --- FINGERPRINT DEVICE REQUEST ---');
    console.log(`Method: ${req.method} | URL: ${req.originalUrl}`);
    console.log(`Table: ${table} | Device: ${deviceSerial}`);

    const rawBody = (typeof req.body === 'string' || Buffer.isBuffer(req.body)) 
      ? req.body.toString() 
      : JSON.stringify(req.body);
    
    console.log('Raw Body:', rawBody);

    // ── ATTLOG: Attendance/scan events ──
    if (table === 'ATTLOG') {
      const records = parseAttLog(rawBody);
      console.log(`📋 Parsed ${records.length} ATTLOG record(s):`, JSON.stringify(records, null, 2));

      for (const record of records) {
        const fingerprintId = record.PIN;
        const deviceTime = record.TIME; // Keep for debugging
        // Always use the server's current time instead of the device time to avoid clock mismatch issues
        const scanTime = new Date().toISOString(); 
        const verifyMode = record.VERIFY; // 1=fingerprint, 15=face

        if (!fingerprintId) {
          console.log('⚠️ Skipping record with no PIN');
          continue;
        }

        console.log(`\n🔍 Processing scan: PIN=${fingerprintId}, TIME=${scanTime}, VERIFY=${verifyMode}`);

        // 1. Validate membership
        const validation = await fingerprintService.validateMembership(fingerprintId);
        console.log(`📌 Validation result: ${validation.status} (memberId: ${validation.memberId})`);

        // 2. Mark attendance if member is valid
        if (validation.isValid && validation.memberId) {
          const attendance = await fingerprintService.markAttendance(
            validation.memberId,
            validation.gymId,
            scanTime
          );
          if (attendance) {
            console.log(`✅ Attendance marked for member ${validation.memberId} at ${scanTime}`);
          }
        }

        // 3. Open door if valid (MQTT - optional)
        if (validation.isValid) {
          await mqttService.publishOpenDoor(
            validation.memberId,
            fingerprintId,
            deviceSerial,
            scanTime
          );
        }

        // 4. Log access attempt
        await fingerprintService.logAccess(
          validation.memberId,
          fingerprintId,
          scanTime,
          deviceSerial,
          validation.status
        );

        // 5. Emit SSE event for real-time UI update.
        //
        // Every scan is pushed, including one from a finger that matches no
        // member. Those have no member row and therefore no gym_id, and this
        // used to be gated on validation.gymId — so an unknown fingerprint was
        // written to access_logs but never appeared on the dashboard, which is
        // the one case the gym most needs to see.
        const gymId = validation.gymId || (await fingerprintService.getDefaultGymId());

        if (gymId) {
          const memberInfo = await fingerprintService.getMemberDetails(validation.memberId);
          const events = req.app.locals.events;
          if (events) {
            events.emit(`scan:${gymId}`, {
              type: 'scan',
              fingerprintId,
              scanTime,
              device: deviceSerial,
              verifyMode,
              access: validation.isValid ? 'granted' : 'denied',
              status: validation.status,
              // Null member means the finger matched nobody. The dashboard
              // renders that as "Unknown", so the name carries the fingerprint
              // number to make the unenrolled id visible at the door.
              member: memberInfo || {
                id: null,
                name: `Unknown (ID ${fingerprintId})`,
                fingerprint_id: fingerprintId,
              },
              timestamp: new Date().toISOString(),
            });
            console.log(`📡 SSE emitted: ${validation.status} for fingerprint ${fingerprintId}`);
          }
        } else {
          console.warn('⚠️ No gym found — SSE event not emitted');
        }
      }

      console.log('-------------------------------------\n');
      res.set('Content-Type', 'text/plain');
      return res.send('OK');
    }

    // ── OPERLOG / OPTIONS / other tables: just log and acknowledge ──
    if (table === 'OPERLOG' || table === 'options') {
      console.log(`📝 ${table} data received (informational, no action needed)`);
      console.log('-------------------------------------\n');
      res.set('Content-Type', 'text/plain');
      return res.send('OK');
    }

    // ── Unknown or heartbeat ──
    console.log('💓 Heartbeat or unknown request — responding OK');
    console.log('-------------------------------------\n');
    res.set('Content-Type', 'text/plain');
    return res.send('OK');
    
  } catch (error) {
    console.error('❌ ADMS Error:', error.message);
    res.set('Content-Type', 'text/plain');
    res.send('OK');
  }
};

module.exports = {
  handleAdmsEvent
};
