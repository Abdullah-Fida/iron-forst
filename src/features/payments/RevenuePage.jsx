import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import api from '../../lib/api';
import { formatPKR, getCurrentMonth, getCurrentYear, getMonthName } from '../../lib/utils';
import { PLAN_DURATIONS, PAYMENT_METHODS } from '../../lib/constants';
import { StateView } from '../../components/common/StateView';
import { ModernLoader } from '../../components/common/ModernLoader';
import '../../styles/payments.css';
import '../../styles/loading.css';

export default function RevenuePage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('this_month');
  const [allPayments, setAllPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAllPayments = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/payments');
      setAllPayments(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch payments from API', err);
      setError('Failed to load payment data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllPayments();
  }, []);

  const now = new Date();
  let payments = [];
  let prevTotal = 0;

  // Timezone-safe date parser for YYYY-MM-DD strings
  const getDateParts = (dateStr) => {
    if (!dateStr) return { y: 0, m: 0, d: 0, str: '' };
    const s = String(dateStr).slice(0, 10);
    const [y, m, d] = s.split('-').map(Number);
    return { y, m: m - 1, d, str: s }; // m is 0-indexed to match JS getMonth()
  };

  if (period === 'this_month') {
    payments = allPayments.filter(p => {
      const { y, m } = getDateParts(p.payment_date);
      return m === now.getMonth() && y === now.getFullYear();
    });
  } else if (period === 'last_3_months') {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-01`;
    payments = allPayments.filter(p => getDateParts(p.payment_date).str >= cutoffStr);
  } else if (period === 'last_6_months') {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-01`;
    payments = allPayments.filter(p => getDateParts(p.payment_date).str >= cutoffStr);
  } else if (period === 'this_year') {
    payments = allPayments.filter(p => getDateParts(p.payment_date).y === now.getFullYear());
  } else if (period === 'all_time') {
    payments = allPayments;
  } else if (period.startsWith('month_')) {
    const targetM = parseInt(period.split('_')[1], 10) - 1; // 0-indexed
    payments = allPayments.filter(p => {
      const { y, m } = getDateParts(p.payment_date);
      return m === targetM && y === now.getFullYear();
    });
  }

  if (period === 'this_month' || period.startsWith('month_')) {
    const m1 = period === 'this_month' ? now.getMonth() + 1 : parseInt(period.split('_')[1], 10);
    const prevMonth = m1 === 1 ? 12 : m1 - 1;
    const prevYear = m1 === 1 ? now.getFullYear() - 1 : now.getFullYear();
    const prevPayments = allPayments.filter(p => {
      const { y, m } = getDateParts(p.payment_date);
      return (m + 1) === prevMonth && y === prevYear;
    });
    prevTotal = prevPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  }

  const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const change = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;

  // Breakdown by duration
  const byDuration = PLAN_DURATIONS.map(d => ({
    label: d.label,
    count: payments.filter(pay_item => {
      if (d.value === 'custom') return pay_item.plan_duration_months === 'custom' || pay_item.plan_duration_months === 0;
      return String(pay_item.plan_duration_months) === String(d.value);
    }).length,
    total: payments.filter(pay_item => {
      if (d.value === 'custom') return pay_item.plan_duration_months === 'custom' || pay_item.plan_duration_months === 0;
      return String(pay_item.plan_duration_months) === String(d.value);
    }).reduce((s, pay_item) => s + Number(pay_item.amount || 0), 0),
  }));
  // Breakdown by method
  const byMethod = PAYMENT_METHODS.map(m => ({
    label: m.label,
    count: payments.filter(pay_item => pay_item.payment_method === m.value).length,
    total: payments.filter(pay_item => pay_item.payment_method === m.value).reduce((s, pay_item) => s + Number(pay_item.amount || 0), 0),
  }));

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <h1 className="page-title">Revenue Report</h1>
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
        <div style={{ padding: '60px 0' }}>
          <ModernLoader type="bar" text="Calculating Financial Metrics..." />
        </div>
      ) : error ? (
        <StateView 
          type="error" 
          title="Revenue Report Error" 
          description={error} 
          onRetry={fetchAllPayments} 
        />
      ) : (
        <>
          <div className="card" style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Total Revenue</div>
            <div style={{ fontSize: 'var(--font-3xl)', fontWeight: 900, color: 'var(--status-active)', margin: 'var(--space-sm) 0' }}>{formatPKR(total)}</div>
            {prevTotal > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 'var(--font-sm)', color: change >= 0 ? 'var(--status-active)' : 'var(--status-danger)' }}>
                {change >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                {change >= 0 ? '+' : ''}{change}% vs last month
              </div>
            )}
          </div>

          <div className="revenue-breakdown">
            <h3 className="section-title">By Plan Duration</h3>
            <div className="card">
              {byDuration.map(d => (
                <div key={d.label} className="revenue-item">
                  <span className="label">{d.label} ({d.count})</span>
                  <span className="value">{formatPKR(d.total)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="revenue-breakdown">
            <h3 className="section-title">By Payment Method</h3>
            <div className="card">
              {byMethod.map(m => (
                <div key={m.label} className="revenue-item">
                  <span className="label">{m.label} ({m.count})</span>
                  <span className="value">{formatPKR(m.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


