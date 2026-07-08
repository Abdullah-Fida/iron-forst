import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, Calendar, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { todayStr, formatPKR, calculateExpiryDate, formatDate, formatDateTime } from '../../lib/utils';
import { printThermalReceipt } from '../../lib/thermalPrinter';
import { PLAN_DURATIONS, PAYMENT_METHODS } from '../../lib/constants';
import { useToast } from '../../contexts/ToastContext';
import { useFormDraft } from '../../hooks/useFormDraft';
import { generateId } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import '../../styles/payments.css';

export default function AddPaymentPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const preselectedMemberId = searchParams.get('member') || '';

  const [form, setForm] = useState({
    member_id: preselectedMemberId,
    amount: '3000', // Initial fallback
    payment_date: todayStr(),
    plan_duration_months: 1,
    custom_days: '',
    payment_method: 'cash',
    received_by: '',
    notes: '',
    // trial support
    is_trial: false,
    trial_days: '',
  });

  const [search, setSearch] = useState('');
  const [members, setMembers] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [receipts, setReceipts] = useState([]);
  const [showReceipts, setShowReceipts] = useState(false);
  const [gym, setGym] = useState(null);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const { saveDraft, clearDraft } = useFormDraft('add-payment', {}, (draft) => {
    if (draft.form) setForm(prev => ({ ...prev, ...(draft.form || {}) }));
    if (draft.selectedMember) setSelectedMember(draft.selectedMember);
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await api.get('/gym');
        setGym(res.data.data || null);
        if (res.data.data?.default_monthly_fee) {
          // Apply if amount is the fallback OR empty
          setForm(prev => (prev.amount === '3000' || !prev.amount) ? { ...prev, amount: String(res.data.data.default_monthly_fee) } : prev);
        }
      } catch (err) {
        console.error('Failed to fetch gym settings', err);
      }
    };
    fetchSettings();
  }, []);

  useEffect(() => {
    saveDraft({ form, selectedMember });
  }, [form, selectedMember, saveDraft]);

  useEffect(() => {
    if (preselectedMemberId) {
      api.get(`/members/${preselectedMemberId}`).then(res => {
        if (res.data.data) setSelectedMember(res.data.data);
      }).catch(err => {
        console.error('Failed to fetch preselected member', err);
      });
    }
  }, [preselectedMemberId]);

  useEffect(() => {
    if (search.trim().length > 0) {
      setLoadingMembers(true);
      const timer = setTimeout(async () => {
        try {
          const res = await api.get('/members', { params: { search: search.trim() } });
          const allMembers = res.data.data || [];
          const matches = allMembers.filter(m => {
            if (m.status === 'deleted') return false;
            const s = search.toLowerCase().trim();
            const nameMatch = (m.name || '').toLowerCase().includes(s);
            const phoneMatch = String(m.phone || '').includes(s);
            return nameMatch || phoneMatch;
          });
          setMembers(matches.slice(0, 10));
        } catch (err) {
          console.error('Search failed', err);
        } finally {
          setLoadingMembers(false);
        }
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setMembers([]);
    }
  }, [search]);

  const expiryDate = (() => {
    if (!form.payment_date) return null;
    if (form.is_trial) return form.trial_days ? calculateExpiryDate(form.payment_date, 0, form.trial_days) : null;
    if (!form.plan_duration_months) return null;
    return form.plan_duration_months === 'custom'
      ? (form.custom_days ? calculateExpiryDate(form.payment_date, 0, form.custom_days) : null)
      : calculateExpiryDate(form.payment_date, form.plan_duration_months);
  })();

  const shortId = (id) => id ? String(id).substring(0,8) : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.member_id) { toast.error('Please select a member'); return; }
    // Trial flow
    if (form.is_trial) {
      if (!form.trial_days || Number(form.trial_days) <= 0) { toast.error('Enter valid trial days'); return; }
      setIsSaving(true);
      try {
        const id = generateId();
        const paymentData = {
          id,
          member_id: form.member_id,
          amount: 0,
          payment_date: form.payment_date,
          plan_duration_months: 'custom',
          custom_days: Number(form.trial_days),
          payment_method: 'cash',
          received_by: form.received_by,
          notes: `payment_type:trial;${form.notes || ''}`,
          payment_type: 'trial',
          expiry_date: expiryDate,
          created_at: new Date().toISOString(),
          last_sync: null
        };
        
        const res = await api.post('/payments', paymentData);
        const serverPayment = res.data.data;

        toast.success(`Free trial started!`);
        clearDraft();
        navigate(`/members/${form.member_id}`);
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to start trial');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (!form.amount || Number(form.amount) <= 0) { toast.error('Enter a valid amount'); return; }
    if (form.plan_duration_months === 'custom' && (!form.custom_days || Number(form.custom_days) <= 0)) { toast.error('Enter valid custom days'); return; }

    setIsSaving(true);
    try {
      const id = generateId();
      const paymentData = { 
        id,
        member_id: form.member_id,
        amount: Number(form.amount), 
        payment_date: form.payment_date,
        plan_duration_months: form.plan_duration_months === 'custom' ? 'custom' : Number(form.plan_duration_months),
        custom_days: Number(form.custom_days) || 0,
        payment_method: form.payment_method,
        received_by: form.received_by,
        notes: form.notes,
        payment_type: 'membership',
        expiry_date: expiryDate,
        created_at: new Date().toISOString(),
        last_sync: null
      };

      const res = await api.post('/payments', paymentData);
      const serverPayment = res.data.data;

      const estimatedExpiry = expiryDate;

      setReceipts([ { ...serverPayment, member_name: selectedMember?.name || form.member_id, member_phone: selectedMember?.phone, expiry_date: estimatedExpiry } ]);
      
      setShowReceipts(true);
      toast.success(`Payment saved!`);
      clearDraft();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to log payment');
    } finally {
      setIsSaving(false);
    }
  };

  const printReceipt = (r) => {
    try {
      const parseReason = (notes) => {
        if (!notes) return 'Membership Fee';
        const m = String(notes).match(/payment_type:([a-z_]+);?/i);
        let base = m ? (m[1] === 'registration' ? 'Registration Fee' : m[1] === 'trial' ? 'Free Trial' : m[1] === 'membership' ? 'Membership Fee' : m[1]) : '';
        const rest = String(notes).replace(/payment_type:[^;]+;?|registration_fee:\d+;?/g, '').trim();
        if (!base && rest) return rest;
        return rest ? `${base} — ${rest}` : (base || 'Membership Fee');
      };

      const gymName = (gym && (gym.gym_name || gym.name)) ? (gym.gym_name || gym.name) : (user?.gym_name || 'IRON FOST');
      const cleanNotes = r.notes ? String(r.notes).replace(/payment_type:[^;]+;?|registration_fee:\d+;?/g, '').trim() : '';

      printThermalReceipt({
        gymName,
        invoiceId: r.id,
        memberName: r.member_name || r.member_id,
        memberPhone: r.member_phone || r.memberPhone || '',
        amount: r.amount,
        paymentDate: r.payment_date,
        paymentMethod: r.payment_method,
        expiryDate: r.expiry_date,
        receivedBy: r.received_by || r.receivedBy || '',
        reason: parseReason(r.notes || ''),
        notes: cleanNotes || undefined,
      });

      setShowReceipts(false);
      navigate(`/members/${form.member_id}`);
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
        const returnUrl = searchParams.get('returnUrl');
        navigate(returnUrl || `/members/${form.member_id}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel payment');
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <h1 className="page-title">Log Payment</h1>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Member Selection */}
        <div className="form-group">
          <label className="form-label">Member *</label>
          {selectedMember ? (
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{selectedMember.name}</div>
                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{selectedMember.phone}</div>
              </div>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => { set('member_id', ''); setSelectedMember(null); }}>Change</button>
            </div>
          ) : (
            <>
              <input className="form-input" placeholder="Search member by name or phone..." value={search} onChange={e => setSearch(e.target.value)} />
              {loadingMembers && <div style={{ fontSize: 11, padding: 4 }}>Searching...</div>}
              {search && members.length > 0 && (
                <div className="card" style={{ maxHeight: 200, overflowY: 'auto', marginTop: 'var(--space-sm)' }}>
                  {members.map(m => (
                    <div key={m.id} style={{ padding: '10px var(--space-md)', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                      onClick={() => { set('member_id', m.id); setSelectedMember(m); setSearch(''); }}>
                      <div style={{ fontWeight: 500 }}>{m.name}</div>
                      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{m.phone}</div>
                    </div>
                  ))}
                </div>
              )}
              {search && !loadingMembers && members.length === 0 && search.trim().length > 0 && (
                <div style={{ fontSize: 11, padding: 4 }}>No member found.</div>
              )}
            </>
          )}
        </div>

        {/* Payment / Trial toggle */}
        <div className="form-group">
          <label className="form-label">Type</label>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button type="button" className={`btn ${!form.is_trial ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => set('is_trial', false)}>Payment</button>
            <button type="button" className={`btn ${form.is_trial ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => set('is_trial', true)}>Free Trial</button>
          </div>
        </div>

        {form.is_trial ? (
          <div className="form-group">
            <label className="form-label">Trial Days</label>
            <input className="form-input" type="text" inputMode="numeric" value={form.trial_days || ''} onChange={e => set('trial_days', e.target.value)} placeholder="Number of days" />
          </div>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">Amount (PKR)</label>
              <input className="form-input" type="text" inputMode="numeric" value={form.amount || ''} onChange={e => set('amount', e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">Payment Date</label>
              <input className="form-input" type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">Plan Duration</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 'var(--space-sm)', marginBottom: form.plan_duration_months === 'custom' ? 'var(--space-sm)' : 0 }}>
                {PLAN_DURATIONS.map(d => (
                  <button key={d.value} type="button"
                    className={`btn ${String(form.plan_duration_months) === String(d.value) ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    onClick={() => set('plan_duration_months', d.value)}>
                    {d.label}
                  </button>
                ))}
              </div>
              {form.plan_duration_months === 'custom' && (
                <input 
                  className="form-input" 
                  type="text" inputMode="numeric" 
                  placeholder="Enter number of days" 
                  value={form.custom_days} 
                  onChange={e => set('custom_days', e.target.value)} 
                />
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Payment Method</label>
              <select className="form-select" value={form.payment_method} onChange={e => set('payment_method', e.target.value)}>
                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </>
        )}

        {expiryDate && (
          <div className="expiry-preview">
            <Calendar size={18} className="icon" />
            <div className="text">Membership expires on: <span className="date">{formatDate(expiryDate)}</span></div>
          </div>
        )}

        <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
          <label className="form-label">Received By</label>
          <input className="form-input" placeholder="Staff name (optional)" value={form.received_by} onChange={e => set('received_by', e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" placeholder="Optional notes..." value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

        <button type="submit" className="btn btn-primary btn-block btn-lg" style={{ marginTop: 'var(--space-md)' }} disabled={isSaving}>
          {isSaving ? <Loader2 className="spin" size={18} /> : <><Save size={18} /> Save Payment</>}
        </button>
      </form>

      {showReceipts && (
        <div className="modal-backdrop" onClick={() => { setShowReceipts(false); navigate(searchParams.get('returnUrl') || `/members/${form.member_id}`); }}>
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
                      <div style={{ fontWeight: 800, color: 'var(--status-active)' }}>{formatPKR(r.amount)}</div>
                      <div style={{ fontSize: 12 }}>{(r.payment_date && (String(r.payment_date).includes('T') || new Date(r.payment_date).getHours() || new Date(r.payment_date).getMinutes())) ? formatDateTime(r.payment_date) : formatDate(r.payment_date)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.notes ? (String(r.notes).replace(/payment_type:[^;]+;?/, '').trim() || r.notes) : ''}</div>
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
              <button className="btn btn-primary btn-block" onClick={() => { setShowReceipts(false); navigate(searchParams.get('returnUrl') || `/members/${form.member_id}`); }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
