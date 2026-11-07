const { supabase } = require('../db/supabase');

/**
 * Works out who an automatic reminder should go to, and builds the message.
 * Used by the daily sender and by the preview in the Action Center, so what
 * the owner sees is exactly what will be sent.
 */

const TZ = process.env.CRON_TIMEZONE || 'Asia/Karachi';

/** Today's date and clock time in the gym's timezone. */
function gymNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}`, weekday };
}

const dayDiff = (fromDate, toDate) =>
  Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);

// Latest membership/trial payment (registration fees carry no period)
const lastMembershipPayment = (m) => {
  const periods = (m.payments || []).filter((p) => {
    const type = (String(p.notes || '').match(/payment_type:(\w+)/) || [])[1];
    if (type) return type === 'membership' || type === 'trial';
    return p.expiry_date && p.payment_date && String(p.expiry_date) > String(p.payment_date);
  });
  return periods.sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)))[0] || null;
};

/** "2026-10" for the calendar month `monthsAgo` before `today` (YYYY-MM-DD). */
const monthKey = (today, monthsAgo = 1) => {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsAgo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const expiryOf = (m) => {
  if (m.latest_expiry) return String(m.latest_expiry).slice(0, 10);
  const dates = (m.payments || []).map((p) => p.expiry_date || p.payment_date).filter(Boolean).sort();
  return dates.length ? String(dates[dates.length - 1]).slice(0, 10) : null;
};

/**
 * Splits members into reminder groups. `recent` is who gets messaged:
 *   audience 'paid_last_month': last fee paid in the previous calendar month,
 *                               now due (within dueSoonDays) or expired
 *   audience 'expired_within':  expired within expiredWithinDays, or due soon
 *   older  - everyone else who is overdue (never messaged automatically)
 *   dueSoon - (expired_within only) fee ends in 0..dueSoonDays days
 */
function groupMembers(members, settings, today = gymNow().date) {
  const groups = { dueSoon: [], recent: [], older: [] };
  const lastMonth = monthKey(today, 1);
  for (const m of members) {
    if (m.status === 'deleted' || m.status === 'inactive') continue;
    const expiry = expiryOf(m);
    if (!expiry) continue;
    const days = dayDiff(today, expiry); // negative = overdue
    const last = lastMembershipPayment(m);
    const row = { ...m, expiry, days, lastPaidOn: last ? String(last.payment_date).slice(0, 10) : null };
    const dueOrExpired = days < 0 || (settings.dueSoonDays > 0 && days <= settings.dueSoonDays);
    if (settings.audience === 'paid_last_month') {
      if (dueOrExpired && row.lastPaidOn && row.lastPaidOn.slice(0, 7) === lastMonth) groups.recent.push(row);
      else if (days < 0) groups.older.push(row);
      continue;
    }
    if (days >= 0 && days <= settings.dueSoonDays && settings.dueSoonDays > 0) groups.dueSoon.push(row);
    else if (days < 0 && -days <= settings.expiredWithinDays) groups.recent.push(row);
    else if (days < 0) groups.older.push(row);
  }
  const byDays = (a, b) => a.days - b.days;
  groups.dueSoon.sort(byDays);
  groups.recent.sort((a, b) => b.days - a.days);
  groups.older.sort((a, b) => b.days - a.days);
  return groups;
}

const formatPKR = (n) => `Rs. ${Number(n || 0).toLocaleString('en-PK')}`;

function buildMessage(member, gym) {
  const fallback = `Hello ${member.name || 'Member'}, this is a reminder from ${gym?.gym_name || 'your gym'} regarding your membership.`;
  const template = member.days >= 0
    ? gym?.wa_msg_due_soon || gym?.wa_msg_active || fallback
    : gym?.wa_msg_expired || gym?.wa_msg_active || fallback;
  return template
    .replace(/\[Name\]/gi, member.name || '')
    .replace(/\[GymName\]/gi, gym?.gym_name || '')
    .replace(/\[Days\]/gi, String(Math.abs(member.days)))
    .replace(/\[Amount\]/gi, formatPKR(gym?.default_monthly_fee))
    .replace(/\[Phone\]/gi, gym?.phone || '');
}

/** Members messaged (automatically or by hand) within the last `days` days. */
async function recentlyMessaged(gymId, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('notifications')
    .select('member_id')
    .eq('gym_id', gymId)
    .in('notification_type', ['automated_reminder', 'wa_reminder'])
    .eq('status', 'sent')
    .gte('sent_at', since);
  if (error) throw error;
  return new Set((data || []).map((n) => n.member_id));
}

async function loadMembers(gymId) {
  const all = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await supabase
      .from('members')
      .select('id, name, phone, status, latest_expiry, payments(expiry_date, payment_date, notes)')
      .eq('gym_id', gymId)
      .neq('status', 'deleted')
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

/** The list the next automatic run would message, with the reason for each. */
async function planReminders(gym, settings) {
  const groups = groupMembers(await loadMembers(gym.id), settings);
  const skip = await recentlyMessaged(gym.id, settings.repeatEveryDays);
  const toSend = [...groups.dueSoon, ...groups.recent]
    .filter((m) => m.phone && String(m.phone).replace(/\D/g, '').length >= 10)
    .filter((m) => !skip.has(m.id))
    .map((m) => ({ ...m, message: buildMessage(m, gym) }));
  return { groups, toSend, skippedRecentlyMessaged: [...groups.dueSoon, ...groups.recent].filter((m) => skip.has(m.id)).length };
}

module.exports = { TZ, gymNow, dayDiff, monthKey, groupMembers, buildMessage, planReminders };
