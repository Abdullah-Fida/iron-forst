const { supabase } = require('../db/supabase');

/**
 * Keeps fingerprint IDs and membership IDs from colliding.
 *
 * The database allows each fingerprint ID once per gym
 * (idx_members_gym_fingerprint_unique), and that rule counts soft-deleted
 * members too. Deleting a member used to hide the row but keep its
 * fingerprint ID, so re-adding the same person with the same ID failed with a
 * raw duplicate-key error ("Internal server error" on Add, "Member not found"
 * on Edit).
 */

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Postgres unique_violation
const isUniqueViolation = (err) => err?.code === '23505';

/**
 * Takes the fingerprint ID off a deleted member so it can be reused, keeping
 * the old value in notes for the record.
 */
async function releaseFingerprint(member) {
  const fp = clean(member.fingerprint_id);
  const tag = fp ? `released_fingerprint_id:${fp};` : '';
  const notes = tag && !String(member.notes || '').includes(tag) ? `${tag}${member.notes || ''}` : member.notes;
  const { error } = await supabase
    .from('members')
    .update({ fingerprint_id: null, notes })
    .eq('id', member.id)
    .eq('gym_id', member.gym_id);
  if (error) throw error;
}

/**
 * Makes sure `fingerprintId` can be given to `memberId` (or a new member when
 * memberId is null). A deleted member holding it gives it up automatically;
 * an active one blocks it.
 * @returns {Promise<{ok: true} | {ok: false, holder: {id, name}}>}
 */
async function claimFingerprint(gymId, fingerprintId, memberId = null) {
  const fp = clean(fingerprintId);
  if (!fp) return { ok: true };

  let query = supabase
    .from('members')
    .select('id, gym_id, name, status, fingerprint_id, notes')
    .eq('gym_id', gymId)
    .eq('fingerprint_id', fp);
  if (memberId) query = query.neq('id', memberId);
  const { data: holders, error } = await query;
  if (error) throw error;

  for (const holder of holders || []) {
    if (holder.status === 'deleted') await releaseFingerprint(holder);
    else return { ok: false, holder };
  }
  return { ok: true };
}

/**
 * Membership IDs are not unique in the database (some existing members share
 * one), so this only stops a NEW clash: a new member, or an edit that changes
 * the ID to one an active member already has.
 */
async function findMembershipIdHolder(gymId, membershipId, memberId = null) {
  const mid = clean(membershipId);
  if (!mid) return null;
  let query = supabase
    .from('members')
    .select('id, name')
    .eq('gym_id', gymId)
    .neq('status', 'deleted')
    // Case-insensitive exact match: % and _ are escaped so they are not wildcards
    .ilike('membership_id', mid.replace(/[%_\\]/g, '\\$&'));
  if (memberId) query = query.neq('id', memberId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

const fingerprintTakenMessage = (fp, holder) =>
  `Fingerprint ID ${clean(fp)} is already assigned to ${holder.name}. Use a different ID, or remove it from ${holder.name} first.`;

module.exports = {
  clean,
  isUniqueViolation,
  releaseFingerprint,
  claimFingerprint,
  findMembershipIdHolder,
  fingerprintTakenMessage,
};
