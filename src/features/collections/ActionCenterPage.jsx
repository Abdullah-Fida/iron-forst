import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Send, CreditCard, Clock, Bell, CheckCircle2, Loader2, MessageSquare, QrCode, PowerOff } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getInitials, daysFromNow, formatDate, formatPKR, getWhatsAppLink, calculateMemberStatus, buildWhatsAppMessage } from '../../lib/utils';
import '../../styles/payments.css';

export default function ActionCenterPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [members, setMembers] = useState([]);
  const [staffAlerts, setStaffAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  // WhatsApp Bot State
  const [waStatus, setWaStatus] = useState('DISCONNECTED'); // DISCONNECTED, AUTHENTICATING, QR_READY, CONNECTED
  const [waQrCode, setWaQrCode] = useState(null);
  const [isWaLoading, setIsWaLoading] = useState(false);
  const [isBulkSending, setIsBulkSending] = useState(false);

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

  const fetchWaStatus = async () => {
    try {
      const res = await api.get('/whatsapp/status');
      if (res.data.success) {
        setWaStatus(res.data.data.status);
        setWaQrCode(res.data.data.qrCode);
      }
    } catch (err) {
      console.error('Failed to fetch WA status', err);
    }
  };

  useEffect(() => {
    fetchData();
    fetchWaStatus();
  }, []);

  // Separate stable polling effect — keeps polling every 2s regardless of status
  useEffect(() => {
    const interval = setInterval(() => {
      fetchWaStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const stats = useMemo(() => {
    const overdue = members.filter(m => m.status === 'expired');
    const dueSoon = members.filter(m => m.status === 'due_soon');
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
    return items;
  }, [members, staffAlerts, filter]);

  // --- WhatsApp Actions ---
  const connectWhatsApp = async () => {
    setIsWaLoading(true);
    try {
      await api.post('/whatsapp/start');
      toast.success('Initializing WhatsApp Bot...');
      fetchWaStatus();
    } catch (err) {
      toast.error('Failed to start WhatsApp Bot');
    } finally {
      setIsWaLoading(false);
    }
  };

  const disconnectWhatsApp = async () => {
    if (!window.confirm('Are you sure you want to log out from WhatsApp?')) return;
    setIsWaLoading(true);
    try {
      await api.post('/whatsapp/logout');
      setWaStatus('DISCONNECTED');
      setWaQrCode(null);
      toast.success('WhatsApp disconnected');
    } catch (err) {
      toast.error('Failed to disconnect');
    } finally {
      setIsWaLoading(false);
    }
  };

  const handleBotRemind = async (member) => {
    if (waStatus !== 'CONNECTED') {
      toast.error('Please connect WhatsApp first!');
      return;
    }
    
    // Gym settings might be needed for template, if user doesn't have it, we use a default
    const defaultGym = { gym_name: user?.gymName || 'Gym', wa_msg_active: 'Hello [Name], this is a reminder from [GymName].' };
    const msg = buildWhatsAppMessage(member, user?.gym || defaultGym);
    
    const promise = api.post('/whatsapp/send', { phone: member.phone, message: msg });
    toast.promise(promise, {
      loading: `Sending message to ${member.name}...`,
      success: `Message sent to ${member.name}!`,
      error: 'Failed to send message.'
    });
  };

  const handleBulkRemind = async () => {
    if (waStatus !== 'CONNECTED') {
      toast.error('Please connect WhatsApp first!');
      return;
    }

    const membersToRemind = displayedItems.filter(i => i.itemType === 'member' && i.phone);
    if (membersToRemind.length === 0) {
      toast.error('No members with valid phone numbers to remind.');
      return;
    }

    if (!window.confirm(`Are you sure you want to send a bulk message to ${membersToRemind.length} members?`)) return;

    setIsBulkSending(true);
    const defaultGym = { gym_name: user?.gymName || 'Gym', wa_msg_active: 'Hello [Name], this is a reminder from [GymName].' };
    
    const messages = membersToRemind.map(member => ({
      phone: member.phone,
      message: buildWhatsAppMessage(member, user?.gym || defaultGym)
    }));

    try {
      await api.post('/whatsapp/send-bulk', { messages });
      toast.success('Bulk sending started! Messages are being sent in the background.');
    } catch (err) {
      toast.error('Failed to start bulk send.');
    } finally {
      setIsBulkSending(false);
    }
  };

  const handleAlertSend = async () => {
    if (!editNotif) return;

    // Send via bot if connected, else wa.me
    if (waStatus === 'CONNECTED') {
      const promise = api.post('/whatsapp/send', { phone: editNotif.recipient_phone, message: editMessage });
      toast.promise(promise, { loading: 'Sending...', success: 'Sent!', error: 'Failed' });
    } else {
      const link = getWhatsAppLink(editNotif.recipient_phone || '', editMessage);
      window.open(link, '_blank');
    }
    
    try {
      await api.patch(`/notifications/${editNotif.id}/sent`);
      setEditNotif(null);
      setEditMessage('');
      fetchData();
      window.dispatchEvent(new Event('action-center-updated'));
    } catch (err) {}
  };

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px', marginBottom: 'var(--space-md)' }}>
        <div>
          <h1 className="page-title">Action <span>Center</span></h1>
          <p className="page-subtitle">Manage collections, overdue fees, and alerts</p>
        </div>
      </div>

      {/* ── WhatsApp Connection Banner ── */}
      <div style={{ 
        background: waStatus === 'CONNECTED' ? 'var(--status-active-bg)' : 'var(--bg-secondary)', 
        border: `1px solid ${waStatus === 'CONNECTED' ? 'var(--status-active)' : 'var(--border-color)'}`,
        padding: '16px 24px', borderRadius: '16px', marginBottom: 'var(--space-xl)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ background: '#25D366', color: '#fff', width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MessageSquare size={24} />
          </div>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '16px' }}>Automated WhatsApp Bot</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
              {waStatus === 'CONNECTED' ? '✅ Connected and ready to send messages!' :
               waStatus === 'QR_READY' ? '📱 Scan the QR code with your phone WhatsApp' :
               waStatus === 'AUTHENTICATING' ? '⏳ Starting Chrome browser, please wait 30-60 seconds...' :
               'Connect WhatsApp to enable 1-click bulk messaging.'}
            </p>
          </div>
        </div>

        <div>
          {waStatus === 'CONNECTED' ? (
            <button className="btn btn-secondary" onClick={disconnectWhatsApp} disabled={isWaLoading}>
              <PowerOff size={16} /> Disconnect
            </button>
          ) : waStatus === 'QR_READY' && waQrCode ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <img src={waQrCode} alt="WhatsApp QR Code" style={{ width: '120px', height: '120px', borderRadius: '8px', border: '2px solid #25D366', background: '#fff', padding: '4px' }} />
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '100px' }}>
                Open <strong>WhatsApp</strong> → Linked Devices → Scan this code
              </div>
            </div>
          ) : waStatus === 'AUTHENTICATING' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-muted)', fontSize: '13px' }}>
              <Loader2 size={24} className="spin" style={{ color: '#25D366' }} />
              <span>Starting bot...</span>
            </div>
          ) : (
            <button className="btn btn-whatsapp" onClick={connectWhatsApp} disabled={isWaLoading} style={{ boxShadow: '0 4px 12px rgba(37,211,102,0.3)' }}>
              {isWaLoading ? <Loader2 size={16} className="spin" /> : <QrCode size={16} />}
              Connect WhatsApp
            </button>
          )}
        </div>
      </div>

      {/* ── Filters & Bulk Actions ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: 'var(--space-xl)' }}>
        <div className="filter-tabs">
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

        {waStatus === 'CONNECTED' && filter !== 'alerts' && displayedItems.filter(i => i.itemType === 'member').length > 0 && (
          <button className="btn btn-whatsapp" onClick={handleBulkRemind} disabled={isBulkSending} style={{ boxShadow: '0 4px 12px rgba(37,211,102,0.3)' }}>
            {isBulkSending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            Bulk Remind All ({displayedItems.filter(i => i.itemType === 'member').length})
          </button>
        )}
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
                    <button className="btn btn-success" style={{ flex: 1, gap: '6px', padding: '10px 4px', fontSize: '13px' }} onClick={() => navigate(`/payments/add?member=${item.id}&returnUrl=/action-center`)}>
                      <CreditCard size={16} /> Collect
                    </button>
                    {waStatus === 'CONNECTED' ? (
                      <button className="btn btn-whatsapp" style={{ flex: 1, gap: '6px', padding: '10px 4px', fontSize: '13px' }} onClick={() => handleBotRemind(item)}>
                        <Send size={16} /> Remind
                      </button>
                    ) : (
                      <button className="btn btn-secondary" style={{ flex: 1, gap: '6px', padding: '10px 4px', fontSize: '13px' }} onClick={() => {
                        const defaultGym = { gym_name: user?.gymName || 'Gym', wa_msg_active: 'Hello [Name], this is a reminder.' };
                        window.open(getWhatsAppLink(item.phone || '', buildWhatsAppMessage(item, user?.gym || defaultGym)), '_blank');
                      }}>
                        <MessageSquare size={16} /> WA.me
                      </button>
                    )}
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
