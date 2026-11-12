/**
 * Talking back to the fingerprint machine: reading its user list, noticing new
 * enrolments, and deleting users from it.
 *
 * How the ZKTeco push protocol does this: the machine asks
 * GET /iclock/getrequest every few seconds. Normally the answer is "OK". When
 * we have work for it, the answer is one command per line, "C:<id>:<command>".
 * The machine runs them and reports each result to POST /iclock/devicecmd as
 * "ID=<id>&Return=<code>&CMD=...". Data it was asked for (users) arrives as an
 * ordinary upload to /iclock/cdata (OPERLOG / USERINFO) or /iclock/querydata.
 *
 * Safety rules kept here:
 *  - Commands only ever go to our own machine (serial allowlist).
 *  - Only three commands exist: read all users, read one user, delete one
 *    user. Nothing that clears logs or data can be built.
 *  - A PIN must be letters/digits only, so nothing can be smuggled into a
 *    command line.
 *  - A delete result is accepted only from the same internet address the
 *    command was handed to.
 *  - Every DB step here is wrapped: a failure is logged and never reaches the
 *    scan / door path, and the machine always gets its plain "OK".
 */
const { supabase } = require('../db/supabase');
const { softDeleteMember } = require('./memberIds');

const TABLE = 'device_users';

// ── Which machines are ours ───────────────────────────────────────────────────
const KNOWN_DEVICES = String(process.env.DEVICE_SERIALS || 'UFS2261401174')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const normSn = (sn) => String(sn || '').trim().toUpperCase();
const isKnownDevice = (sn) => KNOWN_DEVICES.includes(normSn(sn));
const primaryDevice = () => KNOWN_DEVICES[0] || null;

const PIN_RE = /^[0-9A-Za-z]{1,14}$/;
const cleanPin = (p) => {
  const s = String(p ?? '').trim();
  return PIN_RE.test(s) ? s : null;
};

const isMissingTable = (err) =>
  !!err && (err.code === '42P01' || err.code === 'PGRST205' || /device_users/.test(String(err.message || '')));

// ── Tunables (an object so tests can shorten the waits) ──────────────────────
const T = {
  SEND_PER_POLL: 20,                 // commands handed over per poll
  REPLY_TIMEOUT_MS: 3 * 60 * 1000,   // handed over but never confirmed
  PICKUP_TIMEOUT_MS: 15 * 60 * 1000, // queued but the machine never asked
  ONLINE_MS: 90 * 1000,              // seen this recently = online
  PIN_QUERY_COOLDOWN_MS: 60 * 60 * 1000,
  LIST_QUIET_MS: 20 * 1000,          // no new users for this long = list finished
  LIST_WAIT_MS: 45 * 1000,           // answered "OK" but sent no users
  FULL_SYNC_MAX_MS: 20 * 60 * 1000,
  MAX_KEPT_COMMANDS: 1000,
};

const COMMANDS = {
  queryAll: () => 'DATA QUERY USERINFO',
  // Newer firmwares answer this form instead, through /iclock/querydata
  queryAllTable: () => 'DATA QUERY tablename=user,fielddesc=*,filter=*',
  queryPin: (pin) => `DATA QUERY USERINFO PIN=${pin}`,
  deletePin: (pin) => `DATA DELETE USERINFO PIN=${pin}`,
};

// ZKTeco operation-log codes that mean "a user was enrolled / changed"
const ENROL_CODES = new Set([6, 7, 8, 30, 36, 68, 69, 70, 71]);

// ── In-memory state (resets when the server restarts; the user list itself is in the DB) ──
const state = {
  devices: new Map(), // SN -> { lastSeenAt, ip, info }
  commands: [],
  nextId: Number(String(Date.now()).slice(-7)),
  fullSync: null,
  pinQueriedAt: new Map(),
  pendingEnrol: new Map(), // pin -> ISO time the machine reported the enrolment
};

let cachedGymId = null;
async function defaultGymId() {
  if (cachedGymId) return cachedGymId;
  const { data, error } = await supabase.from('gyms').select('id').order('created_at').limit(1);
  if (error) throw error;
  cachedGymId = data?.[0]?.id || null;
  return cachedGymId;
}

// Work on uploads one at a time, in arrival order, without making the machine wait.
let chain = Promise.resolve();
const serial = (label, fn) => {
  chain = chain.then(fn).catch((err) => console.error(`[DEVICE-SYNC] ${label} failed:`, err.message));
  return chain;
};

// ── Device presence ──────────────────────────────────────────────────────────
function noteSeen(sn, ip, info) {
  const key = normSn(sn);
  if (!isKnownDevice(key)) return;
  const d = state.devices.get(key) || {};
  d.lastSeenAt = Date.now();
  d.ip = ip || d.ip;
  if (info) {
    // "Ver 8.0.4.2,187,191,689,192.168.1.71,..." = firmware, users, fingerprints, scans, LAN IP
    const parts = String(info).split(',');
    const n = (i) => (Number.isFinite(Number(parts[i])) && parts[i] !== '' ? Number(parts[i]) : null);
    d.info = { users: n(1), fingerprints: n(2), scans: n(3), at: new Date().toISOString() };
  }
  state.devices.set(key, d);
}

// ── Command queue ─────────────────────────────────────────────────────────────
function addCommand(sn, kind, text, extra = {}) {
  const cmd = {
    id: String(state.nextId++),
    sn: normSn(sn),
    kind,
    text,
    status: 'queued',
    createdAt: Date.now(),
    ...extra,
  };
  state.commands.push(cmd);
  if (state.commands.length > T.MAX_KEPT_COMMANDS) {
    // Drop the oldest finished ones first
    const i = state.commands.findIndex((c) => c.status === 'done' || c.status === 'failed');
    state.commands.splice(i >= 0 ? i : 0, 1);
  }
  return cmd;
}

const isOpen = (c) => c.status === 'queued' || c.status === 'sent';

function expireStale(now = Date.now()) {
  for (const c of state.commands) {
    if (c.status === 'sent' && now - c.sentAt > T.REPLY_TIMEOUT_MS) {
      c.status = 'failed';
      c.error = 'The machine took the command but never confirmed it.';
      c.doneAt = now;
    } else if (c.status === 'queued' && now - c.createdAt > T.PICKUP_TIMEOUT_MS) {
      c.status = 'failed';
      c.error = 'The machine did not connect in time, so nothing was sent to it.';
      c.doneAt = now;
    }
  }
}

/** Lines to answer GET /iclock/getrequest with. Empty = answer "OK" as always. */
function takeCommands(sn, ip) {
  if (!isKnownDevice(sn)) return [];
  const now = Date.now();
  expireStale(now);
  progress();
  const out = [];
  for (const c of state.commands) {
    if (out.length >= T.SEND_PER_POLL) break;
    if (c.sn === normSn(sn) && c.status === 'queued') {
      c.status = 'sent';
      c.sentAt = now;
      c.sentToIp = ip || null;
      out.push(`C:${c.id}:${c.text}`);
    }
  }
  if (out.length) console.log(`[DEVICE-SYNC] Sent ${out.length} command(s) to ${normSn(sn)}: ${out.map((l) => l.split(':').slice(2).join(':')).join(' | ')}`);
  progress();
  return out;
}

/** POST /iclock/devicecmd body: one "ID=..&Return=..&CMD=.." per line. */
function handleCommandResults(sn, body, ip) {
  if (!isKnownDevice(sn)) return;
  const lines = String(body || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const params = new URLSearchParams(line);
    const id = params.get('ID');
    const ret = Number(params.get('Return'));
    const cmd = state.commands.find((c) => c.id === id);
    if (!cmd || cmd.status !== 'sent') continue;
    if (cmd.sentToIp && ip && cmd.sentToIp !== ip) {
      console.warn(`[DEVICE-SYNC] ⚠️ Ignored result for command ${id}: came from a different address than the machine`);
      continue;
    }
    cmd.returnCode = Number.isFinite(ret) ? ret : null;
    cmd.status = Number.isFinite(ret) && ret >= 0 ? 'done' : 'failed';
    if (cmd.status === 'failed') cmd.error = `The machine refused the command (code ${params.get('Return')}).`;
    cmd.doneAt = Date.now();
    console.log(`[DEVICE-SYNC] Command ${id} (${cmd.text}) -> Return=${params.get('Return')}`);
    if (cmd.kind === 'delete') serial(`after delete ${cmd.pin}`, () => afterDelete(cmd));
  }
  progress();
}

async function afterDelete(cmd) {
  if (cmd.status !== 'done') return;
  const { error } = await supabase
    .from(TABLE)
    .update({ on_device: false, removed_at: new Date().toISOString() })
    .eq('gym_id', cmd.gymId)
    .eq('device_sn', cmd.sn)
    .eq('pin', cmd.pin);
  if (error && !isMissingTable(error)) console.error('[DEVICE-SYNC] Could not mark removed:', error.message);

  if (!cmd.memberId) return;
  try {
    const r = await softDeleteMember(cmd.gymId, cmd.memberId, { expectFingerprint: cmd.pin });
    cmd.memberResult = r.ok ? (r.already ? 'already_deleted' : 'deleted') : r.reason;
    console.log(`[DEVICE-SYNC] Member ${cmd.memberName || cmd.memberId} (FP ${cmd.pin}) in software: ${cmd.memberResult}`);
  } catch (err) {
    cmd.memberResult = 'error';
    cmd.error = `Removed from the machine, but the member could not be deleted in the software: ${err.message}`;
    console.error('[DEVICE-SYNC] Soft delete after device delete failed:', err.message);
  }
}

function queuePinQuery(sn, pin, { force = false } = {}) {
  const p = cleanPin(pin);
  if (!p || p === '0') return null;
  const last = state.pinQueriedAt.get(p) || 0;
  if (!force && Date.now() - last < T.PIN_QUERY_COOLDOWN_MS) return null;
  if (state.commands.some((c) => isOpen(c) && c.kind === 'query_pin' && c.pin === p)) return null;
  state.pinQueriedAt.set(p, Date.now());
  return addCommand(sn, 'query_pin', COMMANDS.queryPin(p), { pin: p });
}

// ── Reading the whole user list ──────────────────────────────────────────────
async function startFullSync(gymId, sn = primaryDevice()) {
  progress();
  const fs = state.fullSync;
  if (fs && fs.sn === normSn(sn) && fs.status === 'running') return fs;

  // The very first read marks everyone already on the machine as "existing",
  // so they are not shown as new registrations.
  const { data, error } = await supabase
    .from(TABLE)
    .select('id')
    .eq('gym_id', gymId)
    .eq('device_sn', normSn(sn))
    .in('source', ['initial', 'device_list'])
    .limit(1);
  if (error) throw error;

  const cmds = [
    addCommand(sn, 'query_all', COMMANDS.queryAll()),
    addCommand(sn, 'query_all', COMMANDS.queryAllTable()),
  ];
  state.fullSync = {
    sn: normSn(sn),
    gymId,
    initial: !data?.length,
    startedAt: Date.now(),
    commandIds: cmds.map((c) => c.id),
    usersReceived: 0,
    pins: new Set(),
    lastUserAt: null,
    status: 'running',
    stage: 'list',
  };
  return state.fullSync;
}

const activeFullSync = (sn) => {
  const fs = state.fullSync;
  return fs && fs.status === 'running' && fs.sn === normSn(sn) ? fs : null;
};

// Moves a running read along. Called whenever something happens.
function progress() {
  const fs = state.fullSync;
  if (!fs || fs.status !== 'running') return;
  const now = Date.now();
  if (now - fs.startedAt > T.FULL_SYNC_MAX_MS) {
    fs.status = fs.usersReceived ? 'done' : 'failed';
    fs.message = fs.usersReceived ? 'Stopped waiting for more users.' : 'The machine did not send its user list.';
    fs.finishedAt = now;
    return;
  }
  if (fs.stage === 'by_pin' && !fs.perPinQueued) return; // still being queued
  const cmds = state.commands.filter((c) => fs.commandIds.includes(c.id));
  const allAnswered = cmds.every((c) => !isOpen(c));
  if (!allAnswered) return;
  const answeredAt = Math.max(0, ...cmds.map((c) => c.doneAt || 0));

  if (fs.usersReceived > 0) {
    if (now - Math.max(fs.lastUserAt || 0, answeredAt) > T.LIST_QUIET_MS) {
      fs.status = 'done';
      fs.finishedAt = now;
      fs.message = null;
      serial('mark users gone', () => sweepMissing(fs));
    }
    return;
  }
  if (now - answeredAt < T.LIST_WAIT_MS) return;

  if (fs.stage === 'list') {
    // The machine did not send everyone at once: ask about each known ID instead.
    fs.stage = 'by_pin';
    fs.message = 'Checking each fingerprint ID one by one…';
    serial('queue per-ID check', () => queuePerPin(fs));
    return;
  }
  fs.status = 'failed';
  fs.finishedAt = now;
  fs.message = 'The machine answered but sent no users.';
}

async function queuePerPin(fs) {
  const pins = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('members')
      .select('fingerprint_id')
      .eq('gym_id', fs.gymId)
      .neq('status', 'deleted')
      .not('fingerprint_id', 'is', null)
      .range(from, from + 999);
    if (error) throw error;
    data.forEach((m) => cleanPin(m.fingerprint_id) && pins.add(cleanPin(m.fingerprint_id)));
    if (data.length < 1000) break;
  }
  const { data: rows } = await supabase.from(TABLE).select('pin').eq('gym_id', fs.gymId).eq('device_sn', fs.sn);
  (rows || []).forEach((r) => pins.add(r.pin));
  const cmds = [...pins].map((p) => queuePinQuery(fs.sn, p, { force: true })).filter(Boolean);
  fs.commandIds = cmds.map((c) => c.id);
  fs.perPinQueued = true;
  if (!cmds.length) {
    fs.status = 'failed';
    fs.finishedAt = Date.now();
    fs.message = 'The machine did not send its user list.';
  }
}

/**
 * After a complete read, anyone listed before but not in this read has been
 * removed on the machine itself. Only done when the read is provably complete
 * (the machine's own user count matches), so a half-sent list never hides anyone.
 */
async function sweepMissing(fs) {
  const reported = state.devices.get(fs.sn)?.info?.users;
  if (!reported || fs.usersReceived < reported * 0.9) {
    fs.complete = false;
    if (reported) fs.message = `Read ${fs.usersReceived} of the ${reported} users the machine reports.`;
    return;
  }
  fs.complete = true;
  const { error } = await supabase
    .from(TABLE)
    .update({ on_device: false, removed_at: new Date().toISOString() })
    .eq('gym_id', fs.gymId)
    .eq('device_sn', fs.sn)
    .eq('on_device', true)
    .lt('last_seen_at', new Date(fs.startedAt).toISOString())
    // Someone who scanned during the read is certainly still there
    .or(`last_scan_at.is.null,last_scan_at.lt.${new Date(fs.startedAt).toISOString()}`);
  if (error) throw error;
}

// ── Uploads from the machine ─────────────────────────────────────────────────
/**
 * Splits an upload into records. A line is "<KIND> key=value\tkey=value…"
 * (OPERLOG), "key=value\t…" with the kind given by the table (USERINFO), or
 * "OPLOG code\tadmin\ttime\tobj1…" (positional).
 */
function parseRecords(text, defaultKind) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let kind = defaultKind;
    let rest = line;
    const m = /^([A-Za-z][A-Za-z0-9]*)\s+(.*)$/.exec(line);
    if (m && !m[1].includes('=')) {
      kind = m[1].toUpperCase();
      rest = m[2];
    }
    if (!kind) continue;
    if (kind === 'OPLOG') {
      out.push({ kind, values: rest.split('\t').map((s) => s.trim()) });
      continue;
    }
    const fields = {};
    for (const part of rest.split('\t')) {
      const i = part.indexOf('=');
      if (i > 0) fields[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
    out.push({ kind, fields });
  }
  return out;
}

const KIND_FOR_TABLE = {
  USERINFO: 'USER',
  USER: 'USER',
  FINGERTMP: 'FP',
  TEMPLATEV10: 'FP',
  BIODATA: 'BIODATA',
  FACE: 'FACE',
};

/** Device time "2026-10-07 19:09:26" (gym local) -> ISO */
function deviceTimeIso(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text || '');
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const tz = Number(process.env.DEVICE_TIMEZONE || 5);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - tz * 3600e3).toISOString();
}

/**
 * Anything the machine uploads that is not a scan. Never throws; the machine
 * has already been answered.
 */
function handleUpload(sn, table, body) {
  if (!isKnownDevice(sn)) return Promise.resolve();
  return serial(`upload ${table}`, async () => {
    const records = parseRecords(body, KIND_FOR_TABLE[String(table || '').toUpperCase()] || null);
    if (!records.length) return;

    const users = new Map();
    const fingers = new Map();
    const faces = new Set();
    for (const r of records) {
      const pin = cleanPin(r.fields?.pin);
      if (r.kind === 'USER' && pin) {
        users.set(pin, {
          pin,
          name: (r.fields.name || '').trim() || null,
          privilege: Number.isFinite(Number(r.fields.pri ?? r.fields.privilege)) ? Number(r.fields.pri ?? r.fields.privilege) : null,
          card: (r.fields.card || r.fields.cardno || '').trim() || null,
        });
      } else if ((r.kind === 'FP' || r.kind === 'FINGERTMP' || r.kind === 'TEMPLATEV10') && pin) {
        const set = fingers.get(pin) || new Set();
        set.add(r.fields.fid ?? r.fields.fingerid ?? set.size);
        fingers.set(pin, set);
      } else if (r.kind === 'FACE' && pin) {
        faces.add(pin);
      } else if (r.kind === 'BIODATA' && pin) {
        const type = Number(r.fields.type);
        if (type === 1) {
          const set = fingers.get(pin) || new Set();
          set.add(r.fields.no ?? set.size);
          fingers.set(pin, set);
        } else if (type === 2 || type === 9) faces.add(pin);
      } else if (r.kind === 'OPLOG') {
        const [code, , time, obj1] = r.values;
        const p = cleanPin(obj1);
        if (ENROL_CODES.has(Number(code)) && p && p !== '0') {
          state.pendingEnrol.set(p, deviceTimeIso(time) || new Date().toISOString());
          console.log(`[DEVICE-SYNC] Machine reports enrolment/change for ID ${p} (code ${code}) — asking for details`);
          queuePinQuery(sn, p, { force: true });
        }
      }
    }

    // Template uploads without a user line: ask the machine who it is.
    for (const pin of new Set([...fingers.keys(), ...faces])) {
      if (!users.has(pin)) queuePinQuery(sn, pin);
    }
    if (!users.size && !fingers.size && !faces.size) return;

    const gymId = await defaultGymId();
    if (!gymId) return;
    await saveUsers(gymId, sn, [...users.values()], fingers, faces);
  });
}

async function saveUsers(gymId, sn, users, fingers, faces) {
  const device_sn = normSn(sn);
  const now = new Date().toISOString();
  const fs = activeFullSync(sn);

  if (users.length) {
    const source = fs ? (fs.initial ? 'initial' : 'device_list') : 'enrolment';
    // 1. Rows the table has never seen: remember how and when they appeared.
    const { error: insertError } = await supabase.from(TABLE).upsert(
      users.map((u) => ({ gym_id: gymId, device_sn, pin: u.pin, source, enrolled_at: state.pendingEnrol.get(u.pin) || null })),
      { onConflict: 'gym_id,device_sn,pin', ignoreDuplicates: true },
    );
    if (insertError) throw insertError;
    // 2. What the machine says about everyone now.
    const { error: updateError } = await supabase.from(TABLE).upsert(
      users.map((u) => ({
        gym_id: gymId, device_sn, pin: u.pin, name: u.name, privilege: u.privilege, card: u.card,
        last_seen_at: now, on_device: true, removed_at: null,
      })),
      { onConflict: 'gym_id,device_sn,pin' },
    );
    if (updateError) throw updateError;
    // 3. An enrolment report for someone already listed (e.g. first seen at the door)
    for (const u of users) {
      const at = state.pendingEnrol.get(u.pin);
      if (!at) continue;
      await supabase.from(TABLE).update({ enrolled_at: at }).eq('gym_id', gymId).eq('device_sn', device_sn).eq('pin', u.pin).is('enrolled_at', null);
      state.pendingEnrol.delete(u.pin);
    }
    if (fs) {
      users.forEach((u) => fs.pins.add(u.pin));
      fs.usersReceived = fs.pins.size;
      fs.lastUserAt = Date.now();
    }
    console.log(`[DEVICE-SYNC] Saved ${users.length} machine user(s)${fs ? ` (reading list: ${fs.usersReceived} so far)` : ''}`);
  }

  const byCount = new Map();
  for (const [pin, set] of fingers) {
    const list = byCount.get(set.size) || [];
    list.push(pin);
    byCount.set(set.size, list);
  }
  for (const [count, pins] of byCount) {
    await supabase.from(TABLE).update({ fingers: count }).eq('gym_id', gymId).eq('device_sn', device_sn).in('pin', pins);
  }
  if (faces.size) {
    await supabase.from(TABLE).update({ has_face: true }).eq('gym_id', gymId).eq('device_sn', device_sn).in('pin', [...faces]);
  }
}

/**
 * A finger matched a user on the machine but no member in the software: this
 * is someone enrolled on the machine and not yet added. Recorded so they show
 * up under "New registrations" even if the machine never reported the enrolment.
 */
function noteUnknownScan(sn, pin, scanTimeIso, gymId) {
  const p = cleanPin(pin);
  if (!p || !isKnownDevice(sn)) return Promise.resolve();
  return serial(`unknown scan ${p}`, async () => {
    const gid = gymId || (await defaultGymId());
    if (!gid) return;
    const device_sn = normSn(sn);
    const { error } = await supabase.from(TABLE).upsert(
      [{ gym_id: gid, device_sn, pin: p, source: 'scan', last_scan_at: scanTimeIso }],
      { onConflict: 'gym_id,device_sn,pin', ignoreDuplicates: true },
    );
    if (error) {
      if (!isMissingTable(error)) throw error;
      return;
    }
    await supabase.from(TABLE).update({ last_scan_at: scanTimeIso, on_device: true, removed_at: null })
      .eq('gym_id', gid).eq('device_sn', device_sn).eq('pin', p);
    queuePinQuery(sn, p); // fetch the name typed on the machine, at most once an hour
  });
}

// ── Deleting ──────────────────────────────────────────────────────────────────
/**
 * items: [{ pin, memberId?, memberName? }]. Each becomes one delete command;
 * the linked member is deleted in the software only after the machine
 * confirms (see afterDelete).
 */
function queueDeletes(gymId, items, sn = primaryDevice()) {
  const queued = [];
  const skipped = [];
  for (const item of items) {
    const pin = cleanPin(item.pin);
    if (!pin) { skipped.push({ pin: item.pin, reason: 'Not a valid fingerprint ID' }); continue; }
    const existing = state.commands.find((c) => isOpen(c) && c.kind === 'delete' && c.pin === pin);
    if (existing) { queued.push(publicCommand(existing)); continue; }
    const cmd = addCommand(sn, 'delete', COMMANDS.deletePin(pin), {
      pin, gymId, memberId: item.memberId || null, memberName: item.memberName || null, deviceName: item.deviceName || null,
    });
    queued.push(publicCommand(cmd));
  }
  return { queued, skipped };
}

// ── For the screen ───────────────────────────────────────────────────────────
const publicCommand = (c) => ({
  id: c.id, kind: c.kind, pin: c.pin || null, status: c.status, error: c.error || null,
  memberName: c.memberName || null, memberResult: c.memberResult || null,
  createdAt: new Date(c.createdAt).toISOString(), doneAt: c.doneAt ? new Date(c.doneAt).toISOString() : null,
});

function getCommands(ids) {
  expireStale();
  progress();
  const want = new Set((ids || []).map(String));
  return state.commands.filter((c) => want.has(c.id)).map(publicCommand);
}

function getStatus(sn = primaryDevice()) {
  expireStale();
  progress();
  const d = state.devices.get(normSn(sn)) || {};
  const fs = state.fullSync && state.fullSync.sn === normSn(sn) ? state.fullSync : null;
  const open = state.commands.filter((c) => c.sn === normSn(sn) && isOpen(c));
  return {
    configured: !!sn,
    online: !!d.lastSeenAt && Date.now() - d.lastSeenAt < T.ONLINE_MS,
    lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : null,
    reported: d.info || null,
    read: fs
      ? {
        status: fs.status,
        stage: fs.stage,
        startedAt: new Date(fs.startedAt).toISOString(),
        finishedAt: fs.finishedAt ? new Date(fs.finishedAt).toISOString() : null,
        usersReceived: fs.usersReceived,
        message: fs.message || null,
      }
      : null,
    pendingDeletes: open.filter((c) => c.kind === 'delete').map(publicCommand),
    pendingCommands: open.length,
  };
}

module.exports = {
  KNOWN_DEVICES,
  isKnownDevice,
  primaryDevice,
  cleanPin,
  isMissingTable,
  noteSeen,
  takeCommands,
  handleCommandResults,
  handleUpload,
  noteUnknownScan,
  startFullSync,
  queueDeletes,
  getCommands,
  getStatus,
  // for tests
  _tunables: T,
  _parseRecords: parseRecords,
  _state: state,
  _drain: () => chain,
};
