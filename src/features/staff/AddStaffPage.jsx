import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { generateId } from '../../lib/utils';
import { todayStr } from '../../lib/utils';
import { STAFF_ROLES } from '../../lib/constants';
import { useToast } from '../../contexts/ToastContext';
import { useFormDraft } from '../../hooks/useFormDraft';

export default function AddStaffPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', phone: '', role: 'trainer', custom_role: '', join_date: todayStr(), monthly_salary: '', status: 'active', notes: '' });
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const { saveDraft, clearDraft } = useFormDraft('add-staff', {}, (draft) => {
    if (draft.form) setForm(draft.form);
  });

  useEffect(() => {
    saveDraft({ form });
  }, [form, saveDraft]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.phone) { toast.error('Name and phone required'); return; }
    
    setLoading(true);
    try {
      const payload = { 
        id: generateId(),
        ...form, 
        monthly_salary: Number(form.monthly_salary) || 0 
      };
      await api.post('/staff', payload);
      toast.success(`${form.name} added to staff!`);
      clearDraft();
      navigate('/staff');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add staff');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <h1 className="page-title">Add Staff</h1>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="form-group"><label className="form-label">Full Name *</label><input className="form-input" placeholder="Staff member name" value={form.name || ''} onChange={e => set('name', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Phone Number *</label><input className="form-input" placeholder="03001234567" value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Role</label><select className="form-select" value={form.role || 'trainer'} onChange={e => set('role', e.target.value)}>{STAFF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
        {form.role === 'other' && <div className="form-group"><label className="form-label">Custom Role</label><input className="form-input" value={form.custom_role || ''} onChange={e => set('custom_role', e.target.value)} /></div>}
        <div className="form-group"><label className="form-label">Join Date</label><input className="form-input" type="date" value={form.join_date || ''} onChange={e => set('join_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Monthly Salary (PKR)</label><input className="form-input" type="text" inputMode="numeric" placeholder="25000" value={form.monthly_salary || ''} onChange={e => set('monthly_salary', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" placeholder="Optional notes..." value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <><Save size={18} /> Save Staff</>}
        </button>
      </form>
    </div>
  );
}
