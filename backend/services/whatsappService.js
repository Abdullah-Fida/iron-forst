const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./whatsappAuthAdapter');
const QRCode = require('qrcode');
const pino = require('pino');
const { supabase } = require('../db/supabase');

// Reconnect waits grow 3s, 6s, 12s ... up to 2 minutes, so a WhatsApp outage
// is not hammered every 3 seconds (which itself gets numbers rate-limited).
const backoffMs = (attempt) => Math.min(3000 * 2 ** Math.max(0, attempt - 1), 120000);
const WATCHDOG_MS = 2 * 60 * 1000;

class WhatsAppService {
    constructor() {
        this.sessions = new Map();
        this.logger = pino({ level: 'silent' });
        // Watchdog: a session that dropped and has no reconnect scheduled is
        // restarted, so WhatsApp does not stay disconnected until someone
        // happens to open the Action Center.
        this.watchdog = setInterval(() => this.checkSessions(), WATCHDOG_MS);
        if (this.watchdog.unref) this.watchdog.unref();
    }

    /** Start every gym session that has a saved login (called at boot). */
    async resumeSavedSessions() {
        const { data, error } = await supabase.from('whatsapp_auth').select('gym_id').eq('key', 'creds');
        if (error) throw error;
        for (const { gym_id: gymId } of data || []) {
            console.log(`[WhatsApp ${gymId}] Resuming saved session after restart`);
            await this.getSession(gymId);
        }
    }

    checkSessions() {
        for (const [gymId, session] of this.sessions) {
            const dead = ['RECONNECTING', 'DISCONNECTED'].includes(session.status) && !session.reconnectTimer && !session.loggedOut;
            const stale = session.status === 'CONNECTED' && session.socket && !session.socket.user;
            if (dead || stale) {
                console.log(`[WhatsApp ${gymId}] Watchdog: session is ${stale ? 'stale' : session.status}, restarting`);
                session.restart?.();
            }
        }
    }

    /** Resolves true once connected, false after `timeoutMs`. */
    async waitForConnection(gymId, timeoutMs = 30000) {
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
            const session = this.sessions.get(gymId);
            if (session?.status === 'CONNECTED' && session.socket?.user) return true;
            if (session?.status === 'NEEDS_QR' || session?.loggedOut) return false;
            await new Promise((r) => setTimeout(r, 1000));
        }
        return false;
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
            clearAll,
            attempts: 0,
            reconnectTimer: null,
            loggedOut: false,
            lastError: null,
            connectedAt: null,
        };
        this.sessions.set(gymId, sessionData);

        const scheduleReconnect = (reason) => {
            if (sessionData.reconnectTimer || sessionData.loggedOut) return;
            sessionData.attempts += 1;
            const wait = backoffMs(sessionData.attempts);
            sessionData.status = 'RECONNECTING';
            sessionData.lastError = reason;
            console.log(`[WhatsApp ${gymId}] Reconnecting in ${Math.round(wait / 1000)}s (attempt ${sessionData.attempts}, ${reason})`);
            sessionData.reconnectTimer = setTimeout(() => {
                sessionData.reconnectTimer = null;
                startSocket().catch((err) => scheduleReconnect(err.message));
            }, wait);
        };

        // Closes the current socket and drops its listeners, so an old socket
        // can never fire events into the session after a new one has started.
        const closeSocket = () => {
            const old = sessionData.socket;
            sessionData.socket = null;
            if (!old) return;
            try { old.ev.removeAllListeners(); } catch {}
            try { old.end(undefined); } catch {}
        };

        sessionData.restart = () => {
            if (sessionData.reconnectTimer) return;
            closeSocket();
            startSocket().catch((err) => scheduleReconnect(err.message));
        };

        const startSocket = async () => {
            closeSocket();
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
                // Not shown as "online" on the phone, and no full history sync:
                // both keep the linked device lighter and less likely to be dropped.
                markOnlineOnConnect: false,
                syncFullHistory: false,
                keepAliveIntervalMs: 25000,
                connectTimeoutMs: 60000,
            };
            if (version) socketConfig.version = version;

            const sock = makeWASocket(socketConfig);
            sessionData.socket = sock;

            // Save credentials whenever they update
            sock.ev.on('creds.update', saveCreds);
            const isCurrent = () => sessionData.socket === sock;

            // Handle connection lifecycle
            sock.ev.on('connection.update', async (update) => {
                if (!isCurrent()) return;
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
                        // Logged out from the phone (or the link was removed) — a new QR scan is needed
                        sessionData.loggedOut = true;
                        sessionData.status = 'DISCONNECTED';
                        sessionData.qr = null;
                        sessionData.lastError = 'Logged out from the phone. Please scan the QR code again.';
                        closeSocket();
                        await clearAll();
                        console.log(`[WhatsApp ${gymId}] Session cleared after logout.`);
                        // Fresh session so a new QR is ready when someone opens the page
                        this.sessions.delete(gymId);
                    } else if (statusCode === DisconnectReason.restartRequired) {
                        // Normal right after linking: reconnect immediately
                        sessionData.status = 'RECONNECTING';
                        startSocket().catch((err) => scheduleReconnect(err.message));
                    } else {
                        // Network drop, WhatsApp server restart, or another copy of this
                        // server briefly connected during a deploy — retry with backoff
                        const reason = statusCode === DisconnectReason.connectionReplaced
                            ? 'connection replaced by another session'
                            : (lastDisconnect?.error?.message || `status ${statusCode}`);
                        scheduleReconnect(reason);
                    }
                } else if (connection === 'open') {
                    console.log(`[WhatsApp ${gymId}] ✅ Connected successfully!`);
                    sessionData.status = 'CONNECTED';
                    sessionData.qr = null;
                    sessionData.attempts = 0;
                    sessionData.lastError = null;
                    sessionData.connectedAt = new Date().toISOString();
                }
            });
        };

        // Start without awaiting so it doesn't block the server boot
        startSocket().catch(err => {
            console.error(`[WhatsApp ${gymId}] Init failed:`, err.message);
            scheduleReconnect(err.message);
        });
    }

    async getStatus(gymId) {
        const session = await this.getSession(gymId);
        return {
            status: session.status,
            qrCode: session.qr,
            provider: 'baileys',
            lastError: session.lastError || null,
            connectedAt: session.connectedAt || null,
            reconnectAttempts: session.attempts || 0,
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
            session.loggedOut = true;
            if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
            try { session.socket?.ev.removeAllListeners(); } catch (e) {}
            try { await session.clearAll(); } catch (e) {}
            this.sessions.delete(gymId);
        }
        return { success: true };
    }

    async sendMessage(gymId, phone, message, options = {}) {
        const { skipNumberCheck = false, waitForConnectionMs = 15000 } = options;
        let session = await this.getSession(gymId);

        // A short reconnect (very common) should not fail the message
        if (session.status !== 'CONNECTED' || !session.socket?.user) {
            await this.waitForConnection(gymId, waitForConnectionMs);
            session = await this.getSession(gymId);
        }

        if (session.status !== 'CONNECTED' || !session.socket) {
            throw new Error('WhatsApp is not connected. Please scan the QR code in the Action Center.');
        }

        // Verify the socket is truly alive (not stale)
        if (!session.socket.user) {
            console.error(`[WhatsApp ${gymId}] Socket exists but user is null — connection is stale.`);
            session.status = 'RECONNECTING';
            throw new Error('WhatsApp connection is stale. Please wait for reconnection or re-scan QR.');
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

        // Only do the onWhatsApp check for single sends (not bulk)
        // The onWhatsApp API is rate-limited by WhatsApp and returns false negatives during bulk
        if (!skipNumberCheck) {
            try {
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
        }

        const msg = await session.socket.sendMessage(jid, { text: message });
        
        // Verify we got a valid message key back — if not, the send may have silently failed
        if (!msg?.key?.id) {
            console.error(`[WhatsApp ${gymId}] sendMessage returned no message key for ${formatted}`);
            throw new Error('Message send failed — no confirmation received from WhatsApp.');
        }
        
        console.log(`[WhatsApp ${gymId}] ✅ Message sent to ${formatted}, id: ${msg.key.id}`);
        return { success: true, sid: msg.key.id };
    }

    async sendBulkMessages(gymId, messages, delayMs = 5000) {
        const results = { successful: 0, failed: 0, skipped: 0, errors: [] };
        const session = await this.getSession(gymId);

        if (session.status !== 'CONNECTED' || !session.socket) {
            console.error(`[WhatsApp ${gymId}] Cannot send bulk, not connected.`);
            return results;
        }

        // Verify session is truly alive before starting bulk
        if (!session.socket.user) {
            console.error(`[WhatsApp ${gymId}] Cannot send bulk, socket is stale (no user).`);
            return results;
        }

        console.log(`[WhatsApp ${gymId}] Bulk send starting - ${messages.length} messages (delay: ${delayMs}ms, skipNumberCheck: true).`);

        for (let i = 0; i < messages.length; i++) {
            const { phone, message } = messages[i];
            
            // Re-check connection health periodically during bulk send,
            // giving a dropped connection up to a minute to come back
            if (i > 0 && i % 10 === 0) {
                const currentSession = this.sessions.get(gymId);
                if ((!currentSession || currentSession.status !== 'CONNECTED' || !currentSession.socket?.user)
                    && !(await this.waitForConnection(gymId, 60000))) {
                    console.error(`[WhatsApp ${gymId}] Connection lost during bulk send at message ${i + 1}/${messages.length}`);
                    results.errors.push({ phone, error: 'Connection lost during bulk send' });
                    results.failed += (messages.length - i);
                    break;
                }
            }

            try {
                // Skip onWhatsApp check during bulk to avoid rate limiting & false negatives
                await this.sendMessage(gymId, phone, message, { skipNumberCheck: true });
                results.successful++;
                console.log(`  ✓ [${i + 1}/${messages.length}] Sent to ${phone}`);
            } catch (err) {
                console.error(`  ✗ [${i + 1}/${messages.length}] Failed for ${phone}: ${err.message}`);
                
                // Retry once after a short delay for transient errors
                if (!err.message.includes('not connected') && !err.message.includes('stale')) {
                    console.log(`  ↻ Retrying ${phone} in 3s...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    try {
                        await this.sendMessage(gymId, phone, message, { skipNumberCheck: true });
                        results.successful++;
                        console.log(`  ✓ [${i + 1}/${messages.length}] Retry succeeded for ${phone}`);
                        // Continue to next message (skip the error push below)
                        if (i < messages.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, delayMs));
                        }
                        continue;
                    } catch (retryErr) {
                        console.error(`  ✗ [${i + 1}/${messages.length}] Retry also failed for ${phone}: ${retryErr.message}`);
                    }
                }
                
                results.failed++;
                results.errors.push({ phone, error: err.message });
            }

            if (i < messages.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        console.log(`[WhatsApp ${gymId}] Bulk send done. ✓ ${results.successful} | ✗ ${results.failed} | Total: ${messages.length}`);
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
