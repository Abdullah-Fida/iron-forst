import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, AlertTriangle, CalendarCheck, TrendingUp, DollarSign,
  ChevronRight, UserPlus, CreditCard, MessageCircle,
  TrendingDown, Activity, Zap, Clock, Eye, EyeOff
} from 'lucide-react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement, Tooltip, Legend,
  Filler
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { StateView } from '../../components/common/StateView';
import { ModernLoader } from '../../components/common/ModernLoader';
import { useAuth } from '../../contexts/AuthContext';
import { formatPKR, formatDateShort, daysFromNow, buildWhatsAppMessage, getWhatsAppLink, getMonthName, calculateMemberStatus } from '../../lib/utils';
import api from '../../lib/api';
import '../../styles/dashboard.css';
import '../../styles/loading.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler);

const CHART_ORANGE = '#4f46e5';
const CHART_BLACK = '#111827';
const CHART_GRAY = '#f1f5f9';
const CHART_GREEN = '#10b981';
const CHART_RED = '#ef4444';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('revenue');

  const [hiddenMetrics, setHiddenMetrics] = useState(new Set());

  const toggleMetric = (e, key) => {
    e.stopPropagation();
    setHiddenMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isHidden = (key) => hiddenMetrics.has(key);

  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchDashboard = async () => {
      try {
        const [membersRes, paymentsRes, expensesRes, staffRes] = await Promise.all([
          api.get('/members'),
          api.get('/payments'),
          api.get('/expenses'),
          api.get('/staff')
        ]);
        
        if (!isMounted) return;

        const allMembers = membersRes.data.data || [];
        const allPayments = paymentsRes.data.data || [];
        const allExpenses = expensesRes.data.data || [];
        const staffData = staffRes.data.data || [];
        
        const allStaffPayments = [];
        staffData.forEach(s => {
          if (s.staff_payments) {
            s.staff_payments.forEach(p => allStaffPayments.push(p));
          }
        });

      const activeMembersList = allMembers.filter(m => m.status !== 'deleted');

      // Recalculate status from latest_expiry (DB status can be stale)
      const membersWithStatus = activeMembersList.map(m => {
        const status = calculateMemberStatus(m);
        return { ...m, status };
      });

      const totalMembers = membersWithStatus.length;
      const activeMembers = membersWithStatus.filter(m => m.status === 'active').length;
      const expiredCount = membersWithStatus.filter(m => m.status === 'expired').length;
      const dueSoonCount = membersWithStatus.filter(m => m.status === 'due_soon').length;

      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();

      const thisMonthPayments = allPayments.filter(p => {
        const d = new Date(p.payment_date);
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
      });
      const revenue = thisMonthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const thisMonthExpenses = allExpenses.filter(e => {
        const d = new Date(e.expense_date);
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
      });
      const monthGeneralExpenses = thisMonthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

      const thisMonthStaffPayments = allStaffPayments.filter(p => p.month === thisMonth + 1 && p.year === thisYear);
      const salaryTotal = thisMonthStaffPayments.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
      const totalExp = monthGeneralExpenses + salaryTotal;

      // Daily Earning Calculation (Local Timezone)
      const todayStr = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD' in local time
      const todaysPayments = allPayments.filter(p => {
        if (!p.payment_date) return false;
        // Parse date considering local timezone
        const d = new Date(p.payment_date);
        return d.toLocaleDateString('en-CA') === todayStr;
      });
      const dailyEarning = todaysPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      // 6 Month Trend
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const m = d.getMonth();
        const y = d.getFullYear();

        const mPayments = allPayments.filter(p => {
          const pd = new Date(p.payment_date);
          return pd.getMonth() === m && pd.getFullYear() === y;
        });

        const mExpenses = allExpenses.filter(e => {
          const ed = new Date(e.expense_date);
          return ed.getMonth() === m && ed.getFullYear() === y;
        });
        const mStaffPayments = allStaffPayments.filter(p => p.month === m + 1 && p.year === y);
        const mSal = mStaffPayments.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);

        const mRev = mPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const mExp = mExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0) + mSal;

        trend.push({ month: m + 1, revenue: mRev, expenses: mExp, profit: mRev - mExp });
      }

        setDashboardData({
          stats: { totalMembers, activeMembers, expiredCount, dueSoonCount, revenue, expenses: totalExp, salaryTotal, generalExpenses: monthGeneralExpenses, profit: revenue - totalExp, dailyEarning },
          revenueTrend: trend
        });
        setLoading(false);
      } catch (err) {
        console.error('Dash error:', err);
        if (isMounted) {
          setDashboardData({ error: true, msg: err.message || JSON.stringify(err) });
          setLoading(false);
        }
      }
    };
    fetchDashboard();
    return () => { isMounted = false; };
  }, []);
  const stats = dashboardData?.stats;
  const revenueTrend = dashboardData?.revenueTrend || [];

  if (loading || !dashboardData) {
    return (
      <div className="page-container dashboard-page" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '70vh' }}>
        <ModernLoader type="morph" text="Preparing Dashboard..." />
      </div>
    );
  }

  if (dashboardData.error) return <div className="page-container"><StateView type="error" title="Dashboard Error" description={dashboardData.msg ? `Error: ${dashboardData.msg}. Please send me a screenshot.` : "Check connection."} /></div>;

  const revenueData = revenueTrend.map(d => d.revenue);
  const expenseData = revenueTrend.map(d => d.expenses);
  const profitData = revenueTrend.map(d => d.profit);
  const trendLabels = revenueTrend.map(d => getMonthName(d.month).slice(0, 3));

  // ── Member Status Distribution ────────
  const activeCount = stats.activeMembers;
  const dueSoonCount = stats.dueSoonCount;
  const expiredCount = stats.expiredCount;
  const totalCount = stats.totalMembers;
  const noPayment = totalCount - (activeCount + dueSoonCount + expiredCount);

  // ── Chart configs ────────────────────
  const baseChartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: CHART_BLACK, titleColor: '#fff', bodyColor: '#ccc', borderColor: CHART_ORANGE, borderWidth: 1, cornerRadius: 0 } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#888', font: { weight: '700', size: 10 } }, border: { color: CHART_GRAY } },
      y: { grid: { color: '#f0f0f0' }, ticks: { color: '#888', font: { weight: '600', size: 10 }, callback: v => v >= 1000 ? `${v / 1000}K` : v }, border: { color: CHART_GRAY } }
    }
  };

  const revenueChartData = {
    labels: trendLabels,
    datasets: [
      {
        label: 'Revenue', data: revenueData, backgroundColor: CHART_ORANGE, borderColor: CHART_ORANGE, borderWidth: 2,
        hoverBackgroundColor: '#e85f00'
      },
      {
        label: 'Expenses', data: expenseData, backgroundColor: CHART_GRAY, borderColor: '#bbb', borderWidth: 2,
        hoverBackgroundColor: '#ccc'
      },
    ]
  };

  const profitChartData = {
    labels: trendLabels,
    datasets: [{
      label: 'Profit',
      data: profitData,
      borderColor: CHART_ORANGE,
      backgroundColor: 'rgba(255,107,0,0.08)',
      borderWidth: 2.5,
      pointBackgroundColor: profitData.map(v => v >= 0 ? CHART_ORANGE : CHART_RED),
      pointRadius: 4,
      tension: 0.3,
      fill: true,
    }]
  };

  const memberDonutData = {
    labels: ['Active', 'Due Soon', 'Expired', 'No Payment'],
    datasets: [{
      data: [activeCount, dueSoonCount, expiredCount, noPayment],
      backgroundColor: [CHART_GREEN, '#e8a000', CHART_RED, '#bbbbbb'],
      borderColor: [CHART_BLACK],
      borderWidth: 2,
    }]
  };

  const handleRemind = (member) => {
    const msg = `Hello ${member.name}, this is a reminder from ${user.name} regarding your gym membership renewal.`;
    window.open(getWhatsAppLink(member.phone, msg), '_blank');
  };

  const statCards = [
    { key: 'daily', label: 'Today\'s Earnings', value: formatPKR(stats.dailyEarning || 0), icon: Zap, color: '#3b82f6', pct: 'Resets daily', onClick: () => navigate('/payments') },
    { key: 'active', label: 'Active Members', value: stats.activeMembers, icon: Users, color: CHART_GREEN, pct: `${Math.round((stats.activeMembers / stats.totalMembers) * 100) || 0}% of total`, onClick: () => navigate('/members?status=active') },
    { key: 'expired', label: 'Expired', value: stats.expiredCount, icon: AlertTriangle, color: CHART_RED, pct: 'Must renew now', onClick: () => navigate('/members?status=expired') },
    { key: 'due', label: 'Due Soon', value: stats.dueSoonCount, icon: Clock, color: '#e8a000', pct: 'Remind them soon', onClick: () => navigate('/members?status=due_soon') },
    { key: 'revenue', label: 'Month Revenue', value: formatPKR(stats.revenue), icon: TrendingUp, color: CHART_ORANGE, pct: 'Total collected', onClick: () => navigate('/payments') },
    { key: 'expenses', label: 'Total Expenses', value: formatPKR(stats.expenses), icon: TrendingDown, color: CHART_RED, pct: `Incl. ${formatPKR(stats.salaryTotal)} Salaries`, onClick: () => navigate('/expenses/summary') },
    { key: 'profit', label: 'Net Profit', value: formatPKR(stats.profit), icon: DollarSign, color: (stats.profit || 0) >= 0 ? CHART_GREEN : CHART_RED, pct: (stats.profit || 0) >= 0 ? '▲ Profitable' : '▼ Loss', onClick: () => navigate('/expenses/summary') },
  ];

  return (
    <div className="page-container dashboard-page">
      {/* ── Header ─── */}
      <div className="dash-header">
        <div>
          <p className="dash-greeting">Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'} 👋</p>
          <h1 className="page-title">Dashboard</h1>
        </div>
        <div className="dash-live">
          <span className="live-dot"></span>
          <span>LIVE</span>
        </div>
      </div>

      {/* ── Stat Cards ─── */}
      <div className="stats-grid">
        {statCards.map((s, i) => (
          <div key={i} className={'stat-card'} style={{ '--stat-color': s.color, cursor: s.onClick ? 'pointer' : 'default' }} onClick={s.onClick}>
            <div className="stat-card-header">
              <div className="stat-icon" style={{ background: s.color + '18' }}>
                <s.icon size={20} style={{ color: s.color }} />
              </div>
              <button className="btn-hide-metric-sm" onClick={(e) => toggleMetric(e, s.key)}>
                {isHidden(s.key) ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
            <div className={`stat-value ${isHidden(s.key) ? 'masked-value' : ''}`} style={{ color: s.color }}>
              {isHidden(s.key) ? '••••••' : s.value}
            </div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-pct">{s.pct}</div>
          </div>
        ))}
      </div>

      {/* ── Chart Tabs ─── */}
      <div className="chart-section">
        <div className="chart-tabs">
          {[
            { key: 'revenue', label: '💰 Revenue' },
            { key: 'profit', label: '📈 Profit' },
            { key: 'members', label: '👥 Members' },
          ].map(t => (
            <button key={t.key} className={`chart-tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="chart-wrapper">
          {activeTab === 'revenue' && (
            <>
              <div className="chart-header">
                <div>
                  <div className="chart-title">Revenue vs Expenses</div>
                  <div className="chart-subtitle">Last 6 months — PKR</div>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, fontWeight: 700 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: CHART_ORANGE, display: 'inline-block', border: '2px solid #111' }}></span> Revenue</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: CHART_GRAY, display: 'inline-block', border: '2px solid #111' }}></span> Expenses</span>
                </div>
              </div>
              <div style={{ height: 200 }}>
                <Bar data={revenueChartData} options={{ ...baseChartOpts, plugins: { ...baseChartOpts.plugins, tooltip: { ...baseChartOpts.plugins.tooltip, callbacks: { label: ctx => ` ${formatPKR(ctx.raw)}` } } } }} />
              </div>
            </>
          )}
          {activeTab === 'profit' && (
            <>
              <div className="chart-header">
                <div>
                  <div className="chart-title">Net Profit Trend</div>
                  <div className="chart-subtitle">Revenue minus expenses — 6 months</div>
                </div>
              </div>
              <div style={{ height: 200 }}>
                <Line data={profitChartData} options={{ ...baseChartOpts, scales: { ...baseChartOpts.scales, y: { ...baseChartOpts.scales.y, ticks: { ...baseChartOpts.scales.y.ticks, callback: v => v >= 1000 ? `${v / 1000}K` : v >= 0 ? v : `-${Math.abs(v) >= 1000 ? Math.abs(v) / 1000 + 'K' : Math.abs(v)}` } } } }} />
              </div>
            </>
          )}

          {activeTab === 'members' && (
            <>
              <div className="chart-header">
                <div className="chart-subtitle">{stats.totalMembers} total members</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
                <div style={{ width: 140, height: 140, flexShrink: 0 }}>
                  <Doughnut data={memberDonutData} options={{ responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { display: false }, tooltip: { backgroundColor: CHART_BLACK, cornerRadius: 0 } } }} />
                </div>
                <div style={{ flex: 1 }}>
                  {[
                    { label: 'Active', count: activeCount, color: CHART_GREEN },
                    { label: 'Due Soon', count: dueSoonCount, color: '#e8a000' },
                    { label: 'Expired', count: expiredCount, color: CHART_RED },
                    { label: 'No Payment', count: noPayment, color: '#bbb' },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ width: 12, height: 12, background: item.color, flexShrink: 0, border: '2px solid #111' }}></span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                      <span style={{ fontWeight: 800, fontSize: 15, color: item.color }}>{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── This Month At-a-glance ─── */}
      <div className="month-summary">
        <div className="section-title">THIS MONTH</div>
        <div className="summary-grid">
          <div className="summary-item">
            <div className="summary-item-header">
              <div className={`summary-value ${isHidden('summary-rev') ? 'masked-value' : ''}`} style={{ color: CHART_ORANGE }}>
                {isHidden('summary-rev') ? '••••••' : formatPKR(stats.revenue)}
              </div>
              <button className="btn-hide-metric-xs" onClick={(e) => toggleMetric(e, 'summary-rev')}>
                {isHidden('summary-rev') ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </div>
            <div className="summary-label">Revenue</div>
          </div>
          <div className="summary-item">
            <div className="summary-item-header">
              <div className={`summary-value ${isHidden('summary-exp') ? 'masked-value' : ''}`} style={{ color: CHART_RED }}>
                {isHidden('summary-exp') ? '••••••' : formatPKR(stats.expenses)}
              </div>
              <button className="btn-hide-metric-xs" onClick={(e) => toggleMetric(e, 'summary-exp')}>
                {isHidden('summary-exp') ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </div>
            <div className="summary-label">Total Expenses</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>({formatPKR(stats.generalExpenses)} Exp + {formatPKR(stats.salaryTotal)} Salaries)</div>
          </div>
          <div className="summary-item">
            <div className="summary-item-header">
              <div className={`summary-value ${isHidden('summary-profit') ? 'masked-value' : ''}`} style={{ color: stats.profit >= 0 ? CHART_GREEN : CHART_RED }}>
                {isHidden('summary-profit') ? '••••••' : formatPKR(stats.profit)}
              </div>
              <button className="btn-hide-metric-xs" onClick={(e) => toggleMetric(e, 'summary-profit')}>
                {isHidden('summary-profit') ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </div>
            <div className="summary-label">Net Profit</div>
          </div>
        </div>
      </div>

    </div>
  );
}

