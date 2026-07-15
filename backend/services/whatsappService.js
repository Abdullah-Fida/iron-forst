const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const EventEmitter = require('events');

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.status = 'DISCONNECTED'; // DISCONNECTED, QR_READY, CONNECTED, AUTHENTICATING
    this.qrDataUrl = null;
    this.isInitializing = false;
  }

  async initialize() {
    if (this.isInitializing || this.status === 'CONNECTED') return;
    this.isInitializing = true;
    this.status = 'AUTHENTICATING';
    this.qrDataUrl = null;

    console.log('🤖 Initializing WhatsApp Bot...');

    const isWindows = process.platform === 'win32';
    const isRender = !!process.env.RENDER; // Render sets this env var automatically

    // On Windows dev machine: use local Chrome (avoids downloading Chromium)
    // On Render/Linux: let Puppeteer use its own bundled Chromium
    const puppeteerConfig = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    };

    if (isWindows && !isRender) {
      puppeteerConfig.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }

    try {
      // On Linux (Render), write session to /tmp which is writable
      // On Windows, use local folder
      const authDataPath = isWindows ? undefined : '/tmp';

      this.client = new Client({
        authStrategy: new LocalAuth({ clientId: 'core-gym-bot', dataPath: authDataPath }),
        puppeteer: puppeteerConfig
      });

      this.client.on('qr', async (qr) => {
        console.log('📱 WhatsApp QR Code received. Awaiting scan...');
        this.status = 'QR_READY';
        try {
          this.qrDataUrl = await qrcode.toDataURL(qr, { margin: 2, width: 300 });
          this.emit('qr_updated', this.qrDataUrl);
        } catch (err) {
          console.error('❌ Failed to generate QR data URL:', err);
        }
      });

      this.client.on('ready', () => {
        console.log('✅ WhatsApp Bot is READY and connected!');
        this.status = 'CONNECTED';
        this.qrDataUrl = null;
        this.emit('status_changed', this.status);
      });

      this.client.on('authenticated', () => {
        console.log('🔐 WhatsApp Authenticated successfully.');
        this.status = 'AUTHENTICATING'; // Will turn to READY soon
      });

      this.client.on('auth_failure', msg => {
        console.error('❌ WhatsApp Auth failure:', msg);
        this.status = 'DISCONNECTED';
        this.qrDataUrl = null;
        this.isInitializing = false;
        this.emit('status_changed', this.status);
      });

      this.client.on('disconnected', (reason) => {
        console.log('🔌 WhatsApp Disconnected:', reason);
        this.status = 'DISCONNECTED';
        this.qrDataUrl = null;
        this.isInitializing = false;
        this.emit('status_changed', this.status);
      });

      await this.client.initialize();
      this.isInitializing = false;
    } catch (err) {
      console.error('❌ WhatsApp Initialization failed:', err);
      this.status = 'DISCONNECTED';
      this.isInitializing = false;
    }
  }

  async logout() {
    if (this.client) {
      try {
        await this.client.logout();
        await this.client.destroy();
      } catch (e) {
        console.error('Error destroying client:', e);
      }
      this.client = null;
    }
    this.status = 'DISCONNECTED';
    this.qrDataUrl = null;
    this.isInitializing = false;
    this.emit('status_changed', this.status);
  }

  getStatus() {
    return {
      status: this.status,
      qrCode: this.qrDataUrl
    };
  }

  async sendMessage(phone, message) {
    if (this.status !== 'CONNECTED' || !this.client) {
      throw new Error('WhatsApp is not connected.');
    }

    if (!phone) throw new Error('Phone number is required.');

    // Format phone number to WhatsApp ID
    let cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      cleaned = '92' + cleaned.substring(1);
    } else if (cleaned.length === 10 && !cleaned.startsWith('92')) {
      cleaned = '92' + cleaned;
    }

    const chatId = `${cleaned}@c.us`;

    try {
      // Check if number is registered on WhatsApp
      const isRegistered = await this.client.isRegisteredUser(chatId);
      if (!isRegistered) {
        console.warn(`⚠️ Number ${cleaned} is not registered on WhatsApp.`);
        return { success: false, message: 'Number not on WhatsApp' };
      }

      await this.client.sendMessage(chatId, message);
      console.log(`✉️ Message sent to ${cleaned}`);
      return { success: true };
    } catch (err) {
      console.error(`❌ Failed to send message to ${cleaned}:`, err.message);
      throw err;
    }
  }

  async sendBulkMessages(messages, delayMs = 3000) {
    if (this.status !== 'CONNECTED' || !this.client) {
      throw new Error('WhatsApp is not connected.');
    }

    console.log(`🚀 Starting bulk send of ${messages.length} messages...`);
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
      }

      // Delay to prevent getting banned for spamming
      if (i < messages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.log(`🏁 Bulk send finished. Success: ${results.successful}, Failed: ${results.failed}`);
    return results;
  }
}

module.exports = new WhatsAppService();
