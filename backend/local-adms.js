/**
 * Local ADMS listener — plain HTTP, for the gym LAN.
 *
 * Why this exists: the cloud host sits behind Cloudflare and only accepts
 * HTTPS. A request from the device dies before it ever reaches our code if the
 * firmware speaks plain HTTP (edge redirect) or cannot negotiate modern TLS
 * (handshake failure). Either way the cloud /device-status counter reads zero,
 * so the two cases are indistinguishable from up there.
 *
 * This runs the SAME verified /iclock routes over plain HTTP on the local
 * network. If the device talks to this but not to the cloud, HTTPS is proven to
 * be the blocker.
 *
 * It also works as a stop-gap: scans are written to the same live Supabase
 * project, so attendance records normally while hosting is sorted out.
 *
 * Deliberately does NOT start the cron reminders or the WhatsApp service —
 * those run in production, and a second instance would double-send reminders
 * and fight over the WhatsApp session.
 *
 *   node local-adms.js
 */

require('dotenv').config();

const express = require('express');
const os = require('os');
const { admsRouter, iclockRouter, getDeviceActivity } = require('./routes/adms');

const PORT = Number(process.env.LOCAL_ADMS_PORT) || 8080;

const app = express();

app.get('/health', (req, res) =>
  res.json({ status: 'ok', mode: 'local-adms', time: new Date().toISOString() })
);

app.use('/iclock', iclockRouter);
app.use('/adms', admsRouter);

app.get('/device-status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(getDeviceActivity());
});

// Anything else gets a plain-text OK. Firmware differs in what it calls, and an
// unexpected 404 can stall the device's sync loop.
app.use((req, res) => {
  console.log(`[OTHER] ${req.method} ${req.originalUrl}`);
  res.type('text/plain').send('OK');
});

// Every IPv4 address on this machine, so the right one for the gym LAN is
// obvious rather than guessed.
const lanAddresses = () => {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push({ name, address: net.address });
    }
  }
  return out;
};

app.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  // 169.254.x is a self-assigned address (no DHCP) and is never reachable by
  // the device; 172.20.10.x is the Apple personal-hotspot range, which is a
  // different network from the gym WiFi.
  const usable = addrs.filter(
    (a) => !a.address.startsWith('169.254.') && !a.address.startsWith('172.20.10.')
  );

  console.log('\n========================================================');
  console.log('  LOCAL ADMS LISTENER RUNNING (plain HTTP, no TLS)');
  console.log('========================================================\n');
  console.log(`  Port: ${PORT}\n`);
  console.log('  This machine\'s addresses:');
  addrs.forEach((a) => {
    let note = '';
    if (a.address.startsWith('169.254.')) note = '  <- self-assigned, not usable';
    else if (a.address.startsWith('172.20.10.')) note = '  <- phone hotspot, NOT the gym WiFi';
    console.log(`    ${a.address.padEnd(16)} (${a.name})${note}`);
  });

  const pick = usable.find((a) => a.address.startsWith('192.168.')) || usable[0];

  console.log('\n--------------------------------------------------------');
  if (pick) {
    console.log('  SET THESE ON THE DEVICE:\n');
    console.log('    Server Mode         : ADMS');
    console.log('    Enable Domain Name  : OFF   <- important, so a port can be entered');
    console.log(`    Server Address      : ${pick.address}`);
    console.log(`    Server Port         : ${PORT}`);
    console.log('    Enable Proxy Server : OFF\n');
    console.log('  Then power-cycle the device.\n');
    console.log(`  Watch here:  http://${pick.address}:${PORT}/device-status`);
  } else {
    console.log('  No usable LAN address found.');
    console.log('  Connect this machine to the IRONFIST WiFi and restart.');
  }
  console.log('--------------------------------------------------------\n');
  console.log('  Waiting for the device. Each request prints below.');
  console.log('  Press Ctrl+C to stop.\n');
});
