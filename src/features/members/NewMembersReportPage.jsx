import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, UserPlus, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { getMonthName, getInitials, daysFromNow, formatDateShort } from '../../lib/utils';
import '../../styles/payments.css';
import '../../styles/members.css';

export default function NewMembersReportPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('this_month');
  
  const [allMembers, setAllMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAllMembers = async () => {
      setLoading(true);
      try {
        const res = await api.get('/members');
        setAllMembers((res.data.data || []).filter(m => m.status !== 'deleted'));
      } catch (err) {
        console.error('Failed to fetch members', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAllMembers();
  }, []);

  const now = new Date();
  let members = [];
  let prevTotal = 0;

  if (period === 'this_month') {
    members = allMembers.filter(m => {
      const d = new Date(m.join_date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  } else if (period === 'last_3_months') {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    members = allMembers.filter(m => new Date(m.join_date) >= cutoff);
  } else if (period === 'last_6_months') {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    members = allMembers.filter(m => new Date(m.join_date) >= cutoff);
  } else if (period === 'this_year') {
    members = allMembers.filter(m => new Date(m.join_date).getFullYear() === now.getFullYear());
  } else if (period === 'all_time') {
    members = allMembers;
  } else if (period.startsWith('month_')) {
    const monthIdx = parseInt(period.split('_')[1], 10) - 1;
    members = allMembers.filter(mb => {
      const d = new Date(mb.join_date);
      return d.getMonth() === monthIdx && d.getFullYear() === now.getFullYear();
    });
  }

  if (period === 'this_month' || period.startsWith('month_')) {
    const selectedMonth = period === 'this_month' ? now.getMonth() + 1 : parseInt(period.split('_')[1], 10);
    const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
    const prevYear = selectedMonth === 1 ? now.getFullYear() - 1 : now.getFullYear();
    const prevMembers = allMembers.filter(mb => {
      const d = new Date(mb.join_date);
      return d.getMonth() + 1 === prevMonth && d.getFullYear() === prevYear;
    });
    prevTotal = prevMembers.length;
  }

  const total = members.length;
  const change = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;

  // Breakdown by status
  const byStatus = [
    { label: 'Active', count: members.filter(m => m.status === 'active').length, color: 'var(--status-active)' },
    { label: 'Due Soon', count: members.filter(m => m.status === 'due_soon').length, color: 'var(--status-warning)' },
    { label: 'Expired', count: members.filter(m => m.status === 'expired').length, color: 'var(--status-danger)' }
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <h1 className="page-title">New Members Report</h1>
      </div>

      <select className="form-select" style={{ marginBottom: 'var(--space-md)' }} value={period} onChange={e => setPeriod(e.target.value)}>
        <option value="this_month">This Month</option>
        <option value="last_3_months">Last 3 Months</option>
        <option value="last_6_months">Last 6 Months</option>
        <option value="this_year">This Year</option>
        <option value="all_time">All Time</option>
        <optgroup label="Specific Month (This Year)">
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={`month_${i + 1}`}>{getMonthName(i + 1)}</option>)}
        </optgroup>
      </select>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px' }}>
          <Loader2 className="spin" size={48} style={{ color: 'var(--primary)' }} />
        </div>
      ) : (
        <>
          <div className="card" style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>Total Joined</div>
            <div style={{ fontSize: 'var(--font-3xl)', fontWeight: 900, color: '#2563eb', margin: 'var(--space-sm) 0' }}>{total}</div>
            {prevTotal > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 'var(--font-sm)', color: change >= 0 ? 'var(--status-active)' : 'var(--status-danger)', fontWeight: 600 }}>
                {change >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                {change >= 0 ? '+' : ''}{change}% vs last month
              </div>
            )}
          </div>

          <div className="revenue-breakdown">
            <h3 className="section-title">Current Status Breakdown</h3>
            <div className="card">
              {byStatus.map(s => (
                <div key={s.label} className="revenue-item" style={{ borderBottom: '1px solid var(--border-color)', margin: 0, padding: 'var(--space-md) 0' }}>
                  <span className="label" style={{ fontWeight: 700, color: s.color }}>{s.label}</span>
                  <span className="value">{s.count} members</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 'var(--space-xl)' }}>
            <h3 className="section-title">List of New Members ({total})</h3>
            {members.length === 0 ? (
              <div className="empty-state">
                <UserPlus size={32} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                <p style={{ color: 'var(--text-muted)' }}>No members found for this period.</p>
              </div>
            ) : (
              members.map(member => {
                const days = member.latest_expiry ? daysFromNow(member.latest_expiry) : null;
                const isExpired = days !== null && days < 0;
                const isDueSoon = days !== null && days >= 0 && days <= 3;
                
                return (
                  <div key={member.id} className="member-card" onClick={() => navigate(`/members/${member.id}`)} style={{ background: 'var(--bg-primary)', padding: '12px' }}>
                    <div className="avatar" style={{
                      background: isExpired ? 'var(--status-danger-bg)' : isDueSoon ? 'var(--status-warning-bg)' : 'var(--accent-gradient)',
                      color: isExpired ? 'var(--status-danger)' : isDueSoon ? 'var(--status-warning)' : 'white'
                    }}>
                      {getInitials(member.name)}
                    </div>
                    <div className="member-info">
                      <div className="member-name">{member.name}</div>
                      <div className="member-phone" style={{ fontSize: '10px' }}>Joined: {formatDateShort(member.join_date)}</div>
                    </div>
                    <div className="member-meta">
                      <span className={`badge badge-${member.status === 'active' ? 'active' : member.status === 'due_soon' ? 'warning' : 'danger'}`}>
                        {member.status === 'active' ? 'Active' : member.status === 'due_soon' ? 'Due Soon' : 'Expired'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
