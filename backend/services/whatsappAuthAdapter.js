const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const { supabase } = require('../db/supabase');

/**
 * Custom Baileys Auth State Adapter using Supabase (PostgreSQL)
 * Allows persistent WhatsApp sessions that survive server restarts.
 */
async function useSupabaseAuthState(gymId) {
    const writeData = async (data, key) => {
        try {
            const jsonStr = JSON.stringify(data, BufferJSON.replacer);
            // Parse it back to plain object for jsonb column
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
            const { data, error } = await supabase
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

    const removeData = async (key) => {
        try {
            await supabase
                .from('whatsapp_auth')
                .delete()
                .eq('gym_id', gymId)
                .eq('key', key);
        } catch (e) {
            console.error('[WhatsApp Auth] Error removing key', key, e);
        }
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
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
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
