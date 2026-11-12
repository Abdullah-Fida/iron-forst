/**
 * Fingerprint machine screen: who is on the machine, how they match members
 * in the software, new registrations waiting to be added, and deleting users
 * from the machine (and, when linked, from the software after the machine
 * confirms).
 */
const express = require('express');
const { z } = require('zod');
const { supabase } = require('../db/supabase');
const { authenticate, requireGymOwner } = require('../middleware/auth');
const deviceSync = require('../services/deviceSync');
const { clean } = require('../services/memberIds');

const router = express.Router();
router.use(authenticate, requireGymOwner);

const UNPAID_DAYS = 60; // "not paid for 2 months" = fee ended 60+ days ago

const TABLE_MISSING_MESSAGE =
  'The fingerprint machine list needs a one-time database update before it can be used. Please tell the developer.';

// Reads every row, 1000 at a time (the database returns at most 1000 per request).
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { data: null, error };
    out.push(...data);
    if (data.length < 1000) return { data: out, error: null };
  }
}

// Today's date in the gym's time zone, as YYYY-MM-DD
const gymToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(String(from).slice(0, 10))) / 86400000);

function memberSummary(m, today) {
  const overdue = m.latest_expiry ? daysBetween(m.latest_expiry, today) : null;
  const sinceJoin = m.join_date ? daysBetween(m.join_date, today) : null;
  return {
    id: m.id,
    name: m.name,
    phone: m.phone,
    membership_id: m.membership_id,
    status: m.status,
    latest_expiry: m.latest_expiry,
    join_date: m.join_date,
    days_overdue: overdue,
    // Fee ended 60+ days ago, or never paid and joined 60+ days ago
    unpaid_2_months: overdue !== null ? overdue >= UNPAID_DAYS : sinceJoin !== null && sinceJoin >= UNPAID_DAYS,
  };
}

const loadMembers = (gymId) =>
  fetchAll(() =>
    supabase
      .from('members')
      .select('id, name, phone, membership_id, status, latest_expiry, join_date, fingerprint_id')
      .eq('gym_id', gymId)
      .neq('status', 'deleted')
      .not('fingerprint_id', 'is', null)
      .order('id'),
  );

// ── GET /api/device/users ─── Everything the screen shows
router.get('/users', async (req, res) => {
  const gymId = req.user.gym_id;
  const sn = deviceSync.primaryDevice();
  const device = deviceSync.getStatus(sn);

  const [rowsRes, membersRes] = await Promise.all([
    fetchAll(() => supabase.from('device_users').select('*').eq('gym_id', gymId).eq('device_sn', sn).order('pin')),
    loadMembers(gymId),
  ]);
  if (membersRes.error) throw membersRes.error;
  if (rowsRes.error) {
    if (deviceSync.isMissingTable(rowsRes.error)) {
      return res.json({ success: true, data: { tableMissing: true, message: TABLE_MISSING_MESSAGE, device, users: [], softwareOnly: [], hasList: false } });
    }
    throw rowsRes.error;
  }

  const today = gymToday();
  const memberByFp = new Map(membersRes.data.map((m) => [clean(m.fingerprint_id), m]));
  const rows = rowsRes.data;
  const hasList = rows.some((r) => r.source === 'initial' || r.source === 'device_list');

  const users = rows
    .filter((r) => r.on_device)
    .map((r) => {
      const m = memberByFp.get(clean(r.pin));
      return {
        pin: r.pin,
        device_name: r.name,
        privilege: r.privilege,
        card: r.card,
        fingers: r.fingers,
        has_face: r.has_face,
        source: r.source,
        first_seen_at: r.first_seen_at,
        enrolled_at: r.enrolled_at,
        last_seen_at: r.last_seen_at,
        last_scan_at: r.last_scan_at,
        dismissed: !!r.dismissed_at,
        member: m ? memberSummary(m, today) : null,
        // Appeared after the first full read (enrolled, scanned or newly listed)
        // and not added in the software yet
        is_new: !m && r.source !== 'initial' && !r.dismissed_at,
      };
    });

  // Members with a fingerprint ID the machine does not have. Only known once
  // the machine's full list has been read.
  const onDevice = new Set(users.map((u) => clean(u.pin)));
  const softwareOnly = hasList
    ? membersRes.data
      .filter((m) => !onDevice.has(clean(m.fingerprint_id)))
      .map((m) => ({ fingerprint_id: m.fingerprint_id, ...memberSummary(m, today) }))
    : [];

  res.json({ success: true, data: { device, users, softwareOnly, hasList, unpaidDays: UNPAID_DAYS } });
});

// ── GET /api/device/new-count ─── Badge in the menu: new registrations not added yet
router.get('/new-count', async (req, res) => {
  const gymId = req.user.gym_id;
  const { data: rows, error } = await supabase
    .from('device_users')
    .select('pin')
    .eq('gym_id', gymId)
    .eq('device_sn', deviceSync.primaryDevice())
    .eq('on_device', true)
    .neq('source', 'initial')
    .is('dismissed_at', null)
    .limit(1000);
  if (error) {
    if (deviceSync.isMissingTable(error)) return res.json({ success: true, data: { count: 0 } });
    throw error;
  }
  if (!rows.length) return res.json({ success: true, data: { count: 0 } });
  const { data: linked, error: memberError } = await supabase
    .from('members')
    .select('fingerprint_id')
    .eq('gym_id', gymId)
    .neq('status', 'deleted')
    .in('fingerprint_id', rows.map((r) => r.pin));
  if (memberError) throw memberError;
  const linkedPins = new Set((linked || []).map((m) => clean(m.fingerprint_id)));
  res.json({ success: true, data: { count: rows.filter((r) => !linkedPins.has(r.pin)).length } });
});

// ── POST /api/device/sync ─── Ask the machine for its full user list
router.post('/sync', async (req, res) => {
  try {
    const read = await deviceSync.startFullSync(req.user.gym_id);
    const device = deviceSync.getStatus();
    res.json({
      success: true,
      data: device,
      message: device.online
        ? 'Asked the machine for its user list. It usually answers within a minute.'
        : 'The machine is not connected right now. The request will go out as soon as it reconnects (within 15 minutes).',
      startedAt: new Date(read.startedAt).toISOString(),
    });
  } catch (err) {
    if (deviceSync.isMissingTable(err)) return res.status(409).json({ success: false, message: TABLE_MISSING_MESSAGE });
    throw err;
  }
});

const deleteSchema = z.object({
  pins: z.array(z.union([z.string(), z.number()]).transform((v) => String(v).trim())).min(1).max(200),
});

// ── POST /api/device/delete ─── Delete users from the machine
// A linked member is deleted in the software only after the machine confirms.
router.post('/delete', async (req, res) => {
  const { pins } = deleteSchema.parse(req.body);
  const unique = [...new Set(pins)];
  const bad = unique.filter((p) => !deviceSync.cleanPin(p));
  if (bad.length) {
    return res.status(400).json({ success: false, message: `Not a valid fingerprint ID: ${bad.slice(0, 5).join(', ')}` });
  }

  const gymId = req.user.gym_id;
  const { data: members, error } = await supabase
    .from('members')
    .select('id, name, fingerprint_id')
    .eq('gym_id', gymId)
    .neq('status', 'deleted')
    .in('fingerprint_id', unique);
  if (error) throw error;
  const byFp = new Map((members || []).map((m) => [clean(m.fingerprint_id), m]));

  const { data: rows } = await supabase
    .from('device_users')
    .select('pin, name')
    .eq('gym_id', gymId)
    .in('pin', unique);
  const nameByPin = new Map((rows || []).map((r) => [r.pin, r.name]));

  const result = deviceSync.queueDeletes(
    gymId,
    unique.map((pin) => ({
      pin,
      memberId: byFp.get(pin)?.id,
      memberName: byFp.get(pin)?.name,
      deviceName: nameByPin.get(pin) || null,
    })),
  );
  const device = deviceSync.getStatus();
  res.json({
    success: true,
    data: { ...result, device },
    message: device.online
      ? `Sending ${result.queued.length} delete${result.queued.length === 1 ? '' : 's'} to the machine…`
      : 'The machine is not connected right now. The deletes will go out as soon as it reconnects (within 15 minutes).',
  });
});

// ── GET /api/device/commands?ids=1,2 ─── Progress of sent commands
router.get('/commands', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500);
  res.json({ success: true, data: { commands: deviceSync.getCommands(ids), device: deviceSync.getStatus() } });
});

// ── PUT /api/device/users/:pin/dismiss ─── Hide / show in "New registrations"
router.put('/users/:pin/dismiss', async (req, res) => {
  const pin = deviceSync.cleanPin(req.params.pin);
  if (!pin) return res.status(400).json({ success: false, message: 'Not a valid fingerprint ID' });
  const dismissed = req.body?.dismissed !== false;
  const { data, error } = await supabase
    .from('device_users')
    .update({ dismissed_at: dismissed ? new Date().toISOString() : null })
    .eq('gym_id', req.user.gym_id)
    .eq('device_sn', deviceSync.primaryDevice())
    .eq('pin', pin)
    .select('pin');
  if (error) {
    if (deviceSync.isMissingTable(error)) return res.status(409).json({ success: false, message: TABLE_MISSING_MESSAGE });
    throw error;
  }
  if (!data?.length) return res.status(404).json({ success: false, message: `Fingerprint ID ${pin} is not in the machine list` });
  res.json({ success: true, message: dismissed ? `ID ${pin} hidden from new registrations` : `ID ${pin} shown again` });
});

module.exports = router;
