const express = require('express');
const { z } = require('zod');
const { supabase } = require('../db/supabase');
const { authenticate, requireGymOwner } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireGymOwner);

// Detects Postgres "column does not exist" errors (code 42703)
const isColumnMissing = (error) => {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '42703' || msg.includes('column');
};

// Columns that may not exist in older DB schemas
const OPTIONAL_COLUMNS = ['attendance_active', 'grace_period_days'];
const OPTIONAL_DEFAULTS = { attendance_active: false, grace_period_days: 0 };

router.get('/', async (req, res) => {
  const baseSelect = 'id, gym_name, owner_name, phone, city, address, default_monthly_fee, email, plan_type, subscription_ends_at, trial_ends_at, wa_msg_active, wa_msg_due_soon, wa_msg_expired';
  const fullSelect = `${baseSelect}, ${OPTIONAL_COLUMNS.join(', ')}`;

  const primary = await supabase
    .from('gyms')
    .select(fullSelect)
    .eq('id', req.user.gym_id)
    .single();

  if (!primary.error) {
    return res.json({ success: true, data: primary.data });
  }

  if (!isColumnMissing(primary.error)) throw primary.error;

  // Fallback: one of the optional columns doesn't exist yet
  const fallback = await supabase
    .from('gyms')
    .select(baseSelect)
    .eq('id', req.user.gym_id)
    .single();

  if (fallback.error) throw fallback.error;

  res.json({
    success: true,
    data: {
      ...fallback.data,
      ...OPTIONAL_DEFAULTS,
    },
  });
});

router.put('/', async (req, res) => {
  const schema = z.object({
    gym_name: z.string().min(2).optional(),
    owner_name: z.string().min(2).optional(),
    phone: z.string().min(10).optional(),
    city: z.string().optional(),
    address: z.string().optional(),
    default_monthly_fee: z.number().min(0).optional(),
    wa_msg_active: z.string().optional(),
    wa_msg_due_soon: z.string().optional(),
    wa_msg_expired: z.string().optional(),
    attendance_active: z.boolean().optional(),
    grace_period_days: z.number().int().min(0).max(30).optional(),
  });

  const body = schema.parse({
    ...req.body,
    default_monthly_fee: req.body.default_monthly_fee ? Number(req.body.default_monthly_fee) : undefined,
    grace_period_days: req.body.grace_period_days != null ? Number(req.body.grace_period_days) : undefined,
  });

  const primary = await supabase
    .from('gyms')
    .update(body)
    .eq('id', req.user.gym_id)
    .select()
    .single();

  if (!primary.error) {
    return res.json({ success: true, data: primary.data, message: 'Settings saved' });
  }

  if (!isColumnMissing(primary.error)) throw primary.error;

  // Strip optional columns the DB doesn't know about yet
  const fallbackBody = { ...body };
  const strippedValues = {};
  for (const col of OPTIONAL_COLUMNS) {
    if (col in fallbackBody) {
      strippedValues[col] = fallbackBody[col];
      delete fallbackBody[col];
    }
  }

  const fallback = await supabase
    .from('gyms')
    .update(fallbackBody)
    .eq('id', req.user.gym_id)
    .select()
    .single();

  if (fallback.error) throw fallback.error;

  res.json({
    success: true,
    data: {
      ...fallback.data,
      ...OPTIONAL_DEFAULTS,
      ...Object.fromEntries(
        Object.entries(strippedValues).map(([k, v]) => [k, v ?? OPTIONAL_DEFAULTS[k]])
      ),
    },
    message: 'Settings saved',
  });
});

// ── GET /api/gym/export ─── Export all members + payments as JSON for Excel
router.get('/export', async (req, res) => {
  const gym_id = req.user.gym_id;

  const { data: members, error } = await supabase
    .from('members')
    .select('id, name, phone, gender, fingerprint_id, join_date, status, latest_expiry, payments(id, amount, payment_date, expiry_date, plan_duration_months, received_by)')
    .eq('gym_id', gym_id)
    .neq('status', 'deleted')
    .order('name');

  if (error) throw error;

  res.json({ success: true, data: members });
});

// ── GET /api/gym/existing-members ─── Return existing membership numbers & phones for duplicate detection
router.get('/existing-members', async (req, res) => {
  const gym_id = req.user.gym_id;

  const { data: members, error } = await supabase
    .from('members')
    .select('id, name, phone, fingerprint_id')
    .eq('gym_id', gym_id)
    .neq('status', 'deleted');

  if (error) throw error;

  // Build lookup sets for the frontend
  const membershipNumbers = {};
  const phones = {};
  (members || []).forEach(m => {
    if (m.fingerprint_id) membershipNumbers[m.fingerprint_id.trim().toLowerCase()] = m.name;
    if (m.phone) phones[m.phone.replace(/[^0-9]/g, '')] = m.name;
  });

  res.json({ success: true, data: { membershipNumbers, phones } });
});

// ── POST /api/gym/import ─── Import members from Excel (rejects duplicates, batch-tagged for undo)
router.post('/import', async (req, res) => {
  const gym_id = req.user.gym_id;
  const { members, batchId } = req.body;
  if (!Array.isArray(members)) return res.status(400).json({ success: false, message: 'Invalid payload' });
  if (!batchId) return res.status(400).json({ success: false, message: 'Batch ID is required' });

  let imported = 0;
  let skipped = 0;
  const skippedNames = [];

  for (const m of members) {
    // Blank must become NULL, not ''. The partial unique index exempts NULL
    // but not '', so a second blank row would fail with a duplicate key.
    const rawFp = m.membership_number;
    const fingerprint_id = (rawFp === null || rawFp === undefined || String(rawFp).trim() === '')
      ? null
      : String(rawFp).trim();

    // ── DUPLICATE CHECK: reject if member already exists ──
    let existing = null;

    // Check by fingerprint_id (membership number)
    if (fingerprint_id) {
      const found = await supabase
        .from('members')
        .select('id, name')
        .eq('gym_id', gym_id)
        .eq('fingerprint_id', fingerprint_id)
        .neq('status', 'deleted')
        .maybeSingle();
      existing = found.data;
    }

    // Also check by phone if no fingerprint match
    if (!existing && m.phone) {
      const cleanPhone = String(m.phone).replace(/[^0-9]/g, '');
      if (cleanPhone.length >= 10) {
        const found = await supabase
          .from('members')
          .select('id, name')
          .eq('gym_id', gym_id)
          .neq('status', 'deleted')
          .ilike('phone', `%${cleanPhone.slice(-10)}`);
        if (found.data && found.data.length > 0) {
          existing = found.data[0];
        }
      }
    }

    // If member already exists, SKIP entirely — do NOT update
    if (existing) {
      skipped++;
      skippedNames.push(m.name || existing.name);
      continue;
    }

    // ── INSERT new member tagged with batchId ──
    const joinDate = m.join_date || null;

    const { data: newMember, error: insertErr } = await supabase
      .from('members')
      .insert({
        gym_id,
        name: m.name,
        phone: m.phone || '0000000000',
        gender: m.gender || 'male',
        fingerprint_id,
        join_date: joinDate,
        status: 'expired',
        notes: batchId  // Tag for undo
      }).select('id').single();

    if (insertErr || !newMember) {
      console.error(`[Import] Failed to insert member ${m.name}:`, insertErr?.message);
      continue;
    }

    const memberId = newMember.id;
    imported++;

    // ── INSERT payments tagged with batchId ──
    if (m.payments && m.payments.length > 0) {
      const paymentsToInsert = m.payments.map(p => {
        const d = new Date(p.payment_date);
        d.setMonth(d.getMonth() + Number(p.plan_duration_months || 1));
        const expiry_date = d.toISOString().split('T')[0];

        return {
          gym_id,
          member_id: memberId,
          amount: p.amount,
          payment_date: p.payment_date,
          plan_duration_months: (p.plan_duration_months || 1).toString(),
          expiry_date,
          received_by: p.received_by || 'Import',
          payment_method: 'cash',
          notes: batchId  // Tag for undo
        };
      });

      await supabase.from('payments').insert(paymentsToInsert);

      // Recompute member status based on latest payment expiry
      const { data: latestPayment } = await supabase
        .from('payments')
        .select('expiry_date')
        .eq('member_id', memberId)
        .eq('gym_id', gym_id)
        .order('expiry_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestPayment) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiryDate = new Date(latestPayment.expiry_date);
        expiryDate.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
        let status = 'expired';
        if (daysLeft > 3) status = 'active';
        else if (daysLeft >= 0) status = 'due_soon';
        await supabase.from('members')
          .update({ latest_expiry: latestPayment.expiry_date, status })
          .eq('id', memberId);
      }
    }
  }

  console.log(`[Import] Gym ${gym_id}: Imported ${imported}, Skipped ${skipped} duplicates. Batch: ${batchId}`);

  res.json({
    success: true,
    message: `Import completed! ${imported} new member(s) imported${skipped > 0 ? `, ${skipped} duplicate(s) skipped` : ''}.`,
    batchId,
    imported,
    skipped,
    skippedNames
  });
});

// ── DELETE /api/gym/undo-import/:batchId ─── Safely reverse an import batch
router.delete('/undo-import/:batchId', async (req, res) => {
  const gym_id = req.user.gym_id;
  const { batchId } = req.params;

  if (!batchId || !batchId.startsWith('import_')) {
    return res.status(400).json({ success: false, message: 'Invalid batch ID' });
  }

  // 1. Find all members from this batch
  const { data: batchMembers, error: findErr } = await supabase
    .from('members')
    .select('id, name')
    .eq('gym_id', gym_id)
    .eq('notes', batchId);

  if (findErr) throw findErr;

  if (!batchMembers || batchMembers.length === 0) {
    return res.json({ success: false, message: 'No imported members found for this batch. It may have already been undone.' });
  }

  const memberIds = batchMembers.map(m => m.id);

  // 2. Delete payments first (foreign key constraint)
  const { error: payDeleteErr, count: payCount } = await supabase
    .from('payments')
    .delete({ count: 'exact' })
    .eq('gym_id', gym_id)
    .eq('notes', batchId);

  if (payDeleteErr) throw payDeleteErr;

  // 3. Delete the members
  const { error: memDeleteErr, count: memCount } = await supabase
    .from('members')
    .delete({ count: 'exact' })
    .eq('gym_id', gym_id)
    .eq('notes', batchId);

  if (memDeleteErr) throw memDeleteErr;

  console.log(`[Undo Import] Gym ${gym_id}: Removed ${memCount} members and ${payCount} payments. Batch: ${batchId}`);

  res.json({
    success: true,
    message: `Undo complete! Removed ${memCount} member(s) and ${payCount} payment(s).`,
    deletedMembers: memCount,
    deletedPayments: payCount
  });
});

module.exports = router;

