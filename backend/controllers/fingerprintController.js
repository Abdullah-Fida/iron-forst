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

// A scan older than this is part of the device's stored backlog — everything
// it recorded while it could not reach us — not someone at the door now. It is
// acknowledged so the device stops resending it, but nothing is stored.
const MAX_SCAN_AGE_MS = (Number(process.env.MAX_SCAN_AGE_MINUTES) || 10) * 60 * 1000;

// The door only opens for a scan this fresh: the person has to still be there.
const DOOR_WINDOW_MS = 2 * 60 * 1000;

// The device writes scan times in its own local time with no zone attached.
// Same setting as the TimeZone sent to the device in the ADMS handshake.
const DEVICE_TZ_HOURS = Number(process.env.DEVICE_TIMEZONE || 5);

/**
 * "2026-10-07 19:09:26" in device local time -> Date, or null if unreadable.
 */
const parseDeviceTime = (text) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text || '');
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - DEVICE_TZ_HOURS * 3600 * 1000);
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

      let ignored = 0;

      for (const record of records) {
        const fingerprintId = record.PIN;
        const verifyMode = record.VERIFY; // 1=fingerprint, 15=face

        if (!fingerprintId) {
          console.log('⚠️ Skipping record with no PIN');
          continue;
        }

        // The device's clock, not the server's: a scan happened when the finger
        // was on the reader. Server time made every backlog record look like it
        // was happening now — on 2026-10-07 the first connection replayed two
        // months of stored scans onto the live dashboard and marked 31 members
        // present. Anything outside the window either way (old backlog, or a
        // device clock that has drifted) is ignored rather than guessed at.
        const scannedAt = parseDeviceTime(record.TIME);
        const ageMs = scannedAt ? Date.now() - scannedAt.getTime() : Infinity;
        if (Math.abs(ageMs) > MAX_SCAN_AGE_MS) {
          ignored += 1;
          continue;
        }
        const scanTime = scannedAt.toISOString();

        // A batch the device did not get an OK for is sent again in full.
        if (await fingerprintService.isAlreadyLogged(fingerprintId, deviceSerial, scanTime)) {
          console.log(`ℹ️ Already recorded: PIN=${fingerprintId} at ${record.TIME}`);
          continue;
        }

        console.log(`\n🔍 Processing scan: PIN=${fingerprintId}, TIME=${record.TIME}, VERIFY=${verifyMode}`);

        // 1. Validate membership
        const validation = await fingerprintService.validateMembership(fingerprintId);
        console.log(`📌 Validation result: ${validation.status} (memberId: ${validation.memberId})`);

        // 2. Mark attendance if member is valid. The date is the device's local
        // date, so a late-night scan lands on the right day.
        if (validation.isValid && validation.memberId) {
          const attendance = await fingerprintService.markAttendance(
            validation.memberId,
            validation.gymId,
            scanTime,
            record.TIME.slice(0, 10)
          );
          if (attendance) {
            console.log(`✅ Attendance marked for member ${validation.memberId} at ${scanTime}`);
          }
        }

        // 3. Open door if valid and the person can still be at the door (MQTT - optional)
        if (validation.isValid && ageMs <= DOOR_WINDOW_MS) {
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

      if (ignored) {
        console.log(`⏭️ Ignored ${ignored} scan(s) more than ${MAX_SCAN_AGE_MS / 60000} min from now (device backlog or clock drift)`);
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
