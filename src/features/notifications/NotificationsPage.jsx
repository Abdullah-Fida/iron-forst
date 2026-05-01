import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Check, Bell, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { formatDate, getWhatsAppLink, getInitials, daysFromNow, calculateMemberStatus } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import { ModernLoader } from '../../components/common/ModernLoader';
import '../../styles/members.css';

export default function NotificationsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('pending');
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // WhatsApp edit state
  const [editNotif, setEditNotif] = useState(null);
  const [editMessage, setEditMessage] = useState('');

  const fetchNotifications = async () => {
    setLoading(true);
    let allNotifs = [];

    try {
      // Fetch members from API to generate local notifications
      const membersRes = await api.get('/members');
      const localMembers = membersRes.data.data || [];
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      localMembers.forEach(m => {
        const mStatus = calculateMemberStatus(m);
        if (mStatus === 'inactive' || mStatus === 'deleted') return;
        
        let actualExpiry = m.latest_expiry;
        if (!actualExpiry && m.payments && m.payments.length > 0) {
          const sorted = [...m.payments].sort((a,b) => new Date(b.expiry_date || b.payment_date) - new Date(a.expiry_date || a.payment_date));
          actualExpiry = sorted[0].expiry_date || sorted[0].payment_date;
        }
        
        if (!actualExpiry) return;

        const expiryDate = new Date(actualExpiry);
        const daysLeft = daysFromNow(actualExpiry);
        
        if (daysLeft < 0) {
          allNotifs.push({
            id: `exp_${m.id}`,
            member_id: m.id,
            notification_type: 'member_fee_expired',
            status: 'pending',
            message_template: `Hi ${m.name}, your gym fee expired on ${formatDate(actualExpiry)}. Kindly pay to continue your membership.`,
            scheduled_for: todayStr,
            members: m
          });
        } else if (daysLeft >= 0 && daysLeft <= 3) {
          allNotifs.push({
            id: `warn_${m.id}`,
            member_id: m.id,
            notification_type: 'member_fee_expiry_warning',
            status: 'pending',
            message_template: `Hi ${m.name}, your gym fee will expire on ${formatDate(actualExpiry)}. Kindly prepare to renew!`,
            scheduled_for: todayStr,
            members: m
          });
        }
      });

      // Also fetch staff/system notifications from server
      try {
        const res = await api.get('/notifications', { params: { status: filter === 'all' ? undefined : filter } });
        const apiNotifs = res.data.data || [];
        const staffNotifs = apiNotifs.filter(n => n.notification_type && !n.notification_type.includes('member'));
        allNotifs = [...allNotifs, ...staffNotifs];
      } catch (err) {
        console.error('Failed to fetch api notifications', err);
      }
    } catch (err) {
      console.error('Failed to fetch members for notifications', err);
    }

    const filtered = filter === 'all' ? allNotifs : allNotifs.filter(n => n.status === filter);
    setNotifications(filtered);
    setLoading(false);
  };

  useEffect(() => {
    fetchNotifications();
  }, [filter]);

  const pendingCount = notifications.filter(n => n.status === 'pending').length;

  const handleSend = async () => {
    if (!editNotif) return;
    const link = getWhatsAppLink(editNotif.members?.phone || '', editMessage);
    window.open(link, '_blank');
    
    try {
      if (!editNotif.id.toString().startsWith('offline')) {
        await api.patch(`/notifications/${editNotif.id}/sent`);
      }
      toast.success('WhatsApp opened!');
      setEditNotif(null);
      setEditMessage('');
      fetchNotifications();
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  const getTypeInfo = (type) => {
    switch (type) {
      case 'member_fee_expiry_warning':
        return { label: '⚠️ Fee Warning', color: 'var(--status-warning)', bg: 'var(--status-warning-bg)' };
      case 'member_fee_expired':
        return { label: '🔴 Fee Expired', color: 'var(--status-danger)', bg: 'var(--status-danger-bg)' };
      case 'staff_salary_due':
        return { label: '💰 Salary Due', color: 'var(--accent-primary)', bg: 'var(--accent-light)' };
      default:
        return { label: '📢 Alert', color: 'var(--text-muted)', bg: 'var(--bg-secondary)' };
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Alerts</h1>
        <p className="page-subtitle">
          <Bell size={14} style={{ display: 'inline', verticalAlign: -2 }} /> {pendingCount} pending
        </p>
      </div>

      <div className="filter-tabs">
        {[
          { key: 'pending', label: `Pending (${pendingCount})` },
          { key: 'sent', label: 'Sent' },
          { key: 'all', label: 'All' }
        ].map(f => (
          <button key={f.key} className={`filter-tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '60px 0' }}>
          <ModernLoader type="bar" text="Syncing Alerts..." />
        </div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">
          <Bell />
          <h3>No alerts</h3>
          <p>
            {filter === 'pending'
              ? "All clear! Alerts appear when fee is 3 days from expiry or expired."
              : 'No notifications found.'}
          </p>
        </div>
      ) : (
        notifications.map(notif => {
          const m = notif.members;
          const typeInfo = getTypeInfo(notif.notification_type);
          
          return (
            <div 
              key={notif.id} 
              className="notif-card clickable" 
              style={{ borderLeft: `4px solid ${typeInfo.color}` }}
              onClick={(e) => {
                if (m && !editNotif) navigate(`/payments/add?member=${notif.member_id}&returnUrl=/notifications`);
              }}
              title="Click to log payment"
            >
              <div className="notif-top">
                <div className="notif-avatar" style={{ background: typeInfo.bg, color: typeInfo.color }}>
                  {notif.status === 'sent' ? <Check size={16} /> : m ? getInitials(m.name) : '!'}
                </div>
                <div className="notif-meta">
                  <span className="notif-type-label" style={{ color: typeInfo.color }}>{typeInfo.label}</span>
                  {m && <div className="notif-member-name">{m.name}</div>}
                  <div className="notif-date" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formatDate(notif.scheduled_for)}</div>
                </div>
              </div>
              <div className="notif-message">{notif.message_template}</div>
              {notif.status === 'pending' && (
                <button 
                  className="btn btn-whatsapp btn-sm notif-send-btn" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditNotif(notif);
                    setEditMessage(notif.message_template);
                  }}
                >
                  <Send size={14} /> Send WhatsApp
                </button>
              )}
              {notif.status === 'sent' && (
                <div className="notif-sent-label">✓ Sent on {formatDate(notif.sent_at)}</div>
              )}
            </div>
          );
        })
      )}

      {/* WhatsApp Edit Modal */}
      {editNotif && (
        <div className="modal-backdrop" onClick={() => setEditNotif(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 'var(--space-md)' }}>Edit Message</h2>
            <div className="form-group">
              <label className="form-label">WhatsApp Message Template</label>
              <textarea 
                className="form-textarea" 
                style={{ minHeight: 120 }}
                value={editMessage}
                onChange={e => setEditMessage(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
              <button className="btn btn-secondary btn-block" onClick={() => setEditNotif(null)}>Cancel</button>
              <button className="btn btn-whatsapp btn-block" onClick={handleSend}><Send size={16} /> Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


