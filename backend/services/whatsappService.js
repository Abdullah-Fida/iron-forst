const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./whatsappAuthAdapter');
const QRCode = require('qrcode');
const pino = require('pino');

class WhatsAppService {
    constructor() {
        this.sessions = new Map();
        this.logger = pino({ level: 'silent' });
    }

    async getSession(gymId) {
        if (!this.sessions.has(gymId)) {
            await this.initSession(gymId);
        }
        return this.sessions.get(gymId);
    }

    async initSession(gymId) {
        // Prevent double-init
        if (this.sessions.has(gymId)) return;

        const { state, saveCreds, clearAll } = await useSupabaseAuthState(gymId);

        const sessionData = {
            socket: null,
            qr: null,
            status: 'INITIALIZING',
            clearAll
        };
        this.sessions.set(gymId, sessionData);

        const startSocket = async () => {
            // Fetch the latest WA web version (with fallback)
            let version;
            try {
                const res = await fetchLatestBaileysVersion();
                version = res.version;
                console.log(`[WhatsApp ${gymId}] Using WA version ${version.join('.')}`);
            } catch (err) {
                console.warn(`[WhatsApp ${gymId}] Version fetch failed, using library default`);
                version = undefined; // Baileys will use its built-in default
            }

            const socketConfig = {
                auth: state,
                logger: this.logger,
                printQRInTerminal: false,
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
            };
            if (version) socketConfig.version = version;

            const sock = makeWASocket(socketConfig);
            sessionData.socket = sock;

            // Save credentials whenever they update
            sock.ev.on('creds.update', saveCreds);

            // Handle connection lifecycle
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    try {
                        sessionData.qr = await QRCode.toDataURL(qr);
                        sessionData.status = 'NEEDS_QR';
                        console.log(`[WhatsApp ${gymId}] New QR code generated`);
                    } catch (e) {
                        console.error(`[WhatsApp ${gymId}] QR generation error:`, e.message);
                    }
                }

                if (connection === 'close') {
                    // Safely extract the status code from the disconnect error
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const loggedOut = statusCode === DisconnectReason.loggedOut;

                    console.log(`[WhatsApp ${gymId}] Connection closed. Status: ${statusCode}, LoggedOut: ${loggedOut}`);

                    if (loggedOut) {
                        // User intentionally logged out — wipe everything
                        sessionData.status = 'DISCONNECTED';
                        sessionData.qr = null;
                        sessionData.socket = null;
                        await clearAll();
                        console.log(`[WhatsApp ${gymId}] Session cleared after logout.`);
                    } else {
                        // Unexpected disconnect — try to reconnect
                        sessionData.status = 'RECONNECTING';
                        console.log(`[WhatsApp ${gymId}] Reconnecting in 3s...`);
                        setTimeout(() => startSocket(), 3000);
                    }
                } else if (connection === 'open') {
                    console.log(`[WhatsApp ${gymId}] ✅ Connected successfully!`);
                    sessionData.status = 'CONNECTED';
                    sessionData.qr = null;
                }
            });
        };

        // Start without awaiting so it doesn't block the server boot
        startSocket().catch(err => {
            console.error(`[WhatsApp ${gymId}] Init failed:`, err.message);
            sessionData.status = 'DISCONNECTED';
        });
    }

    async getStatus(gymId) {
        const session = await this.getSession(gymId);
        return {
            status: session.status,
            qrCode: session.qr,
            provider: 'baileys'
        };
    }

    async logout(gymId) {
        const session = this.sessions.get(gymId);
        if (session) {
            try {
                if (session.socket) {
                    await session.socket.logout();
                }
            } catch (e) {
                console.warn(`[WhatsApp ${gymId}] Logout error (non-fatal):`, e.message);
            }
            // Always clean up regardless
            try { await session.clearAll(); } catch (e) {}
            this.sessions.delete(gymId);
        }
        return { success: true };
    }

    async sendMessage(gymId, phone, message) {
        const session = await this.getSession(gymId);

        if (session.status !== 'CONNECTED' || !session.socket) {
            throw new Error('WhatsApp is not connected. Please scan the QR code in the Action Center.');
        }

        // Format phone to standard WhatsApp ID (Pakistani numbers)
        let formatted = String(phone).replace(/[^0-9]/g, '');
        // 03001234567 (11 digits, local) → 923001234567
        if (formatted.startsWith('0') && formatted.length === 11) {
            formatted = `92${formatted.slice(1)}`;
        }
        // 3001234567 (10 digits, no prefix) → 923001234567
        else if (formatted.length === 10 && !formatted.startsWith('92')) {
            formatted = `92${formatted}`;
        }
        // 923001234567 (12 digits, already international) → keep as is
        // +923001234567 → + already stripped above → 923001234567

        const jid = `${formatted}@s.whatsapp.net`;
        console.log(`[WhatsApp ${gymId}] Sending to: ${phone} → formatted: ${formatted} → jid: ${jid}`);

        try {
            // Try to check if number exists on WhatsApp (but don't block on failure)
            const [result] = await session.socket.onWhatsApp(jid);
            if (!result || !result.exists) {
                console.warn(`[WhatsApp ${gymId}] Number ${formatted} not found on WhatsApp`);
                throw new Error(`Number ${phone} is not registered on WhatsApp.`);
            }
        } catch (checkErr) {
            // If the check itself throws (network issue), log but still try to send
            if (checkErr.message.includes('not registered')) throw checkErr;
            console.warn(`[WhatsApp ${gymId}] onWhatsApp check failed (trying to send anyway):`, checkErr.message);
        }

        const msg = await session.socket.sendMessage(jid, { text: message });
        console.log(`[WhatsApp ${gymId}] ✅ Message sent to ${formatted}, id: ${msg?.key?.id}`);
        return { success: true, sid: msg?.key?.id };
    }

    async sendBulkMessages(gymId, messages, delayMs = 3000) {
        const results = { successful: 0, failed: 0, skipped: 0, errors: [] };
        const session = await this.getSession(gymId);

        if (session.status !== 'CONNECTED' || !session.socket) {
            console.error(`[WhatsApp ${gymId}] Cannot send bulk, not connected.`);
            return results;
        }

        console.log(`[WhatsApp ${gymId}] Bulk send starting - ${messages.length} messages.`);

        for (let i = 0; i < messages.length; i++) {
            const { phone, message } = messages[i];
            try {
                await this.sendMessage(gymId, phone, message);
                results.successful++;
            } catch (err) {
                results.failed++;
                results.errors.push({ phone, error: err.message });
                console.error(`  ✗ Failed for ${phone}: ${err.message}`);
            }

            if (i < messages.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        console.log(`[WhatsApp ${gymId}] Bulk send done. ✓ ${results.successful} | ✗ ${results.failed}`);
        return results;
    }

    async requestPairingCode(gymId, phoneNumber) {
        const session = await this.getSession(gymId);

        if (!session.socket) {
            throw new Error('WhatsApp service not initialized. Try resetting the connection.');
        }

        let formatted = String(phoneNumber).replace(/[^0-9]/g, '');
        if (formatted.startsWith('0') && formatted.length === 11) {
            formatted = `92${formatted.slice(1)}`;
        } else if (formatted.length === 10 && !formatted.startsWith('92')) {
            formatted = `92${formatted}`;
        }

        try {
            const code = await session.socket.requestPairingCode(formatted);
            return { success: true, code };
        } catch (err) {
            console.error(`[WhatsApp ${gymId}] Pairing code error:`, err);
            throw new Error('Failed to request pairing code. Try resetting the connection first.');
        }
    }
}

module.exports = new WhatsAppService();
