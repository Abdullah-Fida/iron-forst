const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const { supabase } = require('../db/supabase');

/**
 * Hybrid Auth State: In-Memory + Supabase Background Sync
 * 
 * Keys are stored in memory FIRST so the WhatsApp handshake completes instantly.
 * Then they are synced to Supabase in the background for persistence across restarts.
 */
async function useSupabaseAuthState(gymId) {
    // In-memory cache — this is the primary store during runtime
    const memoryStore = new Map();

    // ── Load existing data from Supabase into memory ──
    try {
        const { data: rows, error } = await supabase
            .from('whatsapp_auth')
            .select('key, data')
            .eq('gym_id', gymId);

        if (!error && rows) {
            for (const row of rows) {
                memoryStore.set(row.key, row.data);
            }
            console.log(`[WA Auth ${gymId}] Loaded ${rows.length} keys from Supabase`);
        } else if (error) {
            console.warn(`[WA Auth ${gymId}] Supabase load error (table may not exist):`, error.message);
        }
    } catch (e) {
        console.warn(`[WA Auth ${gymId}] Could not load from Supabase:`, e.message);
    }

    // ── Background sync to Supabase (fire-and-forget) ──
    const syncToDb = (key, data) => {
        // Don't await — let it run in the background
        supabase
            .from('whatsapp_auth')
            .upsert({ gym_id: gymId, key, data }, { onConflict: 'gym_id, key' })
            .then(({ error }) => {
                if (error) console.warn(`[WA Auth] DB sync error for key ${key}:`, error.message);
            })
            .catch(() => {}); // Silently ignore DB errors — memory is the source of truth
    };

    const deleteFromDb = (key) => {
        supabase
            .from('whatsapp_auth')
            .delete()
            .eq('gym_id', gymId)
            .eq('key', key)
            .then(({ error }) => {
                if (error) console.warn(`[WA Auth] DB delete error for key ${key}:`, error.message);
            })
            .catch(() => {});
    };

    // ── Read from memory (with JSON reviver for Buffer reconstruction) ──
    const readData = (key) => {
        const raw = memoryStore.get(key);
        if (!raw) return null;
        try {
            return JSON.parse(JSON.stringify(raw), BufferJSON.reviver);
        } catch {
            return null;
        }
    };

    // ── Write to memory + background DB sync ──
    const writeData = (data, key) => {
        const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        memoryStore.set(key, serialized);
        syncToDb(key, serialized);
    };

    // ── Initialize credentials ──
    let creds = readData('creds');
    if (!creds) {
        creds = initAuthCreds();
        writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: async (data) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                writeData(value, key);
                            } else {
                                memoryStore.delete(key);
                                deleteFromDb(key);
                            }
                        }
                    }
                }
            }
        },
        saveCreds: () => {
            writeData(creds, 'creds');
        },
        clearAll: async () => {
            memoryStore.clear();
            try {
                await supabase.from('whatsapp_auth').delete().eq('gym_id', gymId);
            } catch (e) {
                console.warn(`[WA Auth] clearAll DB error:`, e.message);
            }
        }
    };
}

module.exports = { useSupabaseAuthState };
