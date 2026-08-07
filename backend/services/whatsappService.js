const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./whatsappAuthAdapter');
const QRCode = require('qrcode');
const { Boom } = require('@hapi/boom');
const pino = require('pino');

class WhatsAppService {
    constructor() {
        this.sessions = new Map(); // gymId -> { socket, qr, status, clearAll }
        this.logger = pino({ level: 'silent' });
    }

    async getSession(gymId) {
        if (!this.sessions.has(gymId)) {
            await this.initSession(gymId);
        }
        return this.sessions.get(gymId);
    }

    async initSession(gymId) {
        const { state, saveCreds, clearAll } = await useSupabaseAuthState(gymId);
        
        let sessionData = { 
            socket: null, 
            qr: null, 
            status: 'INITIALIZING',
            clearAll
        };
        this.sessions.set(gymId, sessionData);

        const startSocket = async () => {
            const { version } = await fetchLatestBaileysVersion();
            console.log(`[WhatsApp ${gymId}] Starting with WA version ${version.join('.')}`);

            const sock = makeWASocket({
                version,
                auth: state,
                logger: this.logger,
                printQRInTerminal: false,
                // Using Baileys default browser config to avoid 'Invalid QR'
            });

            sessionData.socket = sock;

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    sessionData.qr = await QRCode.toDataURL(qr);
                    sessionData.status = 'NEEDS_QR';
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                    
                    if (shouldReconnect) {
                        sessionData.status = 'RECONNECTING';
                        console.log(`[WhatsApp ${gymId}] Connection closed, reconnecting...`);
                        startSocket();
                    } else {
                        console.log(`[WhatsApp ${gymId}] Logged out. Clearing session.`);
                        sessionData.status = 'DISCONNECTED';
                        sessionData.qr = null;
                        sessionData.socket = null;
                        await clearAll();
                    }
                } else if (connection === 'open') {
                    console.log(`[WhatsApp ${gymId}] Connected successfully!`);
                    sessionData.status = 'CONNECTED';
                    sessionData.qr = null;
                }
            });
        };

        startSocket();
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
            if (session.socket) {
                // This triggers the 'close' event with loggedOut reason
                session.socket.logout();
            } else {
                await session.clearAll();
            }
            this.sessions.delete(gymId);
        }
        return { success: true };
    }

    async sendMessage(gymId, phone, message) {
        const session = await this.getSession(gymId);
        
        if (session.status !== 'CONNECTED' || !session.socket) {
            throw new Error('WhatsApp is not connected. Please scan the QR code in the Action Center.');
        }

        // Format phone to standard WhatsApp ID
        let formatted = String(phone).replace(/[^0-9]/g, '');
        if (formatted.startsWith('0') && formatted.length === 11) {
            formatted = `92${formatted.slice(1)}`;
        } else if (formatted.length === 10 && !formatted.startsWith('92')) {
            formatted = `92${formatted}`;
        }
        const jid = `${formatted}@s.whatsapp.net`;

        // Check if number is on WhatsApp
        const [result] = await session.socket.onWhatsApp(jid);
        if (!result || !result.exists) {
            throw new Error('This number is not registered on WhatsApp.');
        }

        const msg = await session.socket.sendMessage(jid, { text: message });
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

            // Pause between sends to avoid rate-limiting
            if (i < messages.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        
        console.log(`[WhatsApp ${gymId}] Bulk send done. ✓ ${results.successful} sent | ✗ ${results.failed} failed`);
        return results;
    }

    async requestPairingCode(gymId, phoneNumber) {
        const session = await this.getSession(gymId);
        
        if (!session.socket) {
            throw new Error('WhatsApp service not initialized.');
        }

        let formatted = String(phoneNumber).replace(/[^0-9]/g, '');
        if (formatted.startsWith('0') && formatted.length === 11) {
            formatted = `92${formatted.slice(1)}`;
        } else if (formatted.length === 10 && !formatted.startsWith('92')) {
            formatted = `92${formatted}`;
        }

        try {
            // Request pairing code from Baileys
            const code = await session.socket.requestPairingCode(formatted);
            return { success: true, code };
        } catch (err) {
            console.error(`[WhatsApp ${gymId}] Pairing code error:`, err);
            throw new Error('Failed to request pairing code. Try resetting the connection first.');
        }
    }
}

module.exports = new WhatsAppService();
