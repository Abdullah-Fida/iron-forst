const cron = require('node-cron');
const { supabase } = require('../db/supabase');
const whatsappService = require('./whatsappService');

class CronService {
    constructor() {
        this.startAutomatedReminders();
    }

    startAutomatedReminders() {
        // Run every day at 09:00 AM gym-local time. Without an explicit timezone
        // node-cron uses the server clock, which is UTC on Render — that fired
        // these reminders at 2 PM Pakistan time.
        const timezone = process.env.CRON_TIMEZONE || 'Asia/Karachi';
        cron.schedule('0 9 * * *', async () => {
            console.log('--- Running automated 9 AM WhatsApp Reminders ---');
            try {
                // Fetch all gyms (multi-tenant)
                const { data: gyms } = await supabase.from('gyms').select('*');
                if (!gyms) return;

                for (const gym of gyms) {
                    await this.processGymReminders(gym);
                }
            } catch (err) {
                console.error('Error running daily cron job:', err);
            }
        }, { timezone });

        console.log(`[Cron] Daily WhatsApp reminders scheduled for 09:00 ${timezone}`);
    }

    async processGymReminders(gym) {
        // Only run if they have a WhatsApp connection
        const waStatus = await whatsappService.getStatus(gym.id);
        if (waStatus.status !== 'CONNECTED') return;

        // Fetch expired members or due soon members for this gym
        const { data: members, error } = await supabase
            .from('members')
            .select('*, payments(id, amount, payment_date, expiry_date)')
            .eq('gym_id', gym.id)
            .neq('status', 'deleted');

        if (error || !members) return;

        const today = new Date();
        today.setHours(0,0,0,0);

        const expiredMembers = members.filter(m => {
            let actualExpiry = m.latest_expiry;
            if (!actualExpiry && m.payments && m.payments.length > 0) {
                const sorted = [...m.payments].sort((a,b) => new Date(b.expiry_date || b.payment_date) - new Date(a.expiry_date || a.payment_date));
                actualExpiry = sorted[0].expiry_date || sorted[0].payment_date;
            }
            if (!actualExpiry || !m.phone) return false;

            const target = new Date(actualExpiry);
            target.setHours(0,0,0,0);
            const days = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
            
            // Only remind if they expired exactly today, or -3 days ago, etc.
            // Let's remind if they are strictly expired by less than 7 days, or exactly due soon (3 days)
            // Or just any expired member who hasn't been sent a reminder recently.
            return days < 0 && days >= -14;
        });

        if (expiredMembers.length === 0) return;

        // Check recent notifications to avoid spamming every day
        const { data: recentNotifs } = await supabase
            .from('notifications')
            .select('member_id')
            .eq('gym_id', gym.id)
            .eq('notification_type', 'automated_reminder')
            .gte('sent_at', new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()); // Sent in last 7 days

        const notifiedSet = new Set((recentNotifs || []).map(n => n.member_id));
        const membersToNotify = expiredMembers.filter(m => !notifiedSet.has(m.id));

        if (membersToNotify.length === 0) return;

        console.log(`[Cron] Gym ${gym.gym_name} - Sending ${membersToNotify.length} automated reminders.`);

        const template = gym.wa_msg_expired || `Hello [Name], your membership at ${gym.gym_name} has expired. Please renew your membership.`;

        const messages = membersToNotify.map(m => {
            let msg = template
                .replace(/\[Name\]/g, m.name)
                .replace(/\[GymName\]/g, gym.gym_name || 'Our Gym');
            return { phone: m.phone, message: msg, member: m };
        });

        // Send them sequentially
        for (const msgObj of messages) {
            try {
                await whatsappService.sendMessage(gym.id, msgObj.phone, msgObj.message);
                
                // Log in notifications as sent
                await supabase.from('notifications').insert({
                    gym_id: gym.id,
                    member_id: msgObj.member.id,
                    notification_type: 'automated_reminder',
                    message_template: msgObj.message,
                    status: 'sent',
                    sent_at: new Date().toISOString()
                });
                
                await new Promise(res => setTimeout(res, 3000)); // Delay to avoid ban
            } catch (err) {
                console.error(`[Cron] Failed to send to ${msgObj.phone}: ${err.message}`);
            }
        }
    }
}

module.exports = new CronService();
