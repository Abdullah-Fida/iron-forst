import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { STAFF_ROLES } from '../../lib/constants';
import { useToast } from '../../contexts/ToastContext';
import { useFormDraft } from '../../hooks/useFormDraft';
import '../../styles/members.css';

export default function EditStaffPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const { saveDraft, clearDraft } = useFormDraft(`edit-staff-${id}`, {}, (draft) => {
    if (draft.form) setForm(prev => ({ ...prev, ...(draft.form || {}) }));
  });

  useEffect(() => {
    if (form) saveDraft({ form });
  }, [form, saveDraft, id]);

  useEffect(() => {
    const fetchStaff = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/staff/${id}`);
        const s = res.data.data;
        if (s) {
          setForm(prev => {
            if (prev && prev.name) return prev;
            return { 
              name: s.name, 
              phone: s.phone, 
              role: s.role, 
              custom_role: s.custom_role || '', 
              join_date: s.join_date, 
              monthly_salary: String(s.monthly_salary), 
              status: s.status, 
              notes: s.notes || '' 
            };
          });
        }
      } catch (err) {
        console.error('Failed to fetch staff member', err);
        toast.error('Staff member not found');
      } finally {
        setLoading(false);
      }
    };
    fetchStaff();
  }, [id]);

  if (loading) return (
    <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <Loader2 className="spin" size={48} style={{ color: 'var(--primary)' }} />
    </div>
  );

  if (!form) return <div className="page-container"><p>Staff not found</p></div>;

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const updatedForm = { ...form, monthly_salary: Number(form.monthly_salary) };
      await api.put(`/staff/${id}`, updatedForm);
      toast.success('Staff updated!');
      clearDraft();
      navigate(`/staff/${id}`);
    } catch (err) {
      toast.error('Failed to update staff member');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <h1 className="page-title">Edit Staff</h1>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="form-group"><label className="form-label">Full Name</label><input className="form-input" value={form.name || ''} onChange={e => set('name', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Role</label><select className="form-select" value={form.role || 'trainer'} onChange={e => set('role', e.target.value)}>{STAFF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
        {form.role === 'other' && <div className="form-group"><label className="form-label">Custom Role</label><input className="form-input" value={form.custom_role || ''} onChange={e => set('custom_role', e.target.value)} /></div>}
        <div className="form-group"><label className="form-label">Monthly Salary (PKR)</label><input className="form-input" type="text" inputMode="numeric" value={form.monthly_salary || ''} onChange={e => set('monthly_salary', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Status</label><select className="form-select" value={form.status || 'active'} onChange={e => set('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="terminated">Terminated</option></select></div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button type="submit" className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={isSaving}>
            {isSaving ? <Loader2 className="spin" size={18} /> : <><Save size={18} /> Update</>}
          </button>
          <button 
            type="button" 
            className="btn btn-danger btn-lg" 
            onClick={async () => {
              if (window.confirm('Are you sure you want to delete this staff member?')) {
                try {
                  await api.delete(`/staff/${id}`);
                  toast.success('Staff removed');
                  navigate('/staff');
                } catch (err) {
                  toast.error('Failed to delete staff');
                }
              }
            }}
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}
