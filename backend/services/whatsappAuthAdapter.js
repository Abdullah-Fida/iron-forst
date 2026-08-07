const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const { supabase } = require('../db/supabase');

/**
 * Custom Baileys Auth State Adapter using Supabase (PostgreSQL)
 * Allows persistent WhatsApp sessions that survive server restarts.
 * Optimized with bulk reads/writes to prevent QR scan timeouts.
 */
async function useSupabaseAuthState(gymId) {
    const writeData = async (data, key) => {
        try {
            const jsonStr = JSON.stringify(data, BufferJSON.replacer);
            const jsonbPayload = JSON.parse(jsonStr);
            await supabase
                .from('whatsapp_auth')
                .upsert({ gym_id: gymId, key, data: jsonbPayload }, { onConflict: 'gym_id, key' });
        } catch (e) {
            console.error('[WhatsApp Auth] Error writing key', key, e);
        }
    };

    const readData = async (key) => {
        try {
            const { data } = await supabase
                .from('whatsapp_auth')
                .select('data')
                .eq('gym_id', gymId)
                .eq('key', key)
                .single();

            if (data && data.data) {
                const jsonStr = JSON.stringify(data.data);
                return JSON.parse(jsonStr, BufferJSON.reviver);
            }
        } catch (e) {
            // No row found is fine
        }
        return null;
    };

    let creds = await readData('creds');
    if (!creds) {
        creds = initAuthCreds();
        await writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    const queryKeys = ids.map(id => `${type}-${id}`);
                    
                    try {
                        const { data: rows } = await supabase
                            .from('whatsapp_auth')
                            .select('key, data')
                            .eq('gym_id', gymId)
                            .in('key', queryKeys);

                        const rowMap = {};
                        if (rows) {
                            for (const row of rows) {
                                rowMap[row.key] = row.data;
                            }
                        }

                        for (const id of ids) {
                            let value = rowMap[`${type}-${id}`];
                            if (value) {
                                value = JSON.parse(JSON.stringify(value), BufferJSON.reviver);
                                if (type === 'app-state-sync-key') {
                                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                                }
                            }
                            data[id] = value;
                        }
                    } catch (err) {
                        console.error('[WhatsApp Auth] Error in bulk get:', err);
                    }
                    return data;
                },
                set: async (data) => {
                    const upserts = [];
                    const deletes = [];
                    
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                const jsonStr = JSON.stringify(value, BufferJSON.replacer);
                                upserts.push({ gym_id: gymId, key, data: JSON.parse(jsonStr) });
                            } else {
                                deletes.push(key);
                            }
                        }
                    }

                    try {
                        if (upserts.length > 0) {
                            await supabase.from('whatsapp_auth').upsert(upserts, { onConflict: 'gym_id, key' });
                        }
                        if (deletes.length > 0) {
                            await supabase.from('whatsapp_auth').delete().eq('gym_id', gymId).in('key', deletes);
                        }
                    } catch (err) {
                        console.error('[WhatsApp Auth] Error in bulk set:', err);
                    }
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        },
        clearAll: async () => {
            await supabase.from('whatsapp_auth').delete().eq('gym_id', gymId);
        }
    };
}

module.exports = { useSupabaseAuthState };
