import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Loader2, Clock } from 'lucide-react';
import { formatPKR, formatDate, formatDateTime, getCurrentMonth, getCurrentYear, getMonthName } from '../../lib/utils';
import { ModernLoader } from '../../components/common/ModernLoader';
import api from '../../lib/api';
import '../../styles/payments.css';
import '../../styles/loading.css';

export default function PaymentsListPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(getCurrentMonth());
  const [year] = useState(getCurrentYear());
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');

  const [paymentsData, setPaymentsData] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchTransactions = async () => {
      try {
        const res = await api.get('/payments/all-transactions', { params: { month, year } });
        if (isMounted) {
          setPaymentsData(res.data.data);
        }
      } catch (err) {
        console.error(err);
        if (isMounted) setPaymentsData([]);
      }
    };
    setPaymentsData(null);
    fetchTransactions();
    return () => { isMounted = false; };
  }, [month, year]);

  const loading = !paymentsData;
  const payments = paymentsData || [];

  // Prepare filtered + visible list (used for empty state and rendering)
  const q = search.trim().toLowerCase();
  const filtered = payments.filter(p => {
    if (!(filter === 'all' || p.type === filter)) return false;
    if (!q) return true;
    const hay = `${p.title || ''} ${p.subtitle || ''} ${p.reason || ''} ${p.method || ''} ${p.title || ''}`.toLowerCase();
    return hay.includes(q) || String(p.amount).includes(q);
  });

  // Sorting: when user chooses newest/oldest sort purely by date. Keep a fallback priority for equal dates.
  const priority = { member_payment: 3, staff_payment: 2, expense: 1, history: 0 };
  const getTimestamp = (val) => {
    if (!val) return 0;
    if (typeof val === 'number' && !isNaN(val)) return val;
    // Native parse should handle ISO timestamps
    const t = Date.parse(val);
    if (!isNaN(t)) return t;
    // If it's a date-only string like YYYY-MM-DD, append time to make it parseable as UTC
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(val))) return Date.parse(String(val) + 'T00:00:00Z');
    // Fallback: try replacing space with T
    const alt = String(val).replace(' ', 'T');
    const t2 = Date.parse(alt);
    return isNaN(t2) ? 0 : t2;
  };

  const visible = filtered.slice().sort((a, b) => {
    const ta = getTimestamp(a.created_at || a.date);
    const tb = getTimestamp(b.created_at || b.date);
    if (sortOrder === 'newest') {
      const diff = tb - ta;
      if (diff !== 0) return diff;
      return (priority[b.type] || 0) - (priority[a.type] || 0);
    }
    if (sortOrder === 'oldest') {
      const diff = ta - tb;
      if (diff !== 0) return diff;
      return (priority[b.type] || 0) - (priority[a.type] || 0);
    }
    // default: keep member payments first then date desc
    const pa = priority[a.type] || 0;
    const pb = priority[b.type] || 0;
    if (pa !== pb) return pb - pa;
    return tb - ta;
  });

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-lg)' }}>
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">{getMonthName(month)} {year}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/payments/add')}><Plus size={16} /> Log</button>
      </div>

      <select className="form-select" style={{ marginBottom: 'var(--space-md)' }} value={month} onChange={e => setMonth(Number(e.target.value))}>
        {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>)}
      </select>

      {/* Summary Box */}
      <div className="card" style={{ marginBottom: 'var(--space-md)', textAlign: 'center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
          <div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Income</div>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 800, color: 'var(--status-active)' }}>{formatPKR(payments.filter(p => p.type === 'member_payment').reduce((s, p) => s + p.amount, 0))}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Outgoing</div>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 800, color: 'var(--status-danger)' }}>{formatPKR(payments.filter(p => p.type !== 'member_payment' && p.type !== 'history').reduce((s, p) => s + p.amount, 0))}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 'var(--space-md)', alignItems: 'center' }}>
        <input
          className="form-input"
          placeholder="Search name, amount, method..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />

        <select className="form-select" value={sortOrder} onChange={e => setSortOrder(e.target.value)} style={{ width: 160 }}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>

        <div className="filter-tabs">
        {[
          { key: 'all', label: 'All' },
          { key: 'member_payment', label: 'Members' },
          { key: 'staff_payment', label: 'Staff' },
          { key: 'expense', label: 'Expenses' },
          { key: 'history', label: 'History' },
        ].map(f => (
          <button key={f.key} className={`filter-tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '60px 0' }}>
          <ModernLoader type="morph" text="Reconciling Accounts..." />
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state"><h3>No transactions found</h3></div>
      ) : (
        visible.map(p => {
          const isIncome = p.type === 'member_payment';
          return (
            <div key={p.id} className="payment-card">
              <div className="pay-icon" style={{ 
                background: isIncome ? 'var(--status-active-bg)' : 'var(--status-danger-bg)', 
                color: isIncome ? 'var(--status-active)' : 'var(--status-danger)' 
              }}>
                {isIncome ? '💰' : '💸'}
              </div>
              <div className="pay-details" style={{ flex: 1, minWidth: 0 }}>
                <h4 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</h4>
                <p style={{ fontSize: 11 }}>{formatDateTime(p.created_at || p.date)} • {p.subtitle}</p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Reason: {p.reason}
                </p>
              </div>
              <div className="pay-right" style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                <div className="amount" style={{ color: isIncome ? 'var(--status-active)' : (p.type === 'history' ? 'var(--text-muted)' : 'var(--status-danger)') }}>
                  {p.type === 'history' ? '' : (isIncome ? '+' : '-')}{formatPKR(p.amount)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span className="method" style={{ fontSize: 10, textTransform: 'uppercase' }}>{p.method}</span>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
