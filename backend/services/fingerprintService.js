const { supabase } = require('../db/supabase');

class FingerprintService {
  /**
   * Validate a membership based on fingerprint ID.
   * @param {string} fingerprintId 
   * @returns {Promise<{isValid: boolean, memberId: string|null, status: string}>}
   */
  async validateMembership(fingerprintId) {
    if (!fingerprintId) {
      return { isValid: false, memberId: null, status: 'DENIED' };
    }

    try {
      console.log('Searching member with fingerprint_id:', fingerprintId);
      
      // Look up member by fingerprint_id
      const { data: member, error } = await supabase
        .from('members')
        .select('id, status, latest_expiry')
        .eq('fingerprint_id', fingerprintId)
        .single();

      if (error || !member) {
        console.log('Member not found for fingerprint:', fingerprintId);
        return { isValid: false, memberId: null, status: 'MEMBER_NOT_FOUND' };
      }

      console.log('Member found:', member.id);

      // Check if membership is active and not expired
      const isStatusActive = member.status === 'active';
      const isNotExpired = member.latest_expiry && new Date(member.latest_expiry) >= new Date();

      if (isStatusActive && isNotExpired) {
        console.log('Membership Active');
        return { isValid: true, memberId: member.id, status: 'GRANTED' };
      } else {
        console.log('Membership Expired or Inactive');
        return { isValid: false, memberId: member.id, status: 'EXPIRED' };
      }
    } catch (err) {
      console.error('❌ Error validating membership:', err.message);
      return { isValid: false, memberId: null, status: 'DENIED' };
    }
  }

  /**
   * Log the access attempt in the Supabase database.
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
          timestamp: timestamp || new Date().toISOString(),
          device: device || process.env.DEVICE_NAME || 'SenseFace-M2F-LR',
          status: status
        }]);

      if (error) {
        console.error('❌ Failed to log access:', error.message);
      } else {
        console.log('✅ Access Logged:', status);
      }
    } catch (err) {
      console.error('❌ Error logging access:', err.message);
    }
  }
}

module.exports = new FingerprintService();
