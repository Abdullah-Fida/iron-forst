const express = require('express');
const { z } = require('zod');
const { supabase } = require('../db/supabase');
const { authenticate, requireGymOwner, ownGymOnly } = require('../middleware/auth');
const {
  clean,
  isUniqueViolation,
  claimFingerprint,
  findMembershipIdHolder,
  fingerprintTakenMessage,
} = require('../services/memberIds');

const router = express.Router();
router.use(authenticate, requireGymOwner);

const memberSchema = z.object({
  id: z.string().optional(), // allow client-generated offline id
  membership_id: z.string().optional(),
  name: z.string().min(1).max(100),
  phone: z.string().min(10).max(20),
  cnic: z.string().optional(),
  gender: z.enum(['male', 'female']).optional(),
  join_date: z.string().optional(),
  emergency_contact: z.string().optional(),
  fingerprint_id: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

// A blank fingerprint must be stored as NULL, never as ''.
// idx_members_gym_fingerprint_unique is a partial index with
// "WHERE fingerprint_id IS NOT NULL", so NULL rows are exempt from the
// uniqueness rule but '' is not — every unenrolled member saved as ''
// competes for the same index slot, and the second one fails with a
// duplicate-key error. Only rewrites the key when the client actually sent
// it, so a partial edit (e.g. renaming a member) leaves the value alone.
const blankToNull = (body, keys = ['fingerprint_id']) => {
  for (const k of keys) {
    if (k in body && (body[k] === null || String(body[k]).trim() === '')) body[k] = null;
  }
  return body;
};

/**
 * Checks the IDs in a create/edit before writing, so the person gets a clear
 * message instead of a raw database error. Returns the message, or null.
 */
const checkIds = async (gymId, body, memberId = null, { membership = true } = {}) => {
  if ('fingerprint_id' in body && body.fingerprint_id) {
    body.fingerprint_id = clean(body.fingerprint_id);
    const fp = await claimFingerprint(gymId, body.fingerprint_id, memberId);
    if (!fp.ok) return fingerprintTakenMessage(body.fingerprint_id, fp.holder);
  }
  if (membership && body.membership_id) {
    const holder = await findMembershipIdHolder(gymId, body.membership_id, memberId);
    if (holder) return `Membership ID ${clean(body.membership_id)} is already used by ${holder.name}. Please use a different ID.`;
  }
  return null;
};

// Last line of defence if two saves race past checkIds.
const duplicateMessage = (error, body) =>
  /fingerprint/i.test(`${error.message} ${error.details}`)
    ? `Fingerprint ID ${clean(body.fingerprint_id)} is already assigned to another member.`
    : 'This member conflicts with an existing record (duplicate ID).';

// PostgREST caps how many rows a single response may return, so large gyms are
// fetched in chunks and stitched together instead of being silently truncated.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

// PostgREST parses `,` `(` `)` as filter syntax inside .or(), so they must not
// reach the query from user input.
const sanitizeSearch = (s) => String(s).replace(/[,()\\]/g, ' ').trim();

const buildMembersQuery = (gid, { status, gender, search, sort }) => {
  let query = supabase
    .from('members')
    .select('*, payments(id, amount, payment_date, expiry_date, plan_duration_months)', { count: 'exact' })
    .eq('gym_id', gid)
    .order('payment_date', { foreignTable: 'payments', ascending: false });

  // Soft-deleted members are hidden unless explicitly asked for
  if (status !== 'deleted') query = query.neq('status', 'deleted');

  if (status === 'inactive') {
    // Show members explicitly inactive OR those who never paid
    query = query.or('status.eq.inactive,latest_expiry.is.null');
  } else if (status === 'active') {
    // Show only active members who have actually paid
    query = query.eq('status', 'active').not('latest_expiry', 'is', null);
  } else if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  if (gender && gender !== 'all') {
    query = query.eq('gender', gender);
  }

  if (search) {
    const s = sanitizeSearch(search);
    if (s) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%,membership_id.ilike.%${s}%`);
  }

  if (sort === 'join_date') query = query.order('join_date', { ascending: false });
  else query = query.order('name');
  // Unique tiebreaker keeps chunked paging stable when names/join dates collide
  query = query.order('id', { ascending: true });

  return query;
};

// ── GET /api/members ─── List all members for a gym
router.get('/', async (req, res) => {
  const { gym_id, status, gender, search, sort = 'name', limit, offset = 0 } = req.query;
  const gid = gym_id || req.user.gym_id;
  const filters = { status, gender, search, sort };
  const start = Number(offset) || 0;

  // Explicit pagination requested by the caller
  if (limit !== undefined && limit !== '') {
    const lim = Math.max(1, Number(limit) || 1);
    const { data, error, count } = await buildMembersQuery(gid, filters).range(start, start + lim - 1);
    if (error) throw error;
    return res.json({ success: true, data, count: count ?? data.length });
  }

  // No limit given: return every matching member. Previously this fell back to a
  // hard 100-row cap, which hid members past the first 100 (alphabetically) from
  // the directory, dashboard, attendance search and reminders.
  const all = [];
  let total = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = start + page * PAGE_SIZE;
    const { data, error, count } = await buildMembersQuery(gid, filters).range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (total === null) total = count;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    if (total !== null && start + all.length >= total) break;
  }

  res.json({ success: true, data: all, count: total ?? all.length });
});

// ── GET /api/members/:id ─── Single member
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase.from('members').select('*, payments(*)').eq('id', req.params.id).eq('gym_id', req.user.gym_id).single();
  if (error || !data) return res.status(404).json({ success: false, message: 'Member not found' });
  res.json({ success: true, data });
});

// ── POST /api/members ─── Add member
router.post('/', async (req, res) => {
  const body = blankToNull(memberSchema.parse(req.body));

  const { data: existing } = await supabase
    .from('members')
    .select('id')
    .eq('gym_id', req.user.gym_id)
    .eq('phone', body.phone.trim())
    .ilike('name', body.name.trim())
    .neq('status', 'deleted')
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ success: false, message: 'Member with this name and phone already exists' });
  }

  const idProblem = await checkIds(req.user.gym_id, body);
  if (idProblem) return res.status(409).json({ success: false, message: idProblem });

  const { data, error } = await supabase.from('members').insert({ ...body, gym_id: req.user.gym_id, status: body.status || 'inactive' }).select().single();
  if (isUniqueViolation(error)) return res.status(409).json({ success: false, message: duplicateMessage(error, body) });
  if (error) throw error;
  res.status(201).json({ success: true, data, message: 'Member added successfully' });
});

// ── PUT /api/members/:id ─── Update member
router.put('/:id', async (req, res) => {
  const body = blankToNull(memberSchema.partial().parse(req.body));
  const { data: current, error: findError } = await supabase
    .from('members')
    .select('id, membership_id')
    .eq('id', req.params.id)
    .eq('gym_id', req.user.gym_id)
    .maybeSingle();
  if (findError) throw findError;
  if (!current) return res.status(404).json({ success: false, message: 'Member not found' });

  // An unchanged membership ID is not re-checked, so members who already share
  // one can still be edited.
  const membershipChanged = 'membership_id' in body && clean(body.membership_id).toLowerCase() !== clean(current.membership_id).toLowerCase();
  const idProblem = await checkIds(req.user.gym_id, body, req.params.id, { membership: membershipChanged });
  if (idProblem) return res.status(409).json({ success: false, message: idProblem });

  const { data, error } = await supabase.from('members').update(body).eq('id', req.params.id).eq('gym_id', req.user.gym_id).select().single();
  if (isUniqueViolation(error)) return res.status(409).json({ success: false, message: duplicateMessage(error, body) });
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: 'Member not found' });
  res.json({ success: true, data, message: 'Member updated' });
});

// ── DELETE /api/members/:id ─── Delete member
router.delete('/:id', async (req, res) => {
  const memberId = req.params.id;
  const gymId = req.user.gym_id;
  const { permanent } = req.query;

  let error;
  if (permanent === 'true') {
    // Hard delete member and all associated records (via DB cascade)
    const result = await supabase.from('members').delete().eq('id', memberId).eq('gym_id', gymId);
    error = result.error;
  } else {
    // Soft delete member instead of unlinking/deleting, to preserve payment history names.
    // The fingerprint ID is released at the same time: a hidden member keeping it
    // blocked the ID from ever being given to anyone again (database unique index).
    const { data: member, error: findError } = await supabase
      .from('members')
      .select('id, fingerprint_id, notes')
      .eq('id', memberId)
      .eq('gym_id', gymId)
      .maybeSingle();
    if (findError) throw findError;
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

    const update = { status: 'deleted' };
    const fp = clean(member.fingerprint_id);
    if (fp) {
      update.fingerprint_id = null;
      update.notes = `released_fingerprint_id:${fp};${member.notes || ''}`;
    }
    const result = await supabase.from('members').update(update).eq('id', memberId).eq('gym_id', gymId);
    error = result.error;
  }
  
  if (error) {
    console.error('CRITICAL Delete error for Member:', memberId, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete member due to database error'
    });
  }

  res.json({ success: true, message: permanent === 'true' ? 'Member and all associated records permanently deleted' : 'Member removed (records preserved)' });
});

// ── GET /api/members/:id/attendance ─── Member attendance
router.get('/:id/attendance', async (req, res) => {
  const { month, year } = req.query;
  let query = supabase.from('attendance').select('*').eq('member_id', req.params.id).eq('gym_id', req.user.gym_id);
  if (month && year) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = `${year}-${String(month).padStart(2, '0')}-31`;
    query = query.gte('date', start).lte('date', end);
  }
  const { data, error } = await query.order('date', { ascending: false });
  if (error) throw error;
  res.json({ success: true, data });
});

module.exports = router;
