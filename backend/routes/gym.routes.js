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

router.post('/import', async (req, res) => {
  const gym_id = req.user.gym_id;
  const { members } = req.body;
  if (!Array.isArray(members)) return res.status(400).json({ success: false, message: 'Invalid payload' });

  for (const m of members) {
    const fingerprint_id = m.membership_number;
    
    let memberId;
    const { data: existing } = await supabase
      .from('members')
      .select('id')
      .eq('gym_id', gym_id)
      .eq('fingerprint_id', fingerprint_id)
      .maybeSingle();
      
    if (existing) {
      memberId = existing.id;
      await supabase.from('members').update({
        name: m.name,
        phone: m.phone,
        gender: m.gender
      }).eq('id', memberId);
    } else {
      const { data: newMember, error: insertErr } = await supabase
        .from('members')
        .insert({
          gym_id,
          name: m.name,
          phone: m.phone,
          gender: m.gender,
          fingerprint_id,
          status: 'expired'
        }).select('id').single();
      if (insertErr || !newMember) continue;
      memberId = newMember.id;
    }
    
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
          plan_duration_months: p.plan_duration_months.toString(),
          expiry_date: expiry_date,
          received_by: p.received_by,
          payment_method: 'cash'
        };
      });
      
      await supabase.from('payments').insert(paymentsToInsert);
      
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
  
  res.json({ success: true, message: 'Import completed successfully' });
});

module.exports = router;
