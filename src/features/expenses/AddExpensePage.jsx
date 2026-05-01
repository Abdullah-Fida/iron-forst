import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { todayStr, generateId } from '../../lib/utils';
import { EXPENSE_CATEGORIES } from '../../lib/constants';
import { useToast } from '../../contexts/ToastContext';
import { useFormDraft } from '../../hooks/useFormDraft';

export default function AddExpensePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ category: 'equipment_repair', custom_category: '', amount: '', expense_date: todayStr(), description: '', is_recurring: false, recurrence_day: 1, logged_by: '' });
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const { saveDraft, clearDraft } = useFormDraft('add-expense', {}, (draft) => {
    if (draft.form) setForm(draft.form);
  });

  useEffect(() => {
    saveDraft({ form });
  }, [form, saveDraft]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount) { toast.error('Enter amount'); return; }
    
    setLoading(true);
    try {
      const expenseData = { 
        ...form, 
        id: generateId(),
        amount: Number(form.amount), 
        recurrence_day: form.is_recurring ? Number(form.recurrence_day) : null,
      };

      await api.post('/expenses', expenseData);

      toast.success('Expense added!');
      clearDraft();
      navigate('/expenses');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add expense');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <h1 className="page-title">Add Expense</h1>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-select" value={form.category || 'equipment_repair'} onChange={e => set('category', e.target.value)}>
            {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
        </div>
        {form.category === 'custom' && (
          <div className="form-group"><label className="form-label">Custom Category</label><input className="form-input" placeholder="Category name" value={form.custom_category || ''} onChange={e => set('custom_category', e.target.value)} /></div>
        )}
        <div className="form-group"><label className="form-label">Amount (PKR) *</label><input className="form-input" type="text" inputMode="numeric" placeholder="0" value={form.amount || ''} onChange={e => set('amount', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={form.expense_date || ''} onChange={e => set('expense_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" placeholder="What was this expense for?" value={form.description || ''} onChange={e => set('description', e.target.value)} /></div>
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="form-label" style={{ marginBottom: 0 }}>Is Recurring?</label>
          <label className="form-toggle"><input type="checkbox" checked={form.is_recurring || false} onChange={e => set('is_recurring', e.target.checked)} /><span className="slider"></span></label>
        </div>
        {form.is_recurring && (
          <div className="form-group"><label className="form-label">Recurring Day of Month</label><input className="form-input" type="text" inputMode="numeric" min="1" max="31" value={form.recurrence_day ?? ''} onChange={e => set('recurrence_day', e.target.value)} /></div>
        )}
        <div className="form-group"><label className="form-label">Logged By</label><input className="form-input" placeholder="Staff name (optional)" value={form.logged_by || ''} onChange={e => set('logged_by', e.target.value)} /></div>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <><Save size={18} /> Save Expense</>}
        </button>
      </form>
    </div>
  );
}
