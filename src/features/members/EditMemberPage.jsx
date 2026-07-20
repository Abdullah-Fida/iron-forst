import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useFormDraft } from '../../hooks/useFormDraft';
import '../../styles/members.css';

export default function EditMemberPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const { saveDraft, clearDraft } = useFormDraft(`edit-member-${id}`, {}, (draft) => {
    if (draft.form) setForm(prev => ({ ...prev, ...(draft.form || {}) }));
  });

  useEffect(() => {
    if (form) saveDraft({ form });
  }, [form, saveDraft, id]);

  useEffect(() => {
    const fetchMember = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/members/${id}`);
        const m = res.data.data;
        if (m) {
          setForm(prev => {
             if (prev) return prev;
             return { 
               name: m.name, 
               membership_id: m.membership_id || '',
               phone: m.phone, 
               gender: m.gender || 'male',
               join_date: m.join_date, 
               emergency_contact: m.emergency_contact || '', 
               notes: m.notes || '',
               status: m.status || ''
             };
          });
        } else {
          toast.error('Member not found');
        }
      } catch (err) {
        console.error('Failed to fetch member', err);
        toast.error('Member not found');
      } finally {
        setLoading(false);
      }
    };
    fetchMember();
  }, [id]);

  if (loading) return (
    <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <Loader2 className="spin" size={48} style={{ color: 'var(--primary)' }} />
    </div>
  );

  if (!form) return <div className="page-container"><p>Member not found</p></div>;

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.phone) { toast.error('Name and phone are required'); return; }
    if (!form.status) { toast.error('Membership status is required'); return; }
    
    setIsSaving(true);
    try {
      const updatedData = { ...form };
      await api.put(`/members/${id}`, updatedData);
      toast.success('Member updated!');
      clearDraft();
      navigate(`/members/${id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update member');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <h1 className="page-title">Edit Member</h1>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="form-group"><label className="form-label">Full Name *</label><input className="form-input" value={form.name || ''} onChange={e => set('name', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Membership ID</label><input className="form-input" value={form.membership_id || ''} onChange={e => set('membership_id', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Phone Number *</label><input className="form-input" value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
        <div className="form-group">
          <label className="form-label">Gender</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
            <button type="button" className={`btn ${form.gender === 'male' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => set('gender', 'male')}>Male 👨</button>
            <button type="button" className={`btn ${form.gender === 'female' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => set('gender', 'female')}>Female 👩</button>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Membership Status *</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
            <button type="button" className={`btn ${form.status === 'active' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => set('status', 'active')}>Active ✅</button>
            <button type="button" className={`btn ${form.status === 'inactive' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => set('status', 'inactive')}>Inactive ❌</button>
          </div>
        </div>
        <div className="form-group"><label className="form-label">Join Date</label><input className="form-input" type="date" value={form.join_date || ''} onChange={e => set('join_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Emergency Contact</label><input className="form-input" value={form.emergency_contact || ''} onChange={e => set('emergency_contact', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={isSaving}>
          {isSaving ? <Loader2 className="spin" size={18} /> : <><Save size={18} /> Update Member</>}
        </button>
      </form>
    </div>
  );
}
