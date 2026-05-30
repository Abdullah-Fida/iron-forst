import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Phone, MessageCircle, X, Loader2, CheckCircle2, Clock, MapPin, Activity } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import api from '../../lib/api';
import { getWhatsAppLink } from '../../lib/utils';
import '../../styles/admin.css';

export default function AdminAlertsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState([]);
  const [filter, setFilter] = useState('all');
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewalForm, setRenewalForm] = useState({ gymId: '', gymName: '', months: '1', customDays: '', amount: '3000' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchAlerts();
  }, []);

  async function fetchAlerts() {
    setLoading(true);
    try {
      const res = await api.get('/admin/alerts');
      setAlerts(res.data.data);
    } catch (err) {
      console.error('Failed to fetch admin alerts', err);
      toast.error('Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }

  const visibleAlerts = useMemo(() => {
    let filtered = alerts.filter(a => !dismissed.includes(a.id));
    if (filter !== 'all') {
      filtered = filtered.filter(a => a.type === filter);
    }
    return filtered;
  }, [alerts, dismissed, filter]);

  const stats = useMemo(() => {
    const active = alerts.filter(a => !dismissed.includes(a.id));
    return {
      total: active.length,
      suspended: active.filter(a => a.type === 'suspended_expired').length,
      expiring: active.filter(a => a.type === 'trial_ending').length,
      inactive: active.filter(a => a.type === 'no_login').length,
    };
  }, [alerts, dismissed]);

  const getAlertConfig = (type) => {
    switch (type) {
      case 'trial_ending': return { icon: <Clock size={20} />, color: 'var(--status-warning)', bg: 'var(--status-warning-bg)', title: 'Subscription Ending Soon' };
      case 'no_login': return { icon: <Activity size={20} />, color: 'var(--status-info)', bg: 'var(--status-info-bg)', title: 'No Login (14+ days)' };
      case 'suspended_expired': return { icon: <AlertTriangle size={20} />, color: 'var(--status-danger)', bg: 'var(--status-danger-bg)', title: 'Gym Suspended (Expired)' };
      default: return { icon: <AlertTriangle size={20} />, color: 'var(--text-primary)', bg: 'var(--bg-glass)', title: 'Alert' };
    }
  };

  const handleRenewClick = (gym) => {
    setRenewalForm({ 
      gymId: gym.id, 
      gymName: gym.gym_name, 
      months: '1', 
      customDays: '', 
      amount: '3000' 
    });
    setShowRenewModal(true);
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

      await api.post(`/admin/gyms/${renewalForm.gymId}/renew`, payload);
      
      toast.success(`🎉 ${renewalForm.gymName} Renewed! Access Reactivated.`);
      setShowRenewModal(false);
      fetchAlerts(); // Refresh list
    } catch (err) {
      toast.error('Failed to renew subscription');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-container">
      {/* ── Premium Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px', marginBottom: 'var(--space-xl)' }}>
        <div>
          <h1 className="page-title">Action <span>Center</span></h1>
          <p className="page-subtitle">Manage urgent alerts and gym subscriptions</p>
        </div>
        
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ padding: '8px 16px', borderRadius: '12px', background: 'var(--status-danger-bg)', border: '1px solid var(--status-danger)', color: 'var(--status-danger)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '14px' }}>
            <AlertTriangle size={16} /> {stats.suspended} Suspended
          </div>
          <div style={{ padding: '8px 16px', borderRadius: '12px', background: 'var(--status-warning-bg)', border: '1px solid var(--status-warning)', color: 'var(--status-warning)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '14px' }}>
            <Clock size={16} /> {stats.expiring} Expiring
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="filter-tabs" style={{ marginBottom: 'var(--space-xl)' }}>
        <button className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All Alerts ({stats.total})
        </button>
        <button className={`filter-tab ${filter === 'suspended_expired' ? 'active' : ''}`} onClick={() => setFilter('suspended_expired')}>
          Suspended ({stats.suspended})
        </button>
        <button className={`filter-tab ${filter === 'trial_ending' ? 'active' : ''}`} onClick={() => setFilter('trial_ending')}>
          Expiring Soon ({stats.expiring})
        </button>
        <button className={`filter-tab ${filter === 'no_login' ? 'active' : ''}`} onClick={() => setFilter('no_login')}>
          Inactive ({stats.inactive})
        </button>
      </div>

      {/* ── Alert Grid ── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 0', color: 'var(--text-muted)' }}>
          <Loader2 className="spin" size={48} style={{ color: 'var(--accent-primary)', marginBottom: '16px' }} />
          <p style={{ fontWeight: '600' }}>Scanning for alerts...</p>
        </div>
      ) : visibleAlerts.length === 0 ? (
        <div className="empty-state" style={{ background: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)', padding: '60px 20px' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--status-active-bg)', color: 'var(--status-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <CheckCircle2 size={40} />
          </div>
          <h3>All Clear!</h3>
          <p>No alerts require your attention right now.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
          {visibleAlerts.map(a => {
            const config = getAlertConfig(a.type);
            return (
              <div key={a.id} className="card" style={{ 
                position: 'relative', 
                overflow: 'hidden', 
                display: 'flex', 
                flexDirection: 'column',
                padding: '24px',
                borderTop: `4px solid ${config.color}`,
                boxShadow: 'var(--shadow-sm)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
              }}>
                {/* Dismiss Button */}
                <button 
                  onClick={() => setDismissed(p => [...p, a.id])}
                  style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', borderRadius: '50%', transition: 'all 0.2s' }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                  onMouseOut={e => e.currentTarget.style.background = 'none'}
                >
                  <X size={16} />
                </button>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: config.bg, color: config.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {config.icon}
                  </div>
                  <div style={{ paddingRight: '20px' }}>
                    <h4 style={{ fontSize: '15px', fontWeight: '800', color: config.color, marginBottom: '4px' }}>{config.title}</h4>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>{a.message}</p>
                  </div>
                </div>

                <div style={{ background: 'var(--bg-tertiary)', borderRadius: '12px', padding: '16px', marginBottom: '20px', flex: 1 }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '900', color: 'var(--text-primary)', marginBottom: '4px' }}>{a.gym.gym_name}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    <MapPin size={14} /> {a.gym.city || 'No City'} • {a.gym.owner_name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-primary)', fontWeight: '600' }}>
                    <Phone size={14} style={{ color: 'var(--text-muted)' }} /> {a.gym.phone || 'No Phone'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    className="btn btn-whatsapp" 
                    style={{ flex: 1, padding: '10px' }}
                    onClick={() => window.open(getWhatsAppLink(a.gym.phone, `Hello ${a.gym.owner_name}, regarding your Core Gym account: ${a.message}`), '_blank')}
                  >
                    <MessageCircle size={16} /> Message
                  </button>
                  
                  {(a.type === 'suspended_expired' || a.type === 'trial_ending') && (
                    <button className="btn btn-primary" style={{ padding: '10px 16px' }} onClick={() => handleRenewClick(a.gym)}>
                      Renew
                    </button>
                  )}
                  
                  <button className="btn btn-secondary" style={{ padding: '10px 16px' }} onClick={() => navigate(`/admin/gyms/${a.gym.id}`)}>
                    Detail
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Renew Modal ── */}
      {showRenewModal && (
        <div className="modal-backdrop" onClick={() => setShowRenewModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Renew Gym Access</h2>
              <button className="modal-close" onClick={() => setShowRenewModal(false)}><X size={20} /></button>
            </div>
            
            <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                Reactivating <strong>{renewalForm.gymName}</strong>. This action will log a payment and update their subscription end date.
              </p>
            </div>

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
              
              {renewalForm.months === 'custom' && (
                <div className="form-group">
                  <label className="form-label">Custom Days</label>
                  <input required type="text" inputMode="numeric" className="form-input" placeholder="e.g. 15" value={renewalForm.customDays} onChange={e => setRenewalForm({...renewalForm, customDays: e.target.value})} />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Payment Amount Collected (PKR)*</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: '700' }}>Rs.</span>
                  <input required type="text" inputMode="numeric" className="form-input" style={{ paddingLeft: '48px' }} placeholder="2500" value={renewalForm.amount} onChange={e => setRenewalForm({...renewalForm, amount: e.target.value})} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowRenewModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="spin" size={18} /> Processing...</> : 'Complete Renewal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
