const cron = require('node-cron');
const { supabase } = require('../db/supabase');
const whatsappService = require('./whatsappService');
const reminderSettings = require('./reminderSettings');
const { TZ, gymNow, planReminders } = require('./reminderTargets');

/**
 * Automatic WhatsApp fee reminders.
 *
 * Each gym chooses the hours and days messages may go out, who gets one, and
 * how often (Action Center -> Reminder settings). Every minute this checks
 * whether a gym is inside its window and has not had today's run yet.
 *
 * The old version fired once at exactly 09:00 and gave up if WhatsApp was not
 * connected at that moment — which after any server restart it never was,
 * because the WhatsApp session only started when someone opened the page.
 * Now the session is started at boot, and a run that finds WhatsApp
 * reconnecting simply tries again the next minute, until the window closes.
 */
class CronService {
    constructor() {
        this.running = new Set();
        this.startAutomatedReminders();
        // Bring saved WhatsApp sessions back up after a restart (non-blocking)
        setTimeout(() => {
            whatsappService.resumeSavedSessions().catch((err) => console.error('[WhatsApp] Resume failed:', err.message));
        }, 15000);
    }

    startAutomatedReminders() {
        cron.schedule('* * * * *', () => {
            this.tick().catch((err) => console.error('[Reminders] Tick failed:', err.message));
        }, { timezone: TZ });
        console.log(`[Cron] WhatsApp reminders: checking every minute against each gym's schedule (${TZ})`);
    }

    async tick() {
        const { data: gyms, error } = await supabase.from('gyms').select('*');
        if (error || !gyms) return;
        const now = gymNow();
        for (const gym of gyms) {
            if (this.running.has(gym.id)) continue;
            let settings;
            try {
                settings = await reminderSettings.getSettings(gym.id);
            } catch (err) {
                console.error(`[Reminders] Settings load failed for ${gym.gym_name}:`, err.message);
                continue;
            }
            if (!this.isDue(settings, now)) continue;
            this.running.add(gym.id);
            this.processGymReminders(gym, settings, now)
                .catch((err) => console.error(`[Reminders] ${gym.gym_name} failed:`, err.message))
                .finally(() => this.running.delete(gym.id));
        }
    }

    isDue(settings, now) {
        return settings.enabled
            && settings.days.includes(now.weekday)
            && now.time >= settings.startTime
            && now.time < settings.endTime
            && settings.lastRunDate !== now.date;
    }

    async processGymReminders(gym, settings, now) {
        const status = await whatsappService.getStatus(gym.id);
        if (status.status !== 'CONNECTED') {
            // Not today's run yet — try again next minute while the window is open
            console.log(`[Reminders] ${gym.gym_name}: WhatsApp is ${status.status}, will retry`);
            return;
        }

        const { toSend, groups, skippedRecentlyMessaged } = await planReminders(gym, settings);
        // Claim today's run before sending, so a restart mid-run cannot send twice
        await reminderSettings.saveSettings(gym.id, {}, {
            lastRunDate: now.date,
            lastRunSummary: { date: now.date, startedAt: new Date().toISOString(), planned: toSend.length, sent: 0, failed: 0, finished: false },
        });

        console.log(`[Reminders] ${gym.gym_name}: ${toSend.length} to send (due soon ${groups.dueSoon.length}, expired ≤${settings.expiredWithinDays}d ${groups.recent.length}, older ${groups.older.length} not messaged, ${skippedRecentlyMessaged} messaged recently)`);

        let sent = 0;
        let failed = 0;
        let stoppedReason = null;
        for (const m of toSend) {
            if (gymNow().time >= settings.endTime) { stoppedReason = 'send window closed'; break; }
            const current = await reminderSettings.getSettings(gym.id);
            if (!current.enabled) { stoppedReason = 'turned off'; break; }
            try {
                await whatsappService.sendMessage(gym.id, m.phone, m.message, { skipNumberCheck: true, waitForConnectionMs: 60000 });
                sent++;
                await supabase.from('notifications').insert({
                    gym_id: gym.id,
                    member_id: m.id,
                    notification_type: 'automated_reminder',
                    message_template: m.message,
                    status: 'sent',
                    scheduled_for: new Date().toISOString(),
                    sent_at: new Date().toISOString(),
                });
            } catch (err) {
                failed++;
                console.error(`[Reminders] Failed for ${m.name} (${m.phone}): ${err.message}`);
            }
            await new Promise((r) => setTimeout(r, settings.gapSeconds * 1000));
        }

        await reminderSettings.saveSettings(gym.id, {}, {
            lastRunSummary: { date: now.date, finishedAt: new Date().toISOString(), planned: toSend.length, sent, failed, finished: true, stoppedReason },
        });
        console.log(`[Reminders] ${gym.gym_name}: done — sent ${sent}, failed ${failed}${stoppedReason ? `, stopped: ${stoppedReason}` : ''}`);
    }
}

module.exports = new CronService();
