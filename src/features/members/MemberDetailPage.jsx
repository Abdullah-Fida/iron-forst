import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Edit,
  CreditCard,
  MessageCircle,
  Trash2,
  Printer,
  Phone,
  Calendar,
  ReceiptText,
  Fingerprint,
  Check,
  X
} from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  getInitials,
  formatPKR,
  formatDate,
  formatDateTime,
  daysFromNow,
  buildWhatsAppMessage,
  getWhatsAppLink
} from '../../lib/utils';
import { printThermalReceipt } from '../../lib/thermalPrinter';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { ModernLoader } from '../../components/common/ModernLoader';
import '../../styles/members.css';
import '../../styles/notifications.css';

export default function MemberDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();

  const [member, setMember] = useState(null);
  const [gym, setGym] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMessage, setEditMessage] = useState('');
  const [showWaModal, setShowWaModal] = useState(false);
  const [editingPin, setEditingPin] = useState(false);
  const [tempPin, setTempPin] = useState('');
  const [attendanceCount, setAttendanceCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/members/${id}`);
        const m = res.data.data;
        if (m) {
          setMember(m);
        } else {
          toast.error('Member not found');
          navigate('/members');
        }

        try {
          const gRes = await api.get('/gym');
          setGym(gRes.data.data);
        } catch (e) {
          const cached = localStorage.getItem('core_gym_settings');
          if (cached) setGym(JSON.parse(cached));
        }

        try {
          const dt = new Date();
          const attRes = await api.get(`/members/${id}/attendance`, { params: { month: dt.getMonth() + 1, year: dt.getFullYear() } });
          setAttendanceCount(attRes.data.data?.length || 0);
        } catch(e) {}

      } catch (err) {
        console.error(err);
        toast.error('Error loading profile');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate, toast]);

  if (loading) return (
    <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <ModernLoader type="morph" text="Opening Profile..." />
    </div>
  );

  if (!member) return null;

  const payments = member.payments || [];

  // Robust fallback: if latest_expiry is null, calculate from the payments array
  let actualExpiry = member.latest_expiry;
  if (!actualExpiry && payments.length > 0) {
    const sorted = [...payments].sort((a, b) => {
      const dateA = new Date(a.expiry_date || a.payment_date || 0);
      const dateB = new Date(b.expiry_date || b.payment_date || 0);
      return dateB - dateA;
    });
    actualExpiry = sorted[0].expiry_date || sorted[0].payment_date;
  }

  const days = actualExpiry ? daysFromNow(actualExpiry) : null;
  const isExpired = member.status === 'expired' || (days !== null && days < 0);
  const isDueSoon = member.status === 'due_soon' || (days !== null && days >= 0 && days <= 3);

  const handleRemind = () => {
    if (!gym) {
      toast.error('Gym settings not loaded');
      return;
    }
    const msg = buildWhatsAppMessage(member, gym);
    setEditMessage(msg);
    setShowWaModal(true);
  };

  const executeSendWhatsApp = () => {
    const link = getWhatsAppLink(member.phone || '', editMessage);
    window.open(link, '_blank');
    setShowWaModal(false);
  };

  const handleSavePin = async () => {
    try {
      await api.put(`/members/${member.id}`, { fingerprint_id: tempPin });
      setMember({ ...member, fingerprint_id: tempPin });
      setEditingPin(false);
      toast.success('Device PIN updated successfully!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update PIN');
    }
  };

  const printReceipt = (p) => {
    const gymName = (gym?.gym_name || gym?.name) || user?.gym_name || 'IRON FOST';
    printThermalReceipt({
      gymName,
      invoiceId: p.id,
      memberName: member.name,
      memberPhone: member.phone,
      amount: p.amount,
      paymentDate: p.payment_date,
      paymentMethod: p.payment_method,
      expiryDate: p.expiry_date,
      reason: 'Membership Fee',
    });
  };

  const handleDelete = async () => {
    const isConfirmed = await confirm({
      title: 'Delete Member',
      message: `Are you sure you want to remove ${member.name}?`,
      confirmText: 'Delete',
      type: 'danger'
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/members/${id}`);
      toast.success('Member removed');
      navigate('/members');
    } catch (e) {
      toast.error('Failed to delete');
    }
  };

  return (
    <div className="page-container">
      {/* Top Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate('/members')}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-icon btn-secondary" onClick={() => navigate(`/members/${id}/edit`)}>
            <Edit size={18} />
          </button>
          <button className="btn btn-icon btn-danger-outline" onClick={handleDelete}>
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Profile Central Header */}
      <div className="profile-center-header">
        <div className={`profile-avatar-wrapper ${isExpired ? 'expired' : isDueSoon ? 'due' : 'active'}`}>
          <div className="avatar avatar-xxl" style={{ borderRadius: '50%' }}>
            {getInitials(member.name)}
          </div>
        </div>
        <h1 className="profile-name">{member.name}</h1>
        <div className="profile-subtitle">
          <span className="phone"><Phone size={14} style={{ marginRight: 4 }} /> {member.phone}</span>
          <span className={`status-pill ${isExpired ? 'expired' : isDueSoon ? 'due' : 'active'}`}>
            {isExpired ? 'Expired' : isDueSoon ? 'Due Soon' : 'Active'}
          </span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="profile-stats-row">
        <div className="stat-box">
          <div className="stat-label">Membership</div>
          <div className={`stat-value ${isExpired ? 'danger' : isDueSoon ? 'warning' : 'success'}`}>
            {days === null ? 'No Payment' : isExpired ? `${Math.abs(days)}d Overdue` : `${days} Days Left`}
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Transactions</div>
          <div className="stat-value">{payments.length} Records</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Visits this Month</div>
          <div className="stat-value" style={{ color: 'var(--accent-primary)' }}>{attendanceCount} Days</div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="profile-action-stack">
        <button className="btn btn-primary btn-lg btn-block" onClick={() => navigate(`/payments/add?member=${id}`)}>
          <CreditCard size={18} style={{ marginRight: 8 }} /> Log New Payment
        </button>
        <button className="btn btn-whatsapp btn-lg btn-block" onClick={handleRemind}>
          <MessageCircle size={18} style={{ marginRight: 8 }} /> Message on WhatsApp
        </button>
      </div>

      {/* Member Details Section */}
      <div className="profile-details-section">
        <h3 className="section-title">Member Details</h3>
        <div className="card detail-card">
          <div className="detail-row">
            <div className="detail-item">
              <span className="label">Member Since</span>
              <span className="value">{formatDate(member.join_date)}</span>
            </div>
            <div className="detail-item">
              <span className="label">Membership ID</span>
              <span className="value">{member.membership_id || 'Not assigned'}</span>
            </div>
            <div className="detail-item">
              <span className="label">Emergency Contact</span>
              <span className="value">{member.emergency_contact || 'Not provided'}</span>
            </div>
          </div>
          {member.notes && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
              <span className="label" style={{ fontSize: '11px', textTransform: 'uppercase', opacity: 0.6 }}>Internal Notes</span>
              <p style={{ fontSize: '14px', marginTop: '4px' }}>{member.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Device PIN Section */}
      <div className="profile-biometric-section" style={{ marginTop: '32px' }}>
        <h3 className="section-title">Hardware Access (Device PIN)</h3>
        <div className="card" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px', background: member.fingerprint_id ? 'var(--status-active-bg)' : 'var(--bg-tertiary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: member.fingerprint_id ? 'var(--status-active)' : 'var(--text-muted)'
            }}>
              <Fingerprint size={24} />
            </div>
            <div>
              <div style={{ fontWeight: '700', fontSize: '15px' }}>Device PIN Mapping</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {member.fingerprint_id ? `PIN ID: ${member.fingerprint_id}` : 'Not mapped to device'}
              </div>
            </div>
          </div>
          
          {editingPin ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input 
                type="number"
                className="form-input" 
                style={{ width: '100px', padding: '6px 12px' }}
                placeholder="PIN"
                value={tempPin}
                autoFocus
                onChange={e => setTempPin(e.target.value)}
              />
              <button className="btn btn-icon btn-primary" onClick={handleSavePin}><Check size={16} /></button>
              <button className="btn btn-icon btn-secondary" onClick={() => setEditingPin(false)}><X size={16} /></button>
            </div>
          ) : (
            <button className={`btn ${member.fingerprint_id ? 'btn-secondary' : 'btn-primary'} btn-sm`} onClick={() => { setTempPin(member.fingerprint_id || ''); setEditingPin(true); }}>
              {member.fingerprint_id ? 'Edit PIN' : 'Assign PIN'}
            </button>
          )}
        </div>
      </div>

      {/* Payment History Section */}
      <div className="profile-history-section" style={{ marginTop: '32px' }}>
        <h3 className="section-title">Payment History</h3>
        {payments.length === 0 ? (
          <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No payment records found.
          </div>
        ) : (
          <div className="history-list">
            {payments.map(p => (
              <div key={p.id} className="history-item-modern">
                <div className="history-icon"><ReceiptText size={18} /></div>
                <div className="history-main">
                  <div className="history-title">{formatDate(p.payment_date)}</div>
                  <div className="history-sub">{p.plan_duration_months} month plan • {p.payment_method}</div>
                </div>
                <div className="history-right">
                  <div className="history-amount">{formatPKR(p.amount)}</div>
                  <button className="btn-text-only" onClick={() => printReceipt(p)}><Printer size={14} /> Print</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* WhatsApp Edit Modal */}
      {showWaModal && (
        <div className="modal-backdrop" onClick={() => setShowWaModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 'var(--space-md)' }}>Edit WhatsApp Message</h2>
            <div className="form-group">
              <label className="form-label">Message Preview</label>
              <textarea
                className="form-textarea"
                style={{ minHeight: 120 }}
                value={editMessage}
                onChange={e => setEditMessage(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
              <button className="btn btn-secondary btn-block" onClick={() => setShowWaModal(false)}>Cancel</button>
              <button className="btn btn-whatsapp btn-block" onClick={executeSendWhatsApp}>Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
