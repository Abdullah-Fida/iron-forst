const express = require('express');
const { handleAdmsEvent } = require('../controllers/fingerprintController');

// ZKTeco sends its payloads as raw text, not JSON.
const rawText = express.text({ type: '*/*', limit: '2mb' });

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
const traceDevice = (req, res, next) => {
  console.log(
    `\n[DEVICE] ${req.method} ${req.originalUrl} | SN=${req.query.SN || '-'} | ip=${req.ip}`
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
iclockRouter.post('/cdata', rawText, handleAdmsEvent);

// The device long-polls this for commands to run. We have none to send, so an
// empty OK is the correct answer — it keeps the loop alive.
iclockRouter.all('/getrequest', (req, res) => plain(res, 'OK'));

// Result of a command we issued. Acknowledge so the device clears its queue.
iclockRouter.all('/devicecmd', rawText, (req, res) => plain(res, 'OK'));

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
admsRouter.post('/', rawText, handleAdmsEvent);
admsRouter.get('/', (req, res) => plain(res, 'OK'));

module.exports = { admsRouter, iclockRouter };
