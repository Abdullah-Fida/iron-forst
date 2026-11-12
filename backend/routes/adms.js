const express = require('express');
const { handleAdmsEvent } = require('../controllers/fingerprintController');
const deviceSync = require('../services/deviceSync');

// ZKTeco sends its payloads as raw text, not JSON.
const readText = express.text({ type: '*/*', limit: '2mb' });

// Notes how much of the upload arrived. If the device never finishes sending,
// this never runs and the trace keeps only the size it declared.
const rawText = (req, res, next) =>
  readText(req, res, (err) => {
    if (req.deviceHit && typeof req.body === 'string') {
      req.deviceHit.receivedBytes = Buffer.byteLength(req.body);
    }
    next(err);
  });

// The device parses plain text only. Answering with JSON — which is what the
// generic API 404 handler used to do for these paths — makes the firmware treat
// the reply as garbage and abandon the sync loop.
const plain = (res, body) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  return res.send(body);
};

// Every request the device makes is logged, including ones we do not otherwise
// act on. Without this there is no way to tell "the device never reached us"
// apart from "the device reached us and we answered badly".
// A small in-memory record of what the device has asked for, so the state of
// the link can be read straight off an endpoint instead of scrolling a hosting
// dashboard. Deliberately holds no member data — only enough to tell "the
// device is reaching us" apart from "it is not". Resets when the process
// restarts, which is fine for a live diagnostic.
const MAX_HITS = 60;
const recentHits = [];
let totalHits = 0;
const bootedAt = new Date().toISOString();

// Only these devices may upload scans. The ZKTeco push protocol has no password:
// the serial number in the URL is the only thing identifying the device, so an
// upload from any other serial is ignored (an approved "scan" opens the door).
// The list (env DEVICE_SERIALS) lives in deviceSync, which also only ever
// sends commands to these devices.
const { isKnownDevice } = deviceSync;
const rejected = { count: 0, lastAt: null };

// The internet address the request came from. Behind Render's proxy req.ip is
// the proxy itself, so the forwarded header carries the gym's real address.
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();

// Raw text of an upload, whatever shape the body ended up in.
const bodyText = (body) => {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString();
  if (body && typeof body === 'object' && Object.keys(body).length) return new URLSearchParams(body).toString();
  return '';
};

// What the device was doing, without anything that identifies it: this list is
// served publicly on /device-status, so no serial number, URL or IP address.
const describe = (hit) => {
  const info = /[?&]INFO=([^&]*)/.exec(hit.path || '');
  const out = {
    at: hit.at,
    method: hit.method,
    kind: hit.table
      ? `upload:${hit.table}`
      : /options=/.test(hit.path || '') ? 'handshake' : /getrequest/.test(hit.path || '') ? 'poll' : 'other',
    knownDevice: hit.knownDevice,
  };
  if (info) out.scansOnDevice = Number(decodeURIComponent(info[1]).split(',')[3]) || null;
  for (const k of ['declaredBytes', 'receivedBytes', 'status', 'ms', 'closedWithoutReply', 'ignored', 'commandsSent']) {
    if (hit[k] !== undefined) out[k] = hit[k];
  }
  return out;
};

const getDeviceActivity = () => {
  const lastKnown = recentHits.find((h) => h.knownDevice);
  return {
    serverTime: new Date().toISOString(),
    bootedAt,
    totalRequestsSinceBoot: totalHits,
    deviceLastSeen: lastKnown ? lastKnown.at : null,
    rejectedUploadsFromUnknownDevices: rejected,
    lastRequest: recentHits[0] ? describe(recentHits[0]) : null,
    recent: recentHits.map(describe),
  };
};

/**
 * Data uploads (scans, logs) are only processed for a known device. Anything
 * else still gets the plain "OK" a device expects, so nothing on the wire
 * changes, but the data is dropped and counted.
 */
const requireKnownDevice = (req, res, next) => {
  if (isKnownDevice(req.query.SN)) return next();
  rejected.count += 1;
  rejected.lastAt = new Date().toISOString();
  if (req.deviceHit) req.deviceHit.ignored = 'unknown device';
  console.warn(`[DEVICE] ⚠️ Ignored ${req.method} ${req.path} from unknown device SN=${req.query.SN || '(none)'}`);
  // Drain the body so the connection is reused cleanly, then acknowledge
  req.resume();
  return plain(res, 'OK');
};

const traceDevice = (req, res, next) => {
  const ip = clientIp(req);
  try {
    deviceSync.noteSeen(req.query.SN, ip, req.query.INFO);
  } catch (err) {
    console.error('[DEVICE] noteSeen failed:', err.message);
  }

  totalHits += 1;
  const startedAt = Date.now();
  const hit = {
    at: new Date(startedAt).toISOString(),
    method: req.method,
    path: req.originalUrl,
    sn: req.query.SN || null,
    knownDevice: isKnownDevice(req.query.SN),
    table: req.query.table || null,
    ip,
  };
  // The device has been seen to send the start of an upload and then go silent
  // for good. Recording what it declared, what actually arrived and whether we
  // answered tells "it never finished sending" apart from "it never read our
  // reply". Sizes and timings only — no body content, as this list is public.
  if (req.method === 'POST') {
    hit.declaredBytes = req.headers['content-length'] ?? null;
    hit.contentType = req.headers['content-type'] ?? null;
    if (req.headers.expect) hit.expect = req.headers.expect;
    if (req.headers['transfer-encoding']) hit.transferEncoding = req.headers['transfer-encoding'];
  }
  req.deviceHit = hit;
  if (req.headers['user-agent']) hit.userAgent = req.headers['user-agent'];
  res.on('finish', () => {
    hit.status = res.statusCode;
    hit.ms = Date.now() - startedAt;
  });
  res.on('close', () => {
    if (!res.writableFinished) hit.closedWithoutReply = Date.now() - startedAt;
  });
  recentHits.unshift(hit);
  if (recentHits.length > MAX_HITS) recentHits.pop();

  console.log(
    `\n[DEVICE] ${req.method} ${req.originalUrl} | SN=${req.query.SN || '-'} | ip=${ip}`
  );
  next();
};

// The registration handshake. The device opens with
//   GET /iclock/cdata?SN=...&options=all&pushver=...
// and expects this exact block back. It used to receive the literal string
// "OK", which several firmwares treat as a failed handshake — they then never
// progress to sending ATTLOG rows, which is why scans produced no data at all.
// TransFlag's bit positions select which tables the device pushes; 1111000000
// turns on attendance, operation and user logs. Realtime=1 makes it push each
// scan as it happens rather than batching.
const buildOptions = (sn) =>
  [
    `GET OPTION FROM: ${sn}`,
    'Stamp=9999',
    'OpStamp=9999',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=1111000000',
    `TimeZone=${process.env.DEVICE_TIMEZONE || '5'}`,
    'Realtime=1',
    'Encrypt=0',
  ].join('\n');

// ── /iclock/* — the paths ZKTeco firmware actually calls ────────────────────
const iclockRouter = express.Router();
iclockRouter.use(traceDevice);

iclockRouter.get('/cdata', (req, res) => {
  const sn = req.query.SN || 'UNKNOWN';
  // "options" marks the registration request. Anything else on GET /cdata is a
  // status poll, which only wants an acknowledgement.
  if (req.query.options) return plain(res, buildOptions(sn));
  return plain(res, 'OK');
});

// Attendance scans arrive here.
iclockRouter.post('/cdata', requireKnownDevice, rawText, handleAdmsEvent);

// The device long-polls this for commands to run. Usually there are none and
// the answer is the plain OK that keeps the loop alive. When the owner asked
// to read or delete users (Fingerprint machine screen), the commands go out
// here, one "C:<id>:<command>" per line. Any problem falls back to OK.
iclockRouter.all('/getrequest', (req, res) => {
  let lines = [];
  try {
    lines = deviceSync.takeCommands(req.query.SN, clientIp(req));
  } catch (err) {
    console.error('[DEVICE] takeCommands failed:', err.message);
  }
  if (lines.length && req.deviceHit) req.deviceHit.commandsSent = lines.length;
  return plain(res, lines.length ? lines.join('\n') : 'OK');
});

// Result of a command we issued. Acknowledge so the device clears its queue.
iclockRouter.all('/devicecmd', requireKnownDevice, rawText, (req, res) => {
  try {
    deviceSync.handleCommandResults(req.query.SN, bodyText(req.body), clientIp(req));
  } catch (err) {
    console.error('[DEVICE] command results failed:', err.message);
  }
  return plain(res, 'OK');
});

// Newer firmwares answer a user-list query here instead of /cdata.
iclockRouter.post('/querydata', requireKnownDevice, rawText, (req, res) => {
  const table = req.query.tablename || req.query.table || '';
  if (req.deviceHit) req.deviceHit.table = `query:${table}`;
  deviceSync.handleUpload(req.query.SN, table, bodyText(req.body));
  return plain(res, 'OK');
});

iclockRouter.all('/ping', (req, res) => plain(res, 'OK'));
iclockRouter.all('/registry', (req, res) => plain(res, `RegistryCode=${req.query.SN || 'OK'}`));
iclockRouter.all('/push', (req, res) => plain(res, 'OK'));

// Firmware varies in which extra paths it calls. Anything unrecognised gets a
// plain OK rather than a JSON 404, so one unexpected path cannot stall the
// device. The trace log above still records what it was.
iclockRouter.all('*', (req, res) => plain(res, 'OK'));

// ── /adms — kept for devices configured against the older path ──────────────
const admsRouter = express.Router();
admsRouter.use(traceDevice);
admsRouter.post('/', requireKnownDevice, rawText, handleAdmsEvent);
admsRouter.get('/', (req, res) => plain(res, 'OK'));

module.exports = { admsRouter, iclockRouter, getDeviceActivity };
