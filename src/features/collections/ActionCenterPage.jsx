import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Send, CreditCard, MessageCircle, Clock, Bell, CheckCircle2, Loader2, DollarSign } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getInitials, daysFromNow, formatDate, formatPKR, getWhatsAppLink, calculateMemberStatus } from '../../lib/utils';
import '../../styles/payments.css';

export default function ActionCenterPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [members, setMembers] = useState([]);
  const [staffAlerts, setStaffAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  // WhatsApp edit state for Staff Alerts
  const [editNotif, setEditNotif] = useState(null);
  const [editMessage, setEditMessage] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch pending fees (Members)
      const pendingRes = await api.get('/payments/pending');
      const rawMembers = pendingRes.data.data || [];
      const pendingMembers = rawMembers.map(m => {
        let lastPayment = null;
        if (m.payments && m.payments.length > 0) {
          const sorted = [...m.payments].sort((a,b) => new Date(b.payment_date) - new Date(a.payment_date));
          lastPayment = sorted[0];
        }
        const status = calculateMemberStatus(m);
        return { ...m, status, lastPayment, itemType: 'member' };
      });
      setMembers(pendingMembers);

      // 2. Fetch system/staff notifications
      const notifRes = await api.get('/notifications', { params: { status: 'pending' } });
      const apiNotifs = notifRes.data.data || [];
      const staffOnly = apiNotifs.filter(n => n.notification_type && !n.notification_type.includes('member')).map(n => ({ ...n, itemType: 'alert' }));
      setStaffAlerts(staffOnly);

    } catch (err) {
      console.error('Failed to fetch action center data', err);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const stats = useMemo(() => {
    const overdue = members.filter(m => m.status === 'expired');
    const dueSoon = members.filter(m => m.status === 'due_soon');
    
    // Calculate total overdue amount (assuming default fee if lastPayment isn't available, or just using their gym's default fee if available)
    // Actually, for simplicity and accuracy, let's just count them.
    return {
      total: members.length + staffAlerts.length,
      overdue: overdue.length,
      dueSoon: dueSoon.length,
      alerts: staffAlerts.length
    };
  }, [members, staffAlerts]);

  const displayedItems = useMemo(() => {
    let items = [];
    if (filter === 'all' || filter === 'overdue') {
      items = [...items, ...members.filter(m => filter === 'overdue' ? m.status === 'expired' : true)];
    }
    if (filter === 'due_soon') {
      items = [...items, ...members.filter(m => m.status === 'due_soon')];
    }
    if (filter === 'all' || filter === 'alerts') {
      items = [...items, ...staffAlerts];
    }
    
    // Sort logic could go here
    return items;
  }, [members, staffAlerts, filter]);

  const handleMemberRemind = (member) => {
    const msg = `Hello ${member.name}, this is a reminder from ${user.name} regarding your gym membership renewal.`;
    window.open(getWhatsAppLink(member.phone, msg), '_blank');
  };

  const handleAlertSend = async () => {
    if (!editNotif) return;
    const link = getWhatsAppLink(editNotif.recipient_phone || '', editMessage);
    window.open(link, '_blank');
    
    try {
      await api.patch(`/notifications/${editNotif.id}/sent`);
      toast.success('Alert marked as sent!');
      setEditNotif(null);
      setEditMessage('');
      fetchData();
      window.dispatchEvent(new Event('action-center-updated'));
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px', marginBottom: 'var(--space-xl)' }}>
        <div>
          <h1 className="page-title">Action <span>Center</span></h1>
          <p className="page-subtitle">Manage collections, overdue fees, and alerts</p>
        </div>
        
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ padding: '8px 16px', borderRadius: '12px', background: 'var(--status-danger-bg)', border: '1px solid var(--status-danger)', color: 'var(--status-danger)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '14px' }}>
            <AlertTriangle size={16} /> {stats.overdue} Overdue
          </div>
          <div style={{ padding: '8px 16px', borderRadius: '12px', background: 'var(--status-warning-bg)', border: '1px solid var(--status-warning)', color: 'var(--status-warning)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '14px' }}>
            <Clock size={16} /> {stats.dueSoon} Due Soon
          </div>
          <div style={{ padding: '8px 16px', borderRadius: '12px', background: 'var(--accent-light)', border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '14px' }}>
            <Bell size={16} /> {stats.alerts} Staff Alerts
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="filter-tabs" style={{ marginBottom: 'var(--space-xl)' }}>
        <button className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All Actions ({stats.total})
        </button>
        <button className={`filter-tab ${filter === 'overdue' ? 'active' : ''}`} onClick={() => setFilter('overdue')}>
          Collect Fee ({stats.overdue})
        </button>
        <button className={`filter-tab ${filter === 'due_soon' ? 'active' : ''}`} onClick={() => setFilter('due_soon')}>
          Due Soon ({stats.dueSoon})
        </button>
        <button className={`filter-tab ${filter === 'alerts' ? 'active' : ''}`} onClick={() => setFilter('alerts')}>
          Staff & Alerts ({stats.alerts})
        </button>
      </div>

      {/* ── Action Grid ── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 0', color: 'var(--text-muted)' }}>
          <Loader2 className="spin" size={48} style={{ color: 'var(--accent-primary)', marginBottom: '16px' }} />
          <p style={{ fontWeight: '600' }}>Loading action items...</p>
        </div>
      ) : displayedItems.length === 0 ? (
        <div className="empty-state" style={{ background: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)', padding: '60px 20px' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--status-active-bg)', color: 'var(--status-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <CheckCircle2 size={40} />
          </div>
          <h3>All Caught Up!</h3>
          <p>No pending collections or alerts at this time.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {displayedItems.map(item => {
            
            // Render Member Card
            if (item.itemType === 'member') {
              const days = item.latest_expiry ? daysFromNow(item.latest_expiry) : null;
              const isExpired = item.status === 'expired' || (days !== null && days < 0);
              const color = isExpired ? 'var(--status-danger)' : 'var(--status-warning)';
              const bg = isExpired ? 'var(--status-danger-bg)' : 'var(--status-warning-bg)';

              return (
                <div key={`m_${item.id}`} className="card card-clickable" style={{ padding: '20px', borderLeft: `4px solid ${color}`, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div className="avatar" style={{ background: bg, color: color, width: '48px', height: '48px', borderRadius: '14px' }}>
                      {getInitials(item.name)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: 'var(--text-primary)' }}>{item.name}</h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color, fontWeight: '700' }}>
                        {isExpired ? <AlertTriangle size={14} /> : <Clock size={14} />}
                        {days === null ? 'No payment record' : isExpired ? `${Math.abs(days)} days overdue` : `Expires in ${days} days`}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {item.phone || 'No phone number'}
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {item.lastPayment ? (
                      <>Last Payment: <strong>{formatPKR(item.lastPayment.amount)}</strong> on {formatDate(item.lastPayment.payment_date)}</>
                    ) : 'No previous payments logged.'}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: 'auto' }}>
                    <button className="btn btn-success" style={{ flex: 1, gap: '6px' }} onClick={() => navigate(`/payments/add?member=${item.id}&returnUrl=/action-center`)}>
                      <CreditCard size={16} /> Collect
                    </button>
                  </div>
                </div>
              );
            }

            // Render Alert Card
            if (item.itemType === 'alert') {
              const isSalary = item.notification_type === 'staff_salary_due';
              const color = isSalary ? 'var(--accent-primary)' : 'var(--text-primary)';
              const bg = isSalary ? 'var(--accent-light)' : 'var(--bg-tertiary)';

              return (
                <div key={`a_${item.id}`} className="card card-clickable" style={{ padding: '20px', borderLeft: `4px solid ${color}`, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div className="avatar" style={{ background: bg, color: color, width: '48px', height: '48px', borderRadius: '14px' }}>
                      <Bell size={20} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: 'var(--text-primary)' }}>
                        {isSalary ? 'Salary Due' : 'System Alert'}
                      </h4>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Scheduled: {formatDate(item.scheduled_for)}
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '10px', marginBottom: '16px', fontSize: '14px', color: 'var(--text-primary)' }}>
                    {item.message_template}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: 'auto' }}>
                    <button 
                      className="btn btn-whatsapp" 
                      style={{ flex: 1 }} 
                      onClick={() => {
                        setEditNotif(item);
                        setEditMessage(item.message_template);
                      }}
                    >
                      <Send size={16} /> Contact
                    </button>
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}

      {/* ── WhatsApp Edit Modal for Staff Alerts ── */}
      {editNotif && (
        <div className="modal-backdrop" onClick={() => setEditNotif(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Send Alert</h2>
              <button className="modal-close" onClick={() => setEditNotif(null)}><AlertTriangle size={20} style={{ opacity: 0 }} /></button>
            </div>
            <div className="form-group">
              <label className="form-label">WhatsApp Message</label>
              <textarea 
                className="form-textarea" 
                style={{ minHeight: '120px' }}
                value={editMessage}
                onChange={e => setEditMessage(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditNotif(null)}>Cancel</button>
              <button className="btn btn-whatsapp" style={{ flex: 2 }} onClick={handleAlertSend}><Send size={16} /> Send WhatsApp</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
