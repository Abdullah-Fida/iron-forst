import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, CreditCard, Calendar, ChevronRight, SkipForward, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { todayStr, calculateExpiryDate, formatDate, formatDateTime, formatPKR, getInitials } from '../../lib/utils';
import { printThermalReceipt } from '../../lib/thermalPrinter';
import { PLAN_DURATIONS, PAYMENT_METHODS } from '../../lib/constants';
import { useToast } from '../../contexts/ToastContext';
import { useFormDraft } from '../../hooks/useFormDraft';
import { generateId } from '../../lib/utils';

export default function AddMemberPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [receipts, setReceipts] = useState([]);
  const [showReceipts, setShowReceipts] = useState(false);
  const [gym, setGym] = useState(null);

  // Unified state for easier drafting
  const [form, setForm] = useState({
    step: 1,
    memberForm: {
      name: '',
      phone: '',
      gender: 'male',
      join_date: todayStr(),
      emergency_contact: '',
      notes: '',
    },
    payForm: {
      amount: '3000',
      payment_date: todayStr(),
      plan_duration_months: 1,
      custom_days: '',
      payment_method: 'cash',
      received_by: '',
      notes: '',
      // New fields for registration/trial flow
      include_registration: false,
      registration_amount: '',
      is_trial: false,
      trial_days: '',
    },
    newMember: null
  });

  const { saveDraft, clearDraft } = useFormDraft('add-member', {}, (draft) => {
    if (draft) {
      setForm(prev => ({
        ...prev,
        ...draft,
        // Ensure sub-objects are merged too
        memberForm: { ...prev.memberForm, ...(draft.memberForm || {}) },
        payForm: { ...prev.payForm, ...(draft.payForm || {}) }
      }));
    }
  });

  useEffect(() => {
    saveDraft(form);
  }, [form, saveDraft]);

  const { memberForm, payForm, step, newMember } = form;

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await api.get('/gym');
        setGym(res.data.data || null);
        if (res.data.data?.default_monthly_fee) {
          setForm(prev => {
            if (prev.payForm.amount === '3000' || !prev.payForm.amount) {
              return {
                ...prev,
                payForm: { ...prev.payForm, amount: String(res.data.data.default_monthly_fee) }
              };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error('Failed to fetch gym settings', err);
      }
    };
    fetchSettings();
  }, []);

  const setMember = (k, v) => setForm(p => ({ ...p, memberForm: { ...p.memberForm, [k]: v } }));
  const setPay = (k, v) => setForm(p => ({ ...p, payForm: { ...p.payForm, [k]: v } }));
  const setStep = (v) => setForm(p => ({ ...p, step: v }));
  const setNewMember = (v) => setForm(p => ({ ...p, newMember: v }));

  const expiryDate = (() => {
    if (!payForm.payment_date) return null;
    if (payForm.is_trial) {
      return payForm.trial_days ? calculateExpiryDate(payForm.payment_date, 0, payForm.trial_days) : null;
    }
    if (!payForm.plan_duration_months) return null;
    return payForm.plan_duration_months === 'custom'
      ? (payForm.custom_days ? calculateExpiryDate(payForm.payment_date, 0, payForm.custom_days) : null)
      : calculateExpiryDate(payForm.payment_date, payForm.plan_duration_months);
  })();

  const shortId = (id) => id ? String(id).substring(0,8) : '';

  // ── Step 1 Submit: Save member, go to Step 2 ──
  const handleMemberSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (!memberForm.name.trim()) { toast.error('Name is required'); return; }
    if (!memberForm.phone.trim()) { toast.error('Phone number is required'); return; }
    
    setLoading(true);
    try {
      // Server-side will handle duplicate checking on phone+name if needed
      // (or we can just attempt to post and let the server return 409 if exists)
      
      const id = generateId();
      const memberData = { ...memberForm, id };
      
      // DIRECT ONLINE API CALL
      const res = await api.post('/members', memberData);
      const serverMember = res.data.data;
      
      setNewMember(serverMember);
      toast.success(`${serverMember.name} added successfully!`);
      setStep(2);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to add member');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 Submit: Save payment, go to member detail ──
  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    // Handle free trial flow
    if (payForm.is_trial) {
      if (!payForm.trial_days || Number(payForm.trial_days) <= 0) { toast.error('Enter valid trial days'); return; }
      setLoading(true);
      try {
        const id = generateId();
        const paymentData = {
          id,
          member_id: newMember.id,
          amount: 0,
          payment_date: payForm.payment_date,
          plan_duration_months: 'custom',
          custom_days: Number(payForm.trial_days),
          payment_method: 'cash',
          received_by: payForm.received_by,
          notes: `payment_type:trial;${payForm.notes || ''}`,
          payment_type: 'trial',
          last_sync: null
        };

        // DIRECT ONLINE API CALL
        const res = await api.post('/payments', paymentData);
        const serverPayment = res.data.data;

        toast.success(`${newMember.name} is now on a free trial!`);
        clearDraft();
        navigate(`/members/${newMember.id}`);
      } catch (err) {
        toast.error('Failed to start trial locally');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Standard membership payment
    if (!payForm.amount || Number(payForm.amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (payForm.plan_duration_months === 'custom' && (!payForm.custom_days || Number(payForm.custom_days) <= 0)) {
      toast.error('Enter valid custom days'); return;
    }

    setLoading(true);
    try {
      const now = new Date().toISOString();
      const estimatedExpiry = expiryDate;

      // Calculate total amount (membership + registration if included)
      const membershipAmount = Number(payForm.amount);
      const registrationAmount = (payForm.include_registration && payForm.registration_amount) ? Number(payForm.registration_amount) : 0;
      const totalAmount = membershipAmount + registrationAmount;

      // Build notes with registration info if included
      let notes = payForm.notes || '';
      if (registrationAmount > 0) {
        notes = `payment_type:membership;registration_fee:${registrationAmount};${notes}`;
      }

      const id = generateId();
      const paymentData = {
        id,
        member_id: newMember.id,
        amount: totalAmount,
        payment_date: payForm.payment_date,
        plan_duration_months: payForm.plan_duration_months === 'custom' ? 'custom' : Number(payForm.plan_duration_months),
        custom_days: Number(payForm.custom_days) || 0,
        payment_method: payForm.payment_method,
        received_by: payForm.received_by,
        notes,
        payment_type: 'membership',
        expiry_date: estimatedExpiry,
        created_at: now,
        last_sync: null
      };

      // DIRECT ONLINE API CALL
      const res = await api.post('/payments', paymentData);
      const serverPayment = res.data.data;

      // Build a single combined receipt
      const receiptData = {
        ...serverPayment,
        member_name: newMember.name,
        member_phone: newMember.phone,
        expiry_date: estimatedExpiry,
      };

      // If registration was included, add itemized breakdown for the receipt
      if (registrationAmount > 0) {
        receiptData.items = [
          { label: 'Membership Fee', amount: membershipAmount },
          { label: 'Registration Fee', amount: registrationAmount }
        ];
        receiptData.total = totalAmount;
      }

      setReceipts([receiptData]);
      setShowReceipts(true);
      window.dispatchEvent(new CustomEvent('local-db-changed'));
      toast.success(`Payment saved successfully for ${newMember.name}!`);
      clearDraft();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to log payment');
    } finally {
      setLoading(false);
    }
  };

  const parseReason = (notes) => {
    if (!notes) return 'Membership Fee';
    const m = String(notes).match(/payment_type:([a-z_]+);?/i);
    let base = m ? (m[1] === 'registration' ? 'Registration Fee' : m[1] === 'trial' ? 'Free Trial' : m[1] === 'membership' ? 'Membership Fee' : m[1]) : '';
    const rest = String(notes).replace(/payment_type:[^;]+;?/, '').trim();
    if (!base && rest) return rest;
    return rest ? `${base} — ${rest}` : (base || 'Membership Fee');
  };

  const printReceipt = (r) => {
    try {
      const gymName = (gym && (gym.gym_name || gym.name)) ? (gym.gym_name || gym.name) : 'Gym';
      const cleanNotes = r.notes ? String(r.notes).replace(/payment_type:[^;]+;?|registration_fee:\d+;?/g, '').trim() : '';

      printThermalReceipt({
        gymName,
        invoiceId: r.id,
        memberName: r.member_name || '',
        memberPhone: r.member_phone || r.memberPhone || '',
        amount: r.amount,
        paymentDate: r.payment_date,
        paymentMethod: r.payment_method,
        expiryDate: r.expiry_date,
        receivedBy: r.received_by || r.receivedBy || '',
        reason: parseReason(r.notes || ''),
        notes: cleanNotes || undefined,
        items: r.items,
        total: r.total,
      });

      setShowReceipts(false);
      navigate(`/members/${newMember.id}`);
    } catch (e) { console.error(e); toast.error('Unable to print'); }
  };

  const cancelReceipt = async (receiptObj) => {
    try {
      const ids = receiptObj && receiptObj.ids && Array.isArray(receiptObj.ids) ? receiptObj.ids : [receiptObj.id];
      for (const pid of ids) {
        await api.delete(`/payments/${pid}`);
      }
      setReceipts(prev => prev.filter(x => x.id !== receiptObj.id));
      toast.success('Receipt canceled');
      if (receipts.length === 1) {
        setShowReceipts(false);
        navigate(`/members/${newMember.id}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel payment');
    }
  };

  // ── Skip payment for now ──
  const handleSkip = () => {
    toast.info(`${newMember.name} added. Payment can be logged later.`);
    clearDraft();
    navigate('/members');
  };

  // ────────────────────────────────────────────────
  return (
    <div className="page-container">

      {/* ── Step Indicator ── */}
      <div className="step-indicator">
        <div className={`step-dot ${step >= 1 ? 'active' : ''}`}>
          <span>1</span>
          <div className="step-label">Member Info</div>
        </div>
        <div className={`step-line ${step >= 2 ? 'active' : ''}`} />
        <div className={`step-dot ${step >= 2 ? 'active' : ''}`}>
          <span>2</span>
          <div className="step-label">Payment</div>
        </div>
      </div>

      {/* ══════════ STEP 1: Member Form ══════════ */}
      {step === 1 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
            <button className="btn btn-icon btn-secondary" onClick={() => navigate('/members')}>
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="page-title">Add Member</h1>
              <p className="page-subtitle">Step 1 of 2 — Member Details</p>
            </div>
          </div>

          <form onSubmit={handleMemberSubmit}>
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input
                className="form-input"
                placeholder="e.g. Ali Hassan"
                value={memberForm.name || ''}
                onChange={e => setMember('name', e.target.value)}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Phone Number *</label>
              <input
                className="form-input"
                placeholder="03001234567"
                type="tel"
                value={memberForm.phone || ''}
                onChange={e => setMember('phone', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Gender</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                <button type="button" className={`btn ${memberForm.gender === 'male' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setMember('gender', 'male')}>Male 👨</button>
                <button type="button" className={`btn ${memberForm.gender === 'female' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setMember('gender', 'female')}>Female 👩</button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Join Date</label>
              <input
                className="form-input"
                type="date"
                value={memberForm.join_date || ''}
                onChange={e => setMember('join_date', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Emergency Contact</label>
              <input
                className="form-input"
                placeholder="Contact name & phone (optional)"
                value={memberForm.emergency_contact || ''}
                onChange={e => setMember('emergency_contact', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea
                className="form-textarea"
                placeholder="Any notes..."
                value={memberForm.notes || ''}
                onChange={e => setMember('notes', e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
              {loading ? <Loader2 className="spin" size={18} /> : 'Next — Log Payment'} 
              {!loading && <ChevronRight size={18} />}
            </button>
          </form>
        </>
      )}

      {/* ══════════ STEP 2: Payment Form ══════════ */}
      {step === 2 && newMember && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
            <button className="btn btn-icon btn-secondary" onClick={() => navigate('/members')}>
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="page-title">Log Payment</h1>
              <p className="page-subtitle">Step 2 of 2 — Fee Collection</p>
            </div>
          </div>

          {/* Member recap card */}
          <div className="new-member-recap">
            <div className="avatar avatar-sm" style={{ background: 'var(--accent-primary)', color: 'white', flexShrink: 0 }}>
              {getInitials(newMember.name)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{newMember.name}</div>
              <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{newMember.phone}</div>
            </div>
            <span className="badge badge-active" style={{ fontSize: 10 }}>New ✓</span>
          </div>

          <form onSubmit={handlePaymentSubmit}>
            {/* Payment / Trial toggle */}
            <div className="form-group">
              <label className="form-label">Type</label>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button type="button" className={`btn ${!payForm.is_trial ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setPay('is_trial', false)}>Payment</button>
                <button type="button" className={`btn ${payForm.is_trial ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setPay('is_trial', true)}>Free Trial</button>
              </div>
            </div>

            {/* Trial UI */}
            {payForm.is_trial ? (
              <div className="form-group">
                <label className="form-label">Trial Days</label>
                <input className="form-input" type="text" inputMode="numeric" value={payForm.trial_days || ''} onChange={e => setPay('trial_days', e.target.value)} placeholder="Number of days" />
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">Amount (PKR)</label>
                  <input
                    className="form-input"
                    type="text" inputMode="numeric"
                    value={payForm.amount || ''}
                    onChange={e => setPay('amount', e.target.value)}
                  />
                </div>

                {/* Registration fee toggle */}
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <input id="regFee" type="checkbox" checked={!!payForm.include_registration} onChange={e => setPay('include_registration', e.target.checked)} />
                  <label htmlFor="regFee" style={{ marginLeft: 8 }}>Include registration fee</label>
                </div>
                {payForm.include_registration && (
                  <div className="form-group">
                    <label className="form-label">Registration Fee (PKR)</label>
                    <input className="form-input" type="text" inputMode="numeric" value={payForm.registration_amount || ''} onChange={e => setPay('registration_amount', e.target.value)} />
                  </div>
                )}
              </>
            )}

            <div className="form-group">
              <label className="form-label">Payment Date</label>
              <input
                className="form-input"
                type="date"
                value={payForm.payment_date || ''}
                onChange={e => setPay('payment_date', e.target.value)}
              />
            </div>

            {!payForm.is_trial && (
              <>
                <div className="form-group">
                  <label className="form-label">Plan Duration</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 'var(--space-sm)', marginBottom: payForm.plan_duration_months === 'custom' ? 'var(--space-sm)' : 0 }}>
                    {PLAN_DURATIONS.map(d => (
                      <button
                        key={d.value}
                        type="button"
                        className={`btn ${String(payForm.plan_duration_months) === String(d.value) ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                        onClick={() => setPay('plan_duration_months', d.value)}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  {payForm.plan_duration_months === 'custom' && (
                    <input 
                      className="form-input" 
                      type="text" inputMode="numeric" 
                      placeholder="Enter number of days" 
                      value={payForm.custom_days} 
                      onChange={e => setPay('custom_days', e.target.value)} 
                    />
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Method</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-sm)' }}>
                    {PAYMENT_METHODS.map(m => (
                      <button
                        key={m.value}
                        type="button"
                        className={`btn ${payForm.payment_method === m.value ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                        onClick={() => setPay('payment_method', m.value)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {expiryDate && (
              <div className="expiry-preview" style={{ marginBottom: 'var(--space-md)' }}>
                <Calendar size={18} className="icon" />
                <div className="text">
                  Membership valid till: <span className="date">{formatDate(expiryDate)}</span>
                </div>
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading} style={{ marginBottom: 'var(--space-sm)' }}>
              {loading ? <Loader2 className="spin" size={18} /> : <><CreditCard size={18} /> Save Payment & Finish</>}
            </button>

            <button type="button" className="btn btn-secondary btn-block" onClick={handleSkip}>
              <SkipForward size={16} /> Skip — Add Payment Later
            </button>
          </form>
        </>
      )}

        {showReceipts && (
          <div className="modal-backdrop" onClick={() => { setShowReceipts(false); navigate(`/members/${newMember.id}`); }}>
            <div className="modal-content" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
              <h2 style={{ marginTop: 0 }}>Payment Receipt{receipts.length > 1 ? 's' : ''}</h2>
              <div style={{ display: 'grid', gap: 12 }}>
                {receipts.map(r => (
                  <div key={r.id} className="card" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{r.member_name || r.member_id}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Invoice: {shortId(r.id)}</div>
                        {r.expiry_date && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Valid till: {formatDate(r.expiry_date)}</div>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {r.items && Array.isArray(r.items) ? (
                          <>
                            <div style={{ fontWeight: 800, color: 'var(--status-active)' }}>{formatPKR(r.total)}</div>
                            <div style={{ fontSize: 12 }}>{formatDateTime(r.payment_date || new Date().toISOString())}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.items.map(it => it.label).join(' + ')}</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontWeight: 800, color: 'var(--status-active)' }}>{formatPKR(r.amount)}</div>
                            <div style={{ fontSize: 12 }}>{(r.payment_date && (String(r.payment_date).includes('T') || new Date(r.payment_date).getHours() || new Date(r.payment_date).getMinutes())) ? formatDateTime(r.payment_date) : formatDate(r.payment_date)}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{parseReason(r.notes || '')}</div>
                          </>
                        )}
                        {r.member_phone && <div style={{ fontSize: 12 }}>{r.member_phone}</div>}
                        {r.received_by && <div style={{ fontSize: 12 }}>Received by: {r.received_by}</div>}
                      </div>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => printReceipt(r)}>Print</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-block" onClick={() => { setShowReceipts(false); navigate(`/members/${newMember.id}`); }}>Done</button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
