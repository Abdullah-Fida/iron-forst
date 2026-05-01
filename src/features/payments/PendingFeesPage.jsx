import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, MessageCircle, CreditCard, Search, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { getInitials, daysFromNow, formatDate, formatPKR, buildWhatsAppMessage, getWhatsAppLink, calculateMemberStatus } from '../../lib/utils';
import { WHATSAPP_TEMPLATES } from '../../lib/constants';
import '../../styles/payments.css';

export default function PendingFeesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(searchParams.get('filter') || 'all');
  
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchPending = async () => {
      setLoading(true);
      try {
        const res = await api.get('/payments/pending');
        if (!isMounted) return;
        
        const rawMembers = res.data.data || [];
        const pending = rawMembers.map(m => {
          let lastPayment = null;
          if (m.payments && m.payments.length > 0) {
            const sorted = [...m.payments].sort((a,b) => new Date(b.payment_date) - new Date(a.payment_date));
            lastPayment = sorted[0];
          }
          const status = calculateMemberStatus(m);
          return { ...m, status, lastPayment };
        });
        
        setMembers(pending);
      } catch (err) {
        console.error('Pending fetch failed', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchPending();
    return () => { isMounted = false; };
  }, []);

  let targetMembers = members;
  if (filter === 'expired') targetMembers = targetMembers.filter(m => m.status === 'expired');
  if (filter === 'due_soon') targetMembers = targetMembers.filter(m => m.status === 'due_soon');

  if (search) {
    const s = search.toLowerCase();
    targetMembers = targetMembers.filter(m => m.name.toLowerCase().includes(s) || m.phone.includes(s));
  }

  const handleRemind = (member) => {
    const msg = `Hello ${member.name}, this is a reminder from ${user.name} regarding your gym membership renewal.`;
    window.open(getWhatsAppLink(member.phone, msg), '_blank');
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Pending Fees</h1>
        <p className="page-subtitle" style={{ color: 'var(--status-danger)' }}>
          <AlertTriangle size={14} style={{ display: 'inline', verticalAlign: -2 }} /> 
          {members.length} total members need attention
        </p>
      </div>

      <div className="filter-tabs" style={{ marginBottom: 'var(--space-md)' }}>
        <button className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All ({members.length})
        </button>
        <button className={`filter-tab ${filter === 'expired' ? 'active' : ''}`} onClick={() => setFilter('expired')}>
          Unpaid ({members.filter(m => m.status === 'expired').length})
        </button>
        <button className={`filter-tab ${filter === 'due_soon' ? 'active' : ''}`} onClick={() => setFilter('due_soon')}>
          Near to Expire ({members.filter(m => m.status === 'due_soon').length})
        </button>
      </div>

      <div className="search-bar" style={{ marginBottom: 'var(--space-md)' }}>
        <Search />
        <input 
          placeholder="Search unpaid member by name or phone..." 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
        />
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
          <Loader2 className="spin" size={32} style={{ color: 'var(--primary)' }} />
        </div>
      ) : targetMembers.length === 0 ? (
        <div className="empty-state">
          <h3>🎉 All Clear!</h3>
          <p>No members in this category!</p>
        </div>
      ) : (
        targetMembers.map(member => {
          const days = member.latest_expiry ? daysFromNow(member.latest_expiry) : null;
          const isExpired = member.status === 'expired' || (days !== null && days < 0);

          return (
            <div key={member.id} className="pending-card">
              <div className="avatar" style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}>
                {getInitials(member.name)}
              </div>
              <div className="pending-info">
                <h4>{member.name}</h4>
                <div className="overdue">
                  {days === null ? 'No payment record' : isExpired ? `${Math.abs(days)} days overdue` : `Expires in ${days} days`}
                </div>
                {member.lastPayment && (
                  <div className="last-pay">Last: {formatPKR(member.lastPayment.amount)} on {formatDate(member.lastPayment.payment_date)}</div>
                )}
              </div>
              <div className="pending-buttons">
                <button className="btn btn-whatsapp btn-sm" onClick={() => handleRemind(member)}>
                  <MessageCircle size={14} />
                </button>
                <button className="btn btn-success btn-sm" onClick={() => navigate(`/payments/add?member=${member.id}&returnUrl=/payments/pending`)}>
                  <CreditCard size={14} />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
