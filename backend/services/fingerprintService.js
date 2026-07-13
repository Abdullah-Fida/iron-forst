const { supabase } = require('../db/supabase');

class FingerprintService {
  /**
   * Validate a membership based on fingerprint ID.
   * Since this is a single-gym system, we look up the member across
   * all gyms and return the gym_id along with validation status.
   * @param {string} fingerprintId 
   * @returns {Promise<{isValid: boolean, memberId: string|null, gymId: string|null, status: string}>}
   */
  async validateMembership(fingerprintId) {
    if (!fingerprintId) {
      return { isValid: false, memberId: null, gymId: null, status: 'DENIED' };
    }

    try {
      console.log('🔎 Searching member with fingerprint_id:', fingerprintId);
      
      // Look up member by fingerprint_id
      const { data: member, error } = await supabase
        .from('members')
        .select('id, gym_id, status, latest_expiry, name')
        .eq('fingerprint_id', fingerprintId)
        .maybeSingle();

      if (error) {
        console.error('❌ DB error looking up fingerprint:', error.message);
        return { isValid: false, memberId: null, gymId: null, status: 'DENIED' };
      }

      if (!member) {
        console.log('❌ No member found for fingerprint_id:', fingerprintId);
        return { isValid: false, memberId: null, gymId: null, status: 'MEMBER_NOT_FOUND' };
      }

      console.log(`👤 Member found: ${member.name} (ID: ${member.id})`);

      // Check if membership is active and not expired (with grace period)
      const isStatusActive = member.status === 'active';

      // Fetch the gym's grace period setting
      let graceDays = 0;
      try {
        const { data: gym } = await supabase
          .from('gyms')
          .select('grace_period_days')
          .eq('id', member.gym_id)
          .maybeSingle();
        graceDays = gym?.grace_period_days || 0;
      } catch (e) {
        // Column may not exist yet — default to 0
      }

      let isNotExpired = false;
      if (member.latest_expiry) {
        const expiryDate = new Date(member.latest_expiry);
        expiryDate.setDate(expiryDate.getDate() + graceDays); // Add grace period
        isNotExpired = expiryDate >= new Date();
      }

      if (isStatusActive && isNotExpired) {
        console.log(`✅ ${member.name} — Membership ACTIVE (expires: ${member.latest_expiry}, grace: +${graceDays}d)`);
        return { isValid: true, memberId: member.id, gymId: member.gym_id, status: 'GRANTED' };
      } else {
        const reason = !isStatusActive ? 'status is not active' : `expired on ${member.latest_expiry}`;
        console.log(`🚫 ${member.name} — Access DENIED (${reason})`);
        return { isValid: false, memberId: member.id, gymId: member.gym_id, status: 'EXPIRED' };
      }
    } catch (err) {
      console.error('❌ Error validating membership:', err.message);
      return { isValid: false, memberId: null, gymId: null, status: 'DENIED' };
    }
  }

  /**
   * Mark attendance for a member (prevents duplicate check-ins on the same day).
   * @param {string} memberId 
   * @param {string} gymId 
   * @param {string} scanTime - ISO timestamp or "YYYY-MM-DD HH:mm:ss"
   * @returns {Promise<object|null>} The attendance record or null if already marked
   */
  async markAttendance(memberId, gymId, scanTime) {
    try {
      // Normalize the date for today's check
      const scanDate = scanTime ? scanTime.split('T')[0].split(' ')[0] : new Date().toISOString().split('T')[0];
      const checkInTime = scanTime ? new Date(scanTime).toISOString() : new Date().toISOString();

      // Check if already checked in today
      const { data: existing } = await supabase
        .from('attendance')
        .select('id')
        .eq('member_id', memberId)
        .eq('date', scanDate)
        .eq('gym_id', gymId)
        .maybeSingle();

      if (existing) {
        console.log(`ℹ️ Member ${memberId} already checked in today (${scanDate})`);
        return null; // Already marked
      }

      // Insert new attendance record
      const { data, error } = await supabase
        .from('attendance')
        .insert({
          member_id: memberId,
          gym_id: gymId,
          date: scanDate,
          check_in_time: checkInTime,
        })
        .select('id, member_id, check_in_time, date')
        .single();

      if (error) {
        console.error('❌ Failed to mark attendance:', error.message);
        return null;
      }

      return data;
    } catch (err) {
      console.error('❌ Error marking attendance:', err.message);
      return null;
    }
  }

  /**
   * Log the access attempt in the database.
   * @param {string} memberId 
   * @param {string} fingerprintId 
   * @param {string} timestamp 
   * @param {string} device 
   * @param {string} status 
   */
  async logAccess(memberId, fingerprintId, timestamp, device, status) {
    try {
      const { error } = await supabase
        .from('access_logs')
        .insert([{
          member_id: memberId || null,
          fingerprint_id: fingerprintId,
          timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
          device: device || process.env.DEVICE_NAME || 'SenseFace-M2F-LR',
          status: status
        }]);

      if (error) {
        console.error('❌ Failed to log access:', error.message);
      } else {
        console.log(`📝 Access Logged: ${status} | fingerprint_id: ${fingerprintId}`);
      }
    } catch (err) {
      console.error('❌ Error logging access:', err.message);
    }
  }

  /**
   * Get full member details by member ID (used for SSE event payloads).
   * @param {string} memberId
   * @returns {Promise<object|null>}
   */
  async getMemberDetails(memberId) {
    if (!memberId) return null;
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, name, phone, status, latest_expiry, fingerprint_id, notes')
        .eq('id', memberId)
        .maybeSingle();

      if (error || !data) return null;
      return data;
    } catch (err) {
      console.error('❌ Error fetching member details:', err.message);
      return null;
    }
  }
}

module.exports = new FingerprintService();
