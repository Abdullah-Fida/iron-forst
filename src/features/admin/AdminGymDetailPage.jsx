import { ShieldCheck, ShieldAlert, Zap, Users, Building2, CreditCard, PieChart, ArrowLeft, MessageSquare, Edit, ExternalLink, Trash2, DollarSign, Plus, Activity } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatPKR, formatDate, calculateHealthScore } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { StateView } from '../../components/common/StateView';
import { ModernLoader } from '../../components/common/ModernLoader';
import '../../styles/admin.css';

export default function AdminGymDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { switchSession } = useAuth();
  
  const [gym, setGym] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState({});
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', type: 'RECURRING', date: new Date().toISOString().split('T')[0] });
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewalForm, setRenewalForm] = useState({ months: '1', customDays: '', amount: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (gym?.default_monthly_fee) {
      setRenewalForm(prev => ({ ...prev, amount: String(gym.default_monthly_fee) }));
    }
  }, [gym]);

  const todayStr = () => new Date().toISOString().split('T')[0];

  useEffect(() => {
    async function fetchDetails() {
      setLoading(true);
      try {
        const [gRes, nRes, pRes] = await Promise.all([
          api.get(`/admin/gyms/${id}`),
          api.get(`/admin/gyms/${id}/notes`),
          api.get(`/admin/gyms/${id}/payments`)
        ]);
        setGym(gRes.data.data);
        setEditData(gRes.data.data);
        setNotes(nRes.data.data);
        setPayments(pRes.data.data);
      } catch (err) {
        toast.error('Gym details unavailable');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchDetails();
  }, [id]);

  const handleProxyLogin = async () => {
    try {
      const res = await api.post(`/admin/gyms/${id}/login`);
      if (res.data.success) {
        await switchSession(res.data);
        toast.success(`Switched to ${gym.gym_name}`);
        // Client-side navigation to maintain background seed process
        navigate('/dashboard'); 
      }
    } catch (err) {
      toast.error('Failed to proxy login');
    }
  };

  const handleUpdateGym = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        gym_name: editData.gym_name,
        owner_name: editData.owner_name,
        phone: editData.phone,
        city: editData.city,
        default_monthly_fee: editData.default_monthly_fee,
        email: editData.email,
        plan_type: editData.plan_type,
        subscription_ends_at: editData.subscription_ends_at
      };
      
      if (editData.extend_duration && editData.extend_duration !== 'none') {
        const now = new Date();
        const currentEnd = gym.subscription_ends_at ? new Date(gym.subscription_ends_at) : now;
        const startBasis = currentEnd > now ? currentEnd : now;
        const newEnd = new Date(startBasis);
        if (editData.extend_duration === 'custom') {
          newEnd.setDate(newEnd.getDate() + Number(editData.extend_days || 0));
        } else {
          newEnd.setMonth(newEnd.getMonth() + Number(editData.extend_duration));
        }
        payload.subscription_ends_at = newEnd.toISOString();
      }

      if (editData.new_password) payload.new_password = editData.new_password;
      
      await api.patch(`/admin/gyms/${id}`, payload);
      
      if (editData.add_payment && Number(editData.add_payment) > 0) {
        await api.post(`/admin/gyms/${id}/payments`, { amount: Number(editData.add_payment) });
        const pRes = await api.get(`/admin/gyms/${id}/payments`);
        setPayments(pRes.data.data);
      }

      toast.success('Settings updated');
      setShowEditModal(false);
      setEditData(prev => ({ ...prev, add_payment: '', extend_duration: 'none', extend_days: '' }));
      const res = await api.get(`/admin/gyms/${id}`);
      setGym(res.data.data);
    } catch (err) {
      toast.error('Update failed');
    }
  };



  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      const res = await api.post(`/admin/gyms/${id}/notes`, { text: newNote.trim() });
      setNotes([res.data.data, ...notes]);
      setNewNote('');
      toast.success('Note pinned');
    } catch (err) {
      toast.error('Failed to pin note');
    }
  };

  const handleLogPayment = async (e) => {
    e.preventDefault();
    try {
      if (editingPaymentId) {
        await api.patch(`/admin/gyms/${id}/payments/${editingPaymentId}`, paymentForm);
        toast.success('Payment updated');
      } else {
        await api.post(`/admin/gyms/${id}/payments`, paymentForm);
        toast.success('Payment recorded');
      }
      const pRes = await api.get(`/admin/gyms/${id}/payments`);
      setPayments(pRes.data.data);
      const gRes = await api.get(`/admin/gyms/${id}`);
      setGym(gRes.data.data);
      setShowPaymentModal(false);
      setPaymentForm({ amount: '', type: 'RECURRING', date: todayStr() });
      setEditingPaymentId(null);
    } catch (err) {
      toast.error('Transaction failed');
    }
  };

  const openEditPayment = (p) => {
    const payload = JSON.parse(p.text);
    setPaymentForm({ amount: payload.amount, type: payload.type || 'RECURRING', date: p.date.split('T')[0] });
    setEditingPaymentId(p.id);
    setShowPaymentModal(true);
  };

  const handleDeletePayment = async (noteId) => {
    if (!window.confirm("Void this transaction?")) return;
    try {
      await api.delete(`/admin/gyms/${id}/payments/${noteId}`);
      setPayments(payments.filter(p => p.id !== noteId));
      const gRes = await api.get(`/admin/gyms/${id}`);
      setGym(gRes.data.data);
      toast.success('Transaction voided.');
    } catch(err) {
      toast.error('Failed to void');
    }
  };

  const handleRenewSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        amount: Number(renewalForm.amount),
        months: renewalForm.months === 'custom' ? 0 : Number(renewalForm.months),
        customDays: renewalForm.months === 'custom' ? Number(renewalForm.customDays) : 0
      };
      await api.post(`/admin/gyms/${id}/renew`, payload);
      toast.success('Subscription renewed!');
      setShowRenewModal(false);
      const [gRes, pRes] = await Promise.all([
        api.get(`/admin/gyms/${id}`),
        api.get(`/admin/gyms/${id}/payments`)
      ]);
      setGym(gRes.data.data);
      setPayments(pRes.data.data);
    } catch (err) {
      toast.error('Renewal failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return (
    <div className="admin-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <ModernLoader type="morph" text="Loading Gym Data..." />
    </div>
  );

  if (!gym) return <div className="admin-container"><p>Gym not found.</p></div>;

  const health = calculateHealthScore(gym);
  const hColor = health <= 30 ? 'var(--status-danger)' : health <= 60 ? 'var(--status-warning)' : 'var(--status-active)';

  const kpis = [
    { label: 'Gym Health', value: `${health}/100`, icon: Activity, color: hColor, sub: health > 70 ? 'Running Well' : 'Needs Help' },
    { label: 'Total Members', value: gym.members?.[0]?.count || 0, icon: Users, color: 'var(--accent-primary)', sub: 'Active in system' },
    { label: 'This Month Rev', value: formatPKR(gym.revenue_this_month || 0), icon: CreditCard, color: 'var(--status-active)', sub: 'Collected by gym' },
    { label: 'Current Plan', value: gym.plan_type.toUpperCase(), icon: Zap, color: '#fbbf24', sub: gym.subscription_ends_at ? `Expires: ${formatDate(gym.subscription_ends_at)}` : 'No Expiry' },
  ];

  return (
    <div className="admin-container">
      {/* ── Header ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{gym.gym_name}</h1>
          <p className="page-subtitle">{gym.city} • {gym.owner_name}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <span className={`badge ${gym.is_active ? 'badge-active' : 'badge-danger'}`} style={{ padding: '8px 16px', fontSize: 'var(--font-sm)', fontWeight: 800 }}>
             {gym.is_active ? 'ACTIVE' : 'SUSPENDED'}
          </span>
        </div>
      </div>

      {/* ── KPI Scoreboard ─── */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-xl)' }}>
        {kpis.map((k, i) => (
          <div key={i} className="stat-card" style={{ '--stat-color': k.color }}>
            <div className="stat-icon" style={{ background: k.color + '15' }}>
              <k.icon size={20} style={{ color: k.color }} />
            </div>
            <div className="stat-value" style={{ color: k.color }}>{k.value}</div>
            <div className="stat-label">{k.label}</div>
            <div className="stat-pct">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Action Bar ─── */}
      <div className="card" style={{ marginBottom: 'var(--space-xl)', padding: 'var(--space-md)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <button className="btn btn-primary btn-sm" onClick={handleProxyLogin}>
          <ExternalLink size={16} style={{ marginRight: 6 }} /> Login to Gym
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowEditModal(true)}>
          <Edit size={16} style={{ marginRight: 6 }} /> Edit Info
        </button>
        {(!gym.is_active || (gym.subscription_ends_at && new Date(gym.subscription_ends_at) < new Date())) && (
          <button className="btn btn-success btn-sm" onClick={() => setShowRenewModal(true)}>
            <DollarSign size={16} style={{ marginRight: 6 }} /> Renew Now
          </button>
        )}
      </div>

      {/* ── Tabs ─── */}
      <div className="filter-tabs" style={{ marginBottom: 'var(--space-md)' }}>
        {[
          { key: 'overview', label: 'Gym Review', icon: PieChart },
          { key: 'payments', label: 'Payments', icon: CreditCard },
          { key: 'notes', label: 'Notes', icon: MessageSquare },
        ].map(t => (
          <button key={t.key} className={`filter-tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
             <t.icon size={14} style={{ marginRight: 6 }} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ─── */}
      <div className="admin-tab-content">
        {activeTab === 'overview' && (
          <div className="gym-stack-layout" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
            
            <div className="admin-section">
              <h3 className="section-title">Performance Review</h3>
              <div className="card">
                {[
                  { label: 'System Active (30%)', score: gym.last_login_at ? Math.max(0, 100 - Math.ceil((new Date() - new Date(gym.last_login_at)) / 86400000)) : 0 },
                  { label: 'New Members (25%)', score: gym.members_added_this_month > 0 ? 100 : 0 },
                  { label: 'Payment Logs (25%)', score: gym.payments_this_month > 0 ? 100 : 0 },
                  { label: 'Profile Info (20%)', score: [gym.gym_name, gym.phone, gym.address, gym.default_monthly_fee].filter(Boolean).length / 4 * 100 },
                ].map((item, i) => (
                  <div key={i} style={{ padding: '16px 0', borderBottom: i < 3 ? '1px solid var(--border-color)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: item.score >= 60 ? 'var(--status-active)' : item.score >= 30 ? 'var(--status-warning)' : 'var(--status-danger)' }}>{Math.round(item.score)}%</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 10 }}>
                      <div style={{ height: '100%', width: `${Math.min(100, item.score)}%`, background: item.score >= 60 ? 'var(--status-active)' : item.score >= 30 ? 'var(--status-warning)' : 'var(--status-danger)', borderRadius: 10, transition: 'width 0.5s' }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="admin-section">
              <h3 className="section-title">Gym Information</h3>
              <div className="gym-detail-grid">
                {[
                  { label: 'Email Address', value: gym.email || 'N/A' },
                  { label: 'Contact Phone', value: gym.phone },
                  { label: 'Active Members', value: gym.members?.[0]?.count || 0 },
                  { label: 'Active Staff', value: gym.staff?.[0]?.count || 0 },
                  { label: 'Revenue (Month)', value: formatPKR(gym.revenue_this_month || 0) },
                  { label: 'Expiry Date', value: gym.subscription_ends_at ? formatDate(gym.subscription_ends_at) : 'N/A' },
                ].map((d, i) => (
                  <div key={i} className="gym-detail-card">
                    <div className="label">{d.label}</div>
                    <div className="value" style={{ fontSize: 14 }}>{d.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="admin-section">
              <h3 className="section-title">Registration Details</h3>
              <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-md)' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Joined On</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{formatDate(gym.created_at)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Last Login</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{formatDate(gym.last_login_at)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current Plan</div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--accent-primary)' }}>{gym.plan_type.toUpperCase()}</div>
                </div>
              </div>
            </div>

          </div>
        )}

        {activeTab === 'payments' && (
          <div className="admin-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
              <h3 className="section-title">Payment History</h3>
              <button className="btn btn-sm btn-primary" onClick={() => { setEditingPaymentId(null); setPaymentForm({ amount: '', type: 'RECURRING', date: todayStr() }); setShowPaymentModal(true); }}>
                <Plus size={14} style={{ marginRight: 4 }} /> Add New Payment
              </button>
            </div>
            {(!payments || payments.length === 0) ? (
              <StateView type="empty" title="No Payments Yet" description="No setup fees or subscription payments found for this gym." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                {payments.map(p => {
                  let payload = { amount: 0, type: 'RECURRING' };
                  try { payload = JSON.parse(p.text); } catch(e) {}
                  return (
                    <div key={p.id} className="payment-card" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                      <div className="pay-icon" style={{ background: payload.type === 'SETUP' ? '#fef3c7' : '#dcfce7', color: payload.type === 'SETUP' ? '#92400e' : '#166534' }}>
                         {payload.type === 'SETUP' ? <Building2 size={18} /> : <CreditCard size={18} />}
                      </div>
                      <div className="pay-details">
                        <h4 style={{ fontSize: 15 }}>{payload.type === 'SETUP' ? 'Setup Fee' : 'Monthly Fee'}</h4>
                        <p style={{ fontSize: 11 }}>{formatDate(p.date)}</p>
                      </div>
                      <div className="pay-right">
                        <div className="amount" style={{ color: 'var(--status-active)', fontWeight: 800 }}>{formatPKR(payload.amount)}</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <button className="btn btn-icon btn-sm" onClick={() => openEditPayment(p)} title="Edit"><Edit size={14} /></button>
                          <button className="btn btn-icon btn-sm" onClick={() => handleDeletePayment(p.id)} style={{ color: 'var(--status-danger)' }} title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="admin-section">
            <h3 className="section-title">Notes & Support Log</h3>
            <div className="card" style={{ marginBottom: 'var(--space-lg)', background: 'var(--bg-secondary)' }}>
              <textarea className="form-textarea" style={{ minHeight: 80, border: 'none', background: 'transparent' }} placeholder="Add a new note about this gym..." value={newNote} onChange={e => setNewNote(e.target.value)} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 0', borderTop: '1px solid var(--border-color)' }}>
                <button className="btn btn-primary btn-sm" onClick={handleAddNote}>Save Note</button>
              </div>
            </div>
            <div className="notes-list">
              {notes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No notes found.</div>
              ) : (
                notes.map(n => (
                  <div key={n.id} className="note-card" style={{ background: 'var(--bg-secondary)', borderLeft: '4px solid var(--accent-primary)' }}>
                    <div className="note-header" style={{ marginBottom: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: 11 }}>{n.admin?.toUpperCase()}</span>
                      <span style={{ fontSize: 11 }}>{formatDate(n.date)}</span>
                    </div>
                    <div className="note-text" style={{ fontSize: 14 }}>{n.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Modals (Keep Existing Logic) ─── */}
      {showEditModal && (
        <div className="modal-backdrop" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 'var(--space-md)' }}>Update Gym Records</h2>
            <form onSubmit={handleUpdateGym}>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Gym Name</label>
                  <input required className="form-input" value={editData.gym_name} onChange={e => setEditData({...editData, gym_name: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Owner Name</label>
                  <input required className="form-input" value={editData.owner_name} onChange={e => setEditData({...editData, owner_name: e.target.value})} />
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input required className="form-input" value={editData.phone} onChange={e => setEditData({...editData, phone: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email (ID)</label>
                  <input required type="email" className="form-input" value={editData.email} onChange={e => setEditData({...editData, email: e.target.value})} />
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">City</label>
                  <input required className="form-input" value={editData.city} onChange={e => setEditData({...editData, city: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Plan Type</label>
                  <select className="form-select" value={editData.plan_type} onChange={e => setEditData({...editData, plan_type: e.target.value})}>
                    <option value="free">FREE</option>
                    <option value="basic">BASIC</option>
                    <option value="pro">PRO</option>
                  </select>
                </div>
              </div>
              <div className="divider"></div>
              <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>SECURITY SECURITY SECURITY</p>
              <div className="form-group">
                <label className="form-label">Reset Password</label>
                <input className="form-input" type="text" placeholder="Type new password..." value={editData.new_password || ''} onChange={e => setEditData({...editData, new_password: e.target.value})} />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
                <button type="button" className="btn btn-secondary btn-block" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-block">Commit Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="modal-backdrop" onClick={() => setShowPaymentModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 'var(--space-md)' }}>{editingPaymentId ? 'Edit Ledger' : 'New Ledger Entry'}</h2>
            <form onSubmit={handleLogPayment}>
              <div className="form-group">
                <label className="form-label">Amount (PKR)*</label>
                <input required type="text" inputMode="numeric" className="form-input" value={paymentForm.amount} onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-select" value={paymentForm.type} onChange={e => setPaymentForm({...paymentForm, type: e.target.value})}>
                  <option value="RECURRING">Subscription Income</option>
                  <option value="SETUP">One-time Setup Cost</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
                <button type="button" className="btn btn-secondary btn-block" onClick={() => setShowPaymentModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-block">Confirm</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRenewModal && (
        <div className="modal-backdrop" onClick={() => setShowRenewModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 'var(--space-md)' }}>Renew Gym Access</h2>
            <form onSubmit={handleRenewSubmit}>
              <div className="form-group">
                <label className="form-label">Duration</label>
                <select className="form-select" value={renewalForm.months} onChange={e => setRenewalForm({...renewalForm, months: e.target.value})}>
                  <option value="1">1 Month</option>
                  <option value="3">3 Months</option>
                  <option value="6">6 Months</option>
                  <option value="12">1 Year</option>
                  <option value="custom">Custom Days</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Actual Amount Collected (PKR)</label>
                <input required type="text" inputMode="numeric" className="form-input" value={renewalForm.amount} onChange={e => setRenewalForm({...renewalForm, amount: e.target.value})} />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
                <button type="button" className="btn btn-secondary btn-block" onClick={() => setShowRenewModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>Confirm Renewal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
