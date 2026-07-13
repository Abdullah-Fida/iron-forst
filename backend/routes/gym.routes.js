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

module.exports = router;
