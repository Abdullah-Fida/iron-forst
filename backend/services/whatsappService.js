/**
 * Iron Fost — Twilio WhatsApp Service
 *
 * Replaces whatsapp-web.js (headless Chrome / QR scan approach) with
 * Twilio's reliable WhatsApp Business API.
 *
 * Required .env variables:
 *   TWILIO_ACCOUNT_SID   — from console.twilio.com → Account Info
 *   TWILIO_AUTH_TOKEN    — from console.twilio.com → Account Info
 *   TWILIO_WA_FROM       — your Twilio WhatsApp sender, e.g. whatsapp:+14155238886
 *                          (use the Sandbox number for testing, or your approved number for production)
 *
 * Twilio WhatsApp Sandbox (free testing):
 *   1. Go to console.twilio.com → Messaging → Try it out → Send a WhatsApp message
 *   2. Have the recipient send the join code to the sandbox number ONCE to opt-in
 *   3. After that, you can freely message them
 *
 * Production (approved number):
 *   1. Apply for a WhatsApp Business Profile in the Twilio console
 *   2. Once approved, set TWILIO_WA_FROM to your approved number
 */

const twilio = require('twilio');

// ─── Formatting helpers ─────────────────────────────────────────────────────

/**
 * Converts any Pakistan phone number format to international E.164 format.
 * - 03001234567  → +923001234567
 * - 3001234567   → +923001234567
 * - 923001234567 → +923001234567
 */
function formatPakistaniPhone(rawPhone) {
  let phone = String(rawPhone || '').replace(/[^0-9]/g, '');

  if (phone.startsWith('92') && phone.length === 12) {
    return `+${phone}`;
  }
  if (phone.startsWith('0') && phone.length === 11) {
    return `+92${phone.slice(1)}`;
  }
  if (phone.length === 10 && !phone.startsWith('0') && !phone.startsWith('92')) {
    return `+92${phone}`;
  }
  // Fallback: prepend + if already has country code
  if (phone.length >= 12) return `+${phone}`;

  return null; // Invalid
}

// ─── Service class ──────────────────────────────────────────────────────────

class TwilioWhatsAppService {
  constructor() {
    this.client = null;
    this.configured = false;
    this._initClient();
  }

  _initClient() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (!sid || !token || sid.startsWith('YOUR_') || token.startsWith('YOUR_')) {
      console.warn('⚠️  Twilio credentials not set. WhatsApp sending will be disabled until TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are added to .env');
      return;
    }

    try {
      this.client = twilio(sid, token);
      this.configured = true;
      console.log('✅ Twilio WhatsApp Service initialized.');
    } catch (err) {
      console.error('❌ Failed to initialize Twilio client:', err.message);
    }
  }

  /**
   * Returns the current service status.
   * "CONNECTED" if Twilio credentials are set, "DISCONNECTED" otherwise.
   */
  getStatus() {
    return {
      status: this.configured ? 'CONNECTED' : 'DISCONNECTED',
      provider: 'twilio',
      qrCode: null // No QR needed with Twilio
    };
  }

  /**
   * Sends a single WhatsApp message via Twilio.
   * @param {string} phone - Recipient's phone number (any Pakistani format)
   * @param {string} message - Text body to send
   * @returns {{ success: boolean, message?: string, sid?: string }}
   */
  async sendMessage(phone, message) {
    if (!this.configured || !this.client) {
      throw new Error('Twilio is not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WA_FROM in your .env file.');
    }

    if (!phone) throw new Error('Phone number is required.');
    if (!message) throw new Error('Message body is required.');

    const fromNumber = process.env.TWILIO_WA_FROM;
    if (!fromNumber) {
      throw new Error('TWILIO_WA_FROM is not set in .env. Example: whatsapp:+14155238886');
    }

    const formatted = formatPakistaniPhone(phone);
    if (!formatted) {
      console.warn(`⚠️  Invalid phone number skipped: "${phone}"`);
      return { success: false, message: `Invalid phone number: ${phone}` };
    }

    try {
      const msg = await this.client.messages.create({
        from: fromNumber,                  // e.g. "whatsapp:+14155238886"
        to: `whatsapp:${formatted}`,        // e.g. "whatsapp:+923001234567"
        body: message,
      });

      console.log(`✉️  WhatsApp sent to ${formatted} | SID: ${msg.sid} | Status: ${msg.status}`);
      return { success: true, sid: msg.sid, status: msg.status };
    } catch (err) {
      console.error(`❌ Failed to send WhatsApp to ${formatted}:`, err.message);

      // Surface friendly Twilio error codes to the caller
      const userMessage = err.code === 63007
        ? 'Recipient has not opted in to the Twilio WhatsApp Sandbox. They must send the join code first.'
        : err.code === 21608
        ? 'The recipient is not a WhatsApp user or is not reachable.'
        : err.message;

      throw new Error(userMessage);
    }
  }

  /**
   * Sends bulk WhatsApp messages with a configurable delay between each.
   * Runs sequentially to comply with Twilio rate limits.
   * @param {{ phone: string, message: string }[]} messages
   * @param {number} delayMs - Delay between each message (default: 1500ms)
   */
  async sendBulkMessages(messages, delayMs = 1500) {
    if (!this.configured || !this.client) {
      throw new Error('Twilio is not configured.');
    }

    console.log(`🚀 Twilio bulk send starting — ${messages.length} message(s)...`);
    const results = { successful: 0, failed: 0, skipped: 0, errors: [] };

    for (let i = 0; i < messages.length; i++) {
      const { phone, message } = messages[i];
      try {
        const res = await this.sendMessage(phone, message);
        if (res.success) {
          results.successful++;
        } else {
          results.skipped++;
        }
      } catch (err) {
        results.failed++;
        results.errors.push({ phone, error: err.message });
        console.error(`  ✗ Failed for ${phone}: ${err.message}`);
      }

      // Pause between sends to avoid rate-limiting
      if (i < messages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.log(`🏁 Bulk send done. ✓ ${results.successful} sent | ✗ ${results.failed} failed | ⚠ ${results.skipped} skipped`);
    return results;
  }
}

module.exports = new TwilioWhatsAppService();
