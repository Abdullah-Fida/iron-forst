const { supabase } = require('../db/supabase');

/**
 * Automatic WhatsApp reminder settings, one record per gym.
 *
 * Stored as JSON in admin_notes (admin = 'ReminderSettings'), the same way the
 * audit log uses that table, so no database migration is needed.
 */

const NOTE_ADMIN = 'ReminderSettings';

const DEFAULTS = Object.freeze({
  enabled: true,
  // Messages only go out between these times (gym local time, 24h)
  startTime: '09:00',
  endTime: '13:00',
  // 0 = Sunday ... 6 = Saturday
  days: [0, 1, 2, 3, 4, 5, 6],
  // Who gets a message:
  //  'paid_last_month' - their last fee was paid in the previous calendar month
  //                      and is now due or expired (they are the ones who renew)
  //  'expired_within'  - their fee expired within `expiredWithinDays` days
  // Members unpaid for longer are left for the owner to handle by hand.
  audience: 'paid_last_month',
  expiredWithinDays: 30,
  // Also remind members whose fee ends within this many days (0 = off)
  dueSoonDays: 3,
  // Don't message the same member again within this many days
  repeatEveryDays: 7,
  // Seconds between two messages (protects the number from being blocked)
  gapSeconds: 8,
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const int = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Accepts partial input and returns a complete, valid settings object. */
function sanitize(input = {}, base = DEFAULTS) {
  const s = { ...base };
  if ('enabled' in input) s.enabled = Boolean(input.enabled);
  if (TIME.test(String(input.startTime || ''))) s.startTime = input.startTime;
  if (TIME.test(String(input.endTime || ''))) s.endTime = input.endTime;
  if (Array.isArray(input.days)) {
    s.days = [...new Set(input.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  }
  if (['paid_last_month', 'expired_within'].includes(input.audience)) s.audience = input.audience;
  if ('expiredWithinDays' in input) s.expiredWithinDays = int(input.expiredWithinDays, 1, 365, base.expiredWithinDays);
  if ('dueSoonDays' in input) s.dueSoonDays = int(input.dueSoonDays, 0, 30, base.dueSoonDays);
  if ('repeatEveryDays' in input) s.repeatEveryDays = int(input.repeatEveryDays, 1, 60, base.repeatEveryDays);
  if ('gapSeconds' in input) s.gapSeconds = int(input.gapSeconds, 5, 120, base.gapSeconds);
  return s;
}

async function loadRecord(gymId) {
  const { data, error } = await supabase
    .from('admin_notes')
    .select('id, text')
    .eq('gym_id', gymId)
    .eq('admin', NOTE_ADMIN)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

/** Settings plus run state (lastRunDate) for a gym. */
async function getSettings(gymId) {
  const record = await loadRecord(gymId);
  let saved = {};
  if (record) {
    try { saved = JSON.parse(record.text) || {}; } catch { saved = {}; }
  }
  return { ...sanitize(saved), lastRunDate: saved.lastRunDate || null, lastRunSummary: saved.lastRunSummary || null };
}

async function saveSettings(gymId, input, extra = {}) {
  const current = await getSettings(gymId);
  const next = {
    ...sanitize(input, current),
    lastRunDate: 'lastRunDate' in extra ? extra.lastRunDate : current.lastRunDate,
    lastRunSummary: 'lastRunSummary' in extra ? extra.lastRunSummary : current.lastRunSummary,
  };
  const record = await loadRecord(gymId);
  const row = { text: JSON.stringify(next), date: new Date().toISOString() };
  const { error } = record
    ? await supabase.from('admin_notes').update(row).eq('id', record.id)
    : await supabase.from('admin_notes').insert({ ...row, gym_id: gymId, admin: NOTE_ADMIN });
  if (error) throw error;
  return next;
}

module.exports = { DEFAULTS, sanitize, getSettings, saveSettings };
