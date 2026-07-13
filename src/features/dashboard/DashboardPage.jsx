import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, AlertTriangle, CalendarCheck, TrendingUp, DollarSign,
  UserPlus, CreditCard, Activity, Clock, AlertCircle, CalendarDays,
  TrendingDown, Zap, BarChart3, PieChart,
  ChevronRight, Loader2
} from 'lucide-react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
  Filler
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { StateView } from '../../components/common/StateView';
import { ModernLoader } from '../../components/common/ModernLoader';
import { useAuth } from '../../contexts/AuthContext';
import { formatPKR, formatDateShort, getMonthName, calculateMemberStatus } from '../../lib/utils';
import api from '../../lib/api';
import '../../styles/dashboard.css';
import '../../styles/loading.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend, Filler);

// ---------- Custom icon components for missing / problematic icons ----------
const ArrowUpRight = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="7 7 17 7 17 17" />
  </svg>
);

const ArrowDownRight = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <line x1="7" y1="7" x2="17" y2="17" />
    <polyline points="17 7 17 17 7 17" />
  </svg>
);

const Minus = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const Flame = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z" />
  </svg>
);
// ---------------------------------------------------------------------------

const C_TEAL = '#38bdf8';
const C_GREEN = '#34d399';
const C_RED = '#f87171';
const C_AMBER = '#fbbf24';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('revenue');

  const nowDt = new Date();
  const todayY = nowDt.getFullYear();
  const todayM = String(nowDt.getMonth() + 1).padStart(2, '0');
  const todayD = String(nowDt.getDate()).padStart(2, '0');
  const defaultToday = `${todayY}-${todayM}-${todayD}`;

  const [cashDate, setCashDate] = useState(defaultToday);
  const [membersAddedDate, setMembersAddedDate] = useState(defaultToday);
  const [membersExpiringDate, setMembersExpiringDate] = useState(defaultToday);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);

  const parseDateParts = (dateStr) => {
    if (!dateStr) return { y: 0, m: -1, d: 0 };
    const s = String(dateStr).slice(0, 10);
    const [y, m, d] = s.split('-').map(Number);
    return { y, m: m - 1, d };
  };

  const getPrevDateStr = (dateStr) => {
    const dt = new Date(dateStr);
    dt.setDate(dt.getDate() - 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  useEffect(() => {
    let isMounted = true;
    const fetchDashboard = async () => {
      setLoading(true);
      try {
        const [membersRes, paymentsRes, expensesRes, staffRes, attendanceRes] = await Promise.all([
          api.get('/members'),
          api.get('/payments'),
          api.get('/expenses'),
          api.get('/staff'),
          api.get('/attendance/report', { params: { month: new Date().getMonth() + 1, year: new Date().getFullYear() } })
        ]);
        if (!isMounted) return;

        const allMembers = membersRes.data.data || [];
        const allPayments = paymentsRes.data.data || [];
        const allExpenses = expensesRes.data.data || [];
        const staffData = staffRes.data.data || [];

        const byMember = attendanceRes.data.byMember || {};
        const topRegulars = Object.entries(byMember)
          .map(([id, count]) => {
            const member = allMembers.find(m => m.id === id);
            return { id, name: member ? member.name : 'Unknown', count };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        const allStaffPayments = [];
        staffData.forEach(s => {
          if (s.staff_payments) s.staff_payments.forEach(p => allStaffPayments.push(p));
        });

        const activeMembersList = allMembers.filter(m => m.status !== 'deleted');
        const membersWithStatus = activeMembersList.map(m => ({ ...m, status: calculateMemberStatus(m) }));

        const totalMembers = membersWithStatus.length;
        const activeMembers = membersWithStatus.filter(m => m.status === 'active').length;
        const expiredCount = membersWithStatus.filter(m => m.status === 'expired').length;

        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        const thisMonthPayments = allPayments.filter(p => {
          const { y, m } = parseDateParts(p.payment_date);
          return m === thisMonth && y === thisYear;
        });
        const revenue = thisMonthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

        const thisMonthExpenses = allExpenses.filter(e => {
          const { y, m } = parseDateParts(e.expense_date);
          return m === thisMonth && y === thisYear;
        });
        const monthGeneralExpenses = thisMonthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
        const thisMonthStaffPay = allStaffPayments.filter(p => p.month === thisMonth + 1 && p.year === thisYear);
        const salaryTotal = thisMonthStaffPay.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
        const totalExp = monthGeneralExpenses + salaryTotal;

        let currMembersAdded = 0, prevMembersAdded = 0;
        let currMembersExpiring = 0, prevMembersExpiring = 0;
        let nearExpire3Days = 0;

        const prevAddedStr = getPrevDateStr(membersAddedDate);
        const prevExpiringStr = getPrevDateStr(membersExpiringDate);

        membersWithStatus.forEach(m => {
          if (m.join_date) {
            const jStr = String(m.join_date).slice(0, 10);
            if (jStr === membersAddedDate) currMembersAdded++;
            if (jStr === prevAddedStr) prevMembersAdded++;
          }
          if (m.latest_expiry) {
            const eStr = String(m.latest_expiry).slice(0, 10);
            if (eStr === membersExpiringDate) currMembersExpiring++;
            if (eStr === prevExpiringStr) prevMembersExpiring++;
            if (m.status !== 'expired') {
              const target = new Date(m.latest_expiry);
              target.setHours(0, 0, 0, 0);
              const nowZ = new Date(); nowZ.setHours(0, 0, 0, 0);
              const days = Math.ceil((target - nowZ) / (1000 * 60 * 60 * 24));
              if (days >= 0 && days <= 3) nearExpire3Days++;
            }
          }
        });

        let currCash = 0, prevCash = 0;
        const prevCashStr = getPrevDateStr(cashDate);
        const planCounts = {};

        allPayments.forEach(p => {
          if (!p.payment_date) return;
          const dStr = String(p.payment_date).slice(0, 10);
          const amt = Number(p.amount || 0);
          if (dStr === cashDate) currCash += amt;
          if (dStr === prevCashStr) prevCash += amt;
          const { y, m } = parseDateParts(p.payment_date);
          if (m === thisMonth && y === thisYear && amt > 0) {
            const plan = p.plan_duration_months || 'Unknown';
            const key = String(plan) === 'custom' ? 'Custom Days' : `${plan} Month${plan > 1 ? 's' : ''}`;
            if (!planCounts[key]) planCounts[key] = { count: 0, revenue: 0 };
            planCounts[key].count += 1;
            planCounts[key].revenue += amt;
          }
        });

        const popularPlans = Object.entries(planCounts)
          .map(([label, data]) => ({ label, ...data }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 4);

        const recentPayments = [...allPayments]
          .sort((a, b) => new Date(b.created_at || b.payment_date) - new Date(a.created_at || a.payment_date))
          .slice(0, 5);

        const recentActivity = recentPayments.map(p => {
          const member = allMembers.find(m => m.id === p.member_id);
          return { ...p, member_name: member ? member.name : 'Unknown Member' };
        });

        const trend = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(); d.setMonth(d.getMonth() - i);
          const m = d.getMonth(), y = d.getFullYear();
          const mPayments = allPayments.filter(p => { const parts = parseDateParts(p.payment_date); return parts.m === m && parts.y === y; });
          const mExpenses = allExpenses.filter(e => { const parts = parseDateParts(e.expense_date); return parts.m === m && parts.y === y; });
          const mSal = allStaffPayments.filter(p => p.month === m + 1 && p.year === y).reduce((s, p) => s + Number(p.amount_paid || 0), 0);
          const mRev = mPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
          const mExp = mExpenses.reduce((s, e) => s + Number(e.amount || 0), 0) + mSal;
          trend.push({ month: m + 1, revenue: mRev, expenses: mExp, profit: mRev - mExp });
        }

        setDashboardData({
          stats: {
            totalMembers, activeMembers, expiredCount, dueSoonCount: nearExpire3Days,
            revenue, expenses: totalExp, salaryTotal, generalExpenses: monthGeneralExpenses,
            profit: revenue - totalExp,
            currCash, prevCash, currMembersAdded, prevMembersAdded,
            currMembersExpiring, prevMembersExpiring
          },
          popularPlans, recentActivity, revenueTrend: trend, topRegulars
        });
        setLoading(false);
      } catch (err) {
        console.error('Dash error:', err);
        if (isMounted) { setDashboardData({ error: true, msg: err.message }); setLoading(false); }
      }
    };
    fetchDashboard();
    return () => { isMounted = false; };
  }, [cashDate, membersAddedDate, membersExpiringDate]);

  if (loading && !dashboardData) {
    return (
      <div className="page-container dashboard-page" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '70vh' }}>
        <ModernLoader type="morph" text="Preparing Dashboard..." />
      </div>
    );
  }
  if (dashboardData?.error) return <div className="page-container"><StateView type="error" title="Dashboard Error" description={dashboardData.msg || 'Check connection.'} /></div>;

  const stats = dashboardData?.stats;
  const revenueTrend = dashboardData?.revenueTrend || [];
  const recentActivity = dashboardData?.recentActivity || [];
  const popularPlans = dashboardData?.popularPlans || [];
  const topRegulars = dashboardData?.topRegulars || [];

  const revenueData = revenueTrend.map(d => d.revenue);
  const expenseData = revenueTrend.map(d => d.expenses);
  const profitData = revenueTrend.map(d => d.profit);
  const trendLabels = revenueTrend.map(d => getMonthName(d.month).slice(0, 3));

  const activeCount = stats.activeMembers;
  const dueSoonCount = stats.dueSoonCount;
  const expiredCount = stats.expiredCount;
  const totalCount = stats.totalMembers;
  const noPayment = Math.max(0, totalCount - activeCount - dueSoonCount - expiredCount);

  const getDiff = (curr, prev, isMoney = false) => {
    const diff = curr - prev;
    if (diff === 0) return { label: 'Same as yesterday', dir: 'neutral' };
    const sign = diff > 0 ? '+' : '';
    const val = isMoney ? formatPKR(Math.abs(diff)) : Math.abs(diff);
    return { label: `${sign}${val} vs yesterday`, dir: diff > 0 ? 'up' : 'down' };
  };

  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: '#1a2630', titleColor: '#e6f1f6', bodyColor: '#b6c7d6', borderColor: '#243447', borderWidth: 1, cornerRadius: 8, padding: 10 }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#8ea2b5', font: { weight: '700', size: 11 } }, border: { color: 'transparent' } },
      y: { grid: { color: 'rgba(36,52,71,0.6)' }, ticks: { color: '#8ea2b5', font: { weight: '600', size: 10 }, callback: v => v >= 1000 ? `${v / 1000}K` : v }, border: { color: 'transparent' } }
    }
  };

  const revenueChartData = {
    labels: trendLabels,
    datasets: [
      { label: 'Revenue', data: revenueData, backgroundColor: 'rgba(56,189,248,0.85)', borderColor: C_TEAL, borderWidth: 0, borderRadius: 6, hoverBackgroundColor: C_TEAL },
      { label: 'Expenses', data: expenseData, backgroundColor: 'rgba(248,113,113,0.6)', borderColor: C_RED, borderWidth: 0, borderRadius: 6, hoverBackgroundColor: C_RED },
    ]
  };

  const profitChartData = {
    labels: trendLabels,
    datasets: [{
      label: 'Profit', data: profitData,
      borderColor: C_GREEN, backgroundColor: 'rgba(52,211,153,0.08)',
      borderWidth: 2.5,
      pointBackgroundColor: profitData.map(v => v >= 0 ? C_GREEN : C_RED),
      pointRadius: 5, pointHoverRadius: 7,
      tension: 0.4, fill: true,
    }]
  };

  const memberDonutData = {
    labels: ['Active', 'Due Soon', 'Expired', 'No Payment'],
    datasets: [{
      data: [activeCount, dueSoonCount, expiredCount, noPayment],
      backgroundColor: [C_GREEN, C_AMBER, C_RED, '#243447'],
      borderColor: ['#0b1116'], borderWidth: 3,
      hoverOffset: 8,
    }]
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const greetEmoji = hour < 12 ? '☀️' : hour < 17 ? '⚡' : '🌙';

  const QUICK_ACTIONS = [
    { icon: <UserPlus size={16} />, label: 'Add Member', path: '/members/add', color: 'qa-teal' },
    { icon: <CreditCard size={16} />, label: 'Collect Fee', path: '/payments/add', color: 'qa-green' },
    { icon: <AlertTriangle size={16} />, label: 'View Expired', path: '/members?status=expired', color: 'qa-red' },
    { icon: <CalendarCheck size={16} />, label: 'Attendance', path: '/attendance', color: 'qa-purple' },
  ];

  return (
    <div className="page-container dashboard-page">

      {/* ══════════════════════════════════════════
          HEADER
      ══════════════════════════════════════════ */}
      <div className="db-header">
        <div className="db-header-left">
          <span className="db-greeting-tag">{greetEmoji} {greeting}</span>
          <h1 className="db-title">Welcome, <span>{user?.name || 'Gym Owner'}</span></h1>
          <p className="db-subtitle">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="db-header-right">
          <div className="db-live-badge">
            <span className="db-live-dot" />
            LIVE DATA
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          QUICK ACTIONS
      ══════════════════════════════════════════ */}
      <div className="db-quick-actions">
        {QUICK_ACTIONS.map(qa => (
          <button key={qa.label} className={`db-qa-btn ${qa.color}`} onClick={() => navigate(qa.path)}>
            <span className="db-qa-icon">{qa.icon}</span>
            <span className="db-qa-label">{qa.label}</span>
            <ChevronRight size={13} className="db-qa-arrow" />
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════
          SECTION LABEL — DAILY SNAPSHOT
      ══════════════════════════════════════════ */}
      <div className="db-section-label">
        <Activity size={14} />
        Daily Snapshot
      </div>

      {/* ══════════════════════════════════════════
          KPI CARDS — 3 COLS
      ══════════════════════════════════════════ */}
      <div className="db-kpi-grid">

        {/* Cash Collected */}
        {(() => {
          const { label, dir } = getDiff(stats.currCash, stats.prevCash, true);
          return (
            <div className="db-kpi-card kpi-green">
              <div className="db-kpi-top">
                <div className="db-kpi-label">Cash Collected</div>
                <input type="date" className="db-mini-date" value={cashDate} onChange={e => setCashDate(e.target.value)} />
              </div>
              <div className="db-kpi-value">{loading ? <Loader2 className="spin-anim" size={24} style={{ opacity: 0.7 }} /> : formatPKR(stats.currCash)}</div>
              <div className={`db-kpi-diff diff-${dir}`}>
                {dir === 'up' && <ArrowUpRight size={12} />}
                {dir === 'down' && <ArrowDownRight size={12} />}
                {dir === 'neutral' && <Minus size={12} />}
                {label}
              </div>
              <div className="db-kpi-bg-icon"><DollarSign size={64} /></div>
            </div>
          );
        })()}

        {/* Members Added */}
        {(() => {
          const { label, dir } = getDiff(stats.currMembersAdded, stats.prevMembersAdded);
          return (
            <div className="db-kpi-card kpi-teal">
              <div className="db-kpi-top">
                <div className="db-kpi-label">Members Added</div>
                <input type="date" className="db-mini-date" value={membersAddedDate} onChange={e => setMembersAddedDate(e.target.value)} />
              </div>
              <div className="db-kpi-value">{loading ? <Loader2 className="spin-anim" size={24} style={{ opacity: 0.7 }} /> : stats.currMembersAdded}</div>
              <div className={`db-kpi-diff diff-${dir}`}>
                {dir === 'up' && <ArrowUpRight size={12} />}
                {dir === 'down' && <ArrowDownRight size={12} />}
                {dir === 'neutral' && <Minus size={12} />}
                {label}
              </div>
              <div className="db-kpi-bg-icon"><UserPlus size={64} /></div>
            </div>
          );
        })()}

        {/* Expiring Today */}
        {(() => {
          const { label, dir } = getDiff(stats.currMembersExpiring, stats.prevMembersExpiring);
          return (
            <div className="db-kpi-card kpi-red">
              <div className="db-kpi-top">
                <div className="db-kpi-label">Last Day</div>
                <input type="date" className="db-mini-date" value={membersExpiringDate} onChange={e => setMembersExpiringDate(e.target.value)} />
              </div>
              <div className="db-kpi-value">{loading ? <Loader2 className="spin-anim" size={24} style={{ opacity: 0.7 }} /> : stats.currMembersExpiring}</div>
              <div className={`db-kpi-diff diff-${dir}`}>
                {dir === 'up' && <ArrowUpRight size={12} />}
                {dir === 'down' && <ArrowDownRight size={12} />}
                {dir === 'neutral' && <Minus size={12} />}
                {label}
              </div>
              <div className="db-kpi-bg-icon"><AlertTriangle size={64} /></div>
            </div>
          );
        })()}

        {/* Expiring in 3 Days */}
        <div className="db-kpi-card" style={{ borderTop: '4px solid #fbbf24' }}>
          <div className="db-kpi-top">
            <div className="db-kpi-label">Expiring in 3 Days</div>
          </div>
          <div className="db-kpi-value">{loading ? <Loader2 className="spin-anim" size={24} style={{ opacity: 0.7 }} /> : stats.dueSoonCount}</div>
          <div className="db-kpi-diff diff-warning">
            <Clock size={12} /> Needs attention
          </div>
          <div className="db-kpi-bg-icon"><Clock size={64} /></div>
        </div>

      </div>

      {/* ══════════════════════════════════════════
          MONTHLY OVERVIEW ROW — 4 STAT PILLS
      ══════════════════════════════════════════ */}
      <div className="db-monthly-strip">
        <div className="db-monthly-card">
          <div className="db-monthly-icon icon-teal"><TrendingUp size={16} /></div>
          <div>
            <div className="db-monthly-label">Monthly Revenue</div>
            <div className="db-monthly-value text-teal">{formatPKR(stats.revenue)}</div>
          </div>
        </div>
        <div className="db-strip-divider" />
        <div className="db-monthly-card">
          <div className="db-monthly-icon icon-red"><TrendingDown size={16} /></div>
          <div>
            <div className="db-monthly-label">Total Expenses</div>
            <div className="db-monthly-value text-red">{formatPKR(stats.expenses)}</div>
          </div>
        </div>
        <div className="db-strip-divider" />
        <div className="db-monthly-card">
          <div className="db-monthly-icon" style={{ color: 'var(--status-active)', background: 'var(--status-active-bg)' }}><DollarSign size={16} /></div>
          <div>
            <div className="db-monthly-label">Net Profit</div>
            <div className="db-monthly-value" style={{ color: 'var(--status-active)' }}>{formatPKR(stats.profit)}</div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          MAIN CONTENT — 2 COLUMNS
      ══════════════════════════════════════════ */}
      <div className="db-main-grid">

        {/* ── LEFT COL ── */}
        <div className="db-left-col">

          {/* ─ Recent Payments ─ */}
          <div className="db-section-label">
            <CreditCard size={14} />
            Recent Payments
          </div>
          <div className="db-panel">
            {recentActivity.length > 0 ? (
              <div className="db-payments-list">
                {recentActivity.map((p, i) => (
                  <div key={i} className="db-payment-row">
                    <div className="db-payment-avatar">
                      {(p.member_name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="db-payment-info">
                      <div className="db-payment-name">{p.member_name}</div>
                      <div className="db-payment-date">{formatDateShort(p.payment_date || p.created_at)}</div>
                    </div>
                    <div className="db-payment-amount">+{formatPKR(p.amount)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="db-empty">No recent payments recorded.</div>
            )}
            <button className="db-view-all-btn" onClick={() => navigate('/payments')}>
              View All Payments <ChevronRight size={14} />
            </button>
          </div>

          {/* ─ Charts Panel ─ */}
          <div className="db-section-label" style={{ marginTop: 8 }}>
            <BarChart3 size={14} />
            Analytics
          </div>
          <div className="db-panel db-chart-panel">
            <div className="db-chart-tabs">
              {[
                { key: 'revenue', icon: <BarChart3 size={13} />, label: 'Revenue vs Expenses' },
                { key: 'members', icon: <PieChart size={13} />, label: 'Members' },
              ].map(t => (
                <button key={t.key} className={`db-chart-tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            <div className="db-chart-body">
              {activeTab === 'revenue' && (
                <>
                  <div className="db-chart-meta">
                    <div>
                      <div className="db-chart-title">Revenue vs Expenses</div>
                      <div className="db-chart-sub">Last 6 months · PKR</div>
                    </div>
                    <div className="db-chart-legend">
                      <span className="db-legend-dot" style={{ background: C_TEAL }} /> Revenue
                      <span className="db-legend-dot" style={{ background: C_RED, marginLeft: 12 }} /> Expenses
                    </div>
                  </div>
                  <div style={{ height: 240 }}>
                    <Bar data={revenueChartData} options={{ ...baseOpts, plugins: { ...baseOpts.plugins, tooltip: { ...baseOpts.plugins.tooltip, callbacks: { label: ctx => ` ${formatPKR(ctx.raw)}` } } } }} />
                  </div>
                </>
              )}
              {activeTab === 'members' && (
                <>
                  <div className="db-chart-meta">
                    <div>
                      <div className="db-chart-title">Member Distribution</div>
                      <div className="db-chart-sub">{stats.totalMembers} total members</div>
                    </div>
                  </div>
                  <div className="db-donut-wrap">
                    <div style={{ width: 200, height: 200, flexShrink: 0 }}>
                      <Doughnut data={memberDonutData} options={{ responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1a2630', cornerRadius: 8 } } }} />
                    </div>
                    <div className="db-donut-legend">
                      {[
                        { label: 'Active', count: activeCount, color: C_GREEN },
                        { label: 'Due Soon', count: dueSoonCount, color: C_AMBER },
                        { label: 'Expired', count: expiredCount, color: C_RED },
                        { label: 'No Payment', count: noPayment, color: '#243447' },
                      ].map(item => (
                        <div key={item.label} className="db-legend-row">
                          <span className="db-legend-swatch" style={{ background: item.color }} />
                          <span className="db-legend-name">{item.label}</span>
                          <span className="db-legend-cnt" style={{ color: item.color }}>{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>

        {/* ── RIGHT COL ── */}
        <div className="db-right-col">

          {/* ─ Membership Status ─ */}
          <div className="db-section-label">
            <AlertCircle size={14} />
            Membership Status
          </div>
          <div className="db-panel">
            <div className="db-status-list">
              <div className="db-status-row status-danger" onClick={() => navigate('/members?status=expired')}>
                <div className="db-status-left">
                  <div className="db-status-icon"><AlertCircle size={16} /></div>
                  <div>
                    <div className="db-status-label">Total Expired</div>
                    <div className="db-status-hint">Click to view</div>
                  </div>
                </div>
                <div className="db-status-count">{stats.expiredCount}</div>
              </div>

              <div className="db-status-row status-warning">
                <div className="db-status-left">
                  <div className="db-status-icon"><Clock size={16} /></div>
                  <div>
                    <div className="db-status-label">Expiring in 3 Days</div>
                    <div className="db-status-hint">Needs attention</div>
                  </div>
                </div>
                <div className="db-status-count">{stats.dueSoonCount}</div>
              </div>

              <div className="db-status-row status-success">
                <div className="db-status-left">
                  <div className="db-status-icon"><Users size={16} /></div>
                  <div>
                    <div className="db-status-label">Active Members</div>
                    <div className="db-status-hint">Out of {stats.totalMembers} total</div>
                  </div>
                </div>
                <div className="db-status-count">{stats.activeMembers}</div>
              </div>
            </div>
          </div>

          {/* ─ Monthly Financials ─ */}
          <div className="db-section-label" style={{ marginTop: 8 }}>
            <DollarSign size={14} />
            Monthly Financials
          </div>
          <div className="db-panel">
            <div className="db-fin-row">
              <span className="db-fin-label">Revenue</span>
              <span className="db-fin-val text-teal">{formatPKR(stats.revenue)}</span>
            </div>
            <div className="db-fin-breakdown">
              <div className="db-fin-sub-row">
                <span className="db-fin-sub-label">General Expenses</span>
                <span className="db-fin-sub-val">{formatPKR(stats.generalExpenses)}</span>
              </div>
              <div className="db-fin-sub-row">
                <span className="db-fin-sub-label">Staff Salaries</span>
                <span className="db-fin-sub-val">{formatPKR(stats.salaryTotal)}</span>
              </div>
            </div>
            <div className="db-fin-row">
              <span className="db-fin-label">Total Expenses</span>
              <span className="db-fin-val text-red">{formatPKR(stats.expenses)}</span>
            </div>
            <div className="db-fin-row" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-color)' }}>
              <span className="db-fin-label" style={{ fontWeight: 800 }}>Net Profit</span>
              <span className="db-fin-val" style={{ color: 'var(--status-active)', fontWeight: 800 }}>{formatPKR(stats.profit)}</span>
            </div>
          </div>

          {/* ─ Popular Plans ─ */}
          <div className="db-section-label" style={{ marginTop: 8 }}>
            <Flame size={14} />
            Popular Plans — This Month
          </div>
          <div className="db-panel">
            {popularPlans.length > 0 ? (
              <div className="db-plans-list">
                {popularPlans.map((plan, idx) => {
                  const maxRevenue = popularPlans[0].revenue;
                  const pct = maxRevenue > 0 ? (plan.revenue / maxRevenue) * 100 : 0;
                  return (
                    <div key={idx} className="db-plan-item">
                      <div className="db-plan-header">
                        <div>
                          <div className="db-plan-label">{plan.label}</div>
                          <div className="db-plan-count">{plan.count} purchase{plan.count !== 1 ? 's' : ''}</div>
                        </div>
                        <div className="db-plan-revenue">{formatPKR(plan.revenue)}</div>
                      </div>
                      <div className="db-plan-bar-track">
                        <div className="db-plan-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="db-empty">No plans sold this month.</div>
            )}
          </div>

          {/* ─ Most Regular Members ─ */}
          <div className="db-section-label" style={{ marginTop: 8 }}>
            <Activity size={14} />
            Most Regular Members
          </div>
          <div className="db-panel">
            {topRegulars.length > 0 ? (
              <div className="db-plans-list">
                {topRegulars.map((regular, idx) => {
                  const maxCount = topRegulars[0].count;
                  const pct = maxCount > 0 ? (regular.count / maxCount) * 100 : 0;
                  return (
                    <div key={idx} className="db-plan-item" onClick={() => navigate(`/members/${regular.id}`)} style={{ cursor: 'pointer' }}>
                      <div className="db-plan-header">
                        <div>
                          <div className="db-plan-label">{regular.name}</div>
                          <div className="db-plan-count">This Month</div>
                        </div>
                        <div className="db-plan-revenue" style={{ fontSize: '14px' }}>{regular.count} visits</div>
                      </div>
                      <div className="db-plan-bar-track">
                        <div className="db-plan-bar-fill" style={{ width: `${pct}%`, background: 'var(--accent-primary)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="db-empty">No attendance tracked yet.</div>
            )}
          </div>

        </div>
      </div>

    </div>
  );
}