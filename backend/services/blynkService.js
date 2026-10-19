/**
 * Opens the gym door through Blynk. The backend writes the door datastream;
 * the installer's ESP32 drives the relay from it. Replaces MQTT for the door.
 *
 * Env:
 *   BLYNK_TOKEN         device auth token (required — without it nothing is sent)
 *   BLYNK_SERVER        regional host, e.g. sgp1.blynk.cloud (default)
 *   BLYNK_DOOR_PIN      datastream that drives the relay (default V0)
 *   BLYNK_OPEN_VALUE    value that unlocks (default 0 — the ESP32 switches the relay on at 0)
 *   BLYNK_LOCKED_VALUE  value that locks (default 1)
 *   BLYNK_OPEN_MS       how long the door stays unlocked (default 10000 = 10 s)
 */

const SERVER = process.env.BLYNK_SERVER || 'sgp1.blynk.cloud';
const BASE = SERVER.startsWith('http') ? SERVER : `https://${SERVER}`;
const TOKEN = process.env.BLYNK_TOKEN;
const PIN = process.env.BLYNK_DOOR_PIN || 'V0';
const OPEN_VALUE = process.env.BLYNK_OPEN_VALUE ?? '0';
const LOCKED_VALUE = process.env.BLYNK_LOCKED_VALUE ?? '1';
const OPEN_MS = Number(process.env.BLYNK_OPEN_MS) || 10000;

let relockTimer = null;

const write = async (value) => {
  const url = `${BASE}/external/api/update?token=${encodeURIComponent(TOKEN)}&${PIN}=${encodeURIComponent(value)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Blynk ${res.status}: ${(await res.text()).slice(0, 200)}`);
};

// Relocking is the one write that must not be lost: a failure here would leave
// the door standing unlocked, so it is retried.
const relock = async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await write(LOCKED_VALUE);
      console.log(`🔒 Door relocked via Blynk (${PIN}=${LOCKED_VALUE})`);
      return true;
    } catch (err) {
      console.error(`❌ Blynk relock attempt ${attempt}/3 failed:`, err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
};

/**
 * Unlock for OPEN_MS, then relock. A scan while the door is already open
 * restarts the timer rather than relocking on someone mid-walk.
 * @returns {Promise<boolean>} whether the unlock was accepted by Blynk
 */
const openDoor = async (reason) => {
  if (!TOKEN) {
    console.warn('⚠️ BLYNK_TOKEN not set — door not opened');
    return false;
  }
  try {
    await write(OPEN_VALUE);
    console.log(`🚪 Door opened via Blynk (${PIN}=${OPEN_VALUE}) — ${reason}`);
  } catch (err) {
    console.error('❌ Blynk open failed:', err.message);
    return false;
  }
  clearTimeout(relockTimer);
  relockTimer = setTimeout(relock, OPEN_MS);
  return true;
};

// A restart in the middle of an open window would lose the relock timer and
// leave the door unlocked, so every boot starts from locked.
if (TOKEN) relock();

module.exports = { openDoor };
