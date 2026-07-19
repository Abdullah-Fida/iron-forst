// Iron Fost — Utility Functions

export function formatPKR(amount) {
  return `PKR ${Number(amount || 0).toLocaleString('en-PK')}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) { return '—'; }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + 
           d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return '—'; }
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function daysFromNow(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export function calculateExpiryDate(paymentDate, durationMonths, customDays = 0) {
  if (!paymentDate) return null;
  const d = new Date(paymentDate);
  let parsedDays = Number(customDays);
  if (isNaN(parsedDays)) parsedDays = 0;
  
  const daysToAdd = durationMonths === 'custom' || durationMonths === 0 
    ? parsedDays 
    : (Number(durationMonths) * 30);
    
  d.setDate(d.getDate() + daysToAdd);
  try {
    return d.toISOString().split('T')[0];
  } catch (e) {
    return paymentDate; // fallback
  }
}

export function getMemberStatus(expiryDate) {
  if (!expiryDate) return 'expired';
  const days = daysFromNow(expiryDate);
  if (days < 0) return 'expired';
  if (days <= 3) return 'due_soon';
  return 'active';
}

export function calculateMemberStatus(member) {
  if (member.status === 'deleted') return 'deleted';
  
  let actualExpiry = member.latest_expiry;
  if (!actualExpiry && member.payments && member.payments.length > 0) {
    const sorted = [...member.payments].sort((a, b) => {
      const dateA = new Date(a.expiry_date || a.payment_date || 0);
      const dateB = new Date(b.expiry_date || b.payment_date || 0);
      return dateB - dateA;
    });
    actualExpiry = sorted[0].expiry_date || sorted[0].payment_date;
  }

  const days = daysFromNow(actualExpiry);
  let status = member.status;
  
  if (status === 'trial') {
    if (days !== null && days < 0) return 'expired';
    return 'trial';
  }
  
  if (status !== 'inactive') {
    if (days === null) status = 'inactive';
    else if (days < 0) status = 'expired';
    else if (days <= 3) status = 'due_soon';
    else status = 'active';
  }
  return status;
}

export function getStatusColor(status) {
  switch (status) {
    case 'active': return 'var(--status-active)';
    case 'due_soon': return 'var(--status-warning)';
    case 'expired': return 'var(--status-danger)';
    default: return 'var(--text-muted)';
  }
}

export function getStatusLabel(status) {
  switch (status) {
    case 'active': return 'Active';
    case 'due_soon': return 'Due Soon';
    case 'expired': return 'Expired';
    default: return 'Unknown';
  }
}

export function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function getWhatsAppLink(phone, message) {
  let cleaned = phone.replace(/[^0-9]/g, '');
  // Handle all Pakistani number formats:
  // 03001234567 (11 digits) → 923001234567
  // 3001234567  (10 digits) → 923001234567
  // 923001234567 (12 digits, already international) → keep as is
  // +923001234567 → 923001234567 (+ already stripped above)
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = '92' + cleaned.substring(1);
  } else if (cleaned.length === 10 && !cleaned.startsWith('0') && !cleaned.startsWith('92')) {
    cleaned = '92' + cleaned;
  } else if (cleaned.startsWith('92') && cleaned.length === 12) {
    // Already correct international format
  }
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${cleaned}?text=${encoded}`;
}

export function buildWhatsAppMessage(member, gym) {
  let template = gym.wa_msg_active || 'Hello [Name]';
  const days = member.latest_expiry ? daysFromNow(member.latest_expiry) : null;
  
  if (member.status === 'expired') {
    template = gym.wa_msg_expired || gym.wa_msg_active;
  } else if (member.status === 'due_soon') {
    template = gym.wa_msg_due_soon || gym.wa_msg_active;
  }

  const daysStr = days !== null ? Math.abs(days).toString() : '0';
  
  return template
    .replace(/\[Name\]/gi, member.name || '')
    .replace(/\[GymName\]/gi, gym.gym_name || '')
    .replace(/\[Days\]/gi, daysStr)
    .replace(/\[Amount\]/gi, formatPKR(gym.default_monthly_fee || 0))
    .replace(/\[Phone\]/gi, gym.phone || '');
}

export function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export function getCurrentMonth() {
  return new Date().getMonth() + 1;
}

export function getCurrentYear() {
  return new Date().getFullYear();
}

export function getMonthName(month) {
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month] || '';
}

export function calculateHealthScore(gym) {
  let score = 0;
  // Days since last login (30%)
  const loginDays = gym.last_login_at ? daysFromNow(gym.last_login_at) * -1 : 30;
  score += Math.max(0, Math.min(100, (30 - loginDays) / 30 * 100)) * 0.3;
  // Members added (25%)
  score += (gym.members_added_this_month > 0 ? 100 : 0) * 0.25;
  // Payments this month (25%)
  score += (gym.payments_this_month > 0 ? 100 : 0) * 0.25;
  // Profile completeness (20%)
  const fields = [gym.gym_name, gym.phone, gym.address, gym.default_monthly_fee];
  const filled = fields.filter(Boolean).length;
  score += (filled / fields.length * 100) * 0.2;
  
  // If suspended, drop health significantly
  if (gym.is_active === false) score = Math.max(0, score - 50);
  
  return Math.round(score);
}
