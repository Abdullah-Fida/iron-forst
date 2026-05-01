import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { formatPKR, getCurrentMonth, getCurrentYear, getMonthName } from '../../lib/utils';
import { EXPENSE_CATEGORIES } from '../../lib/constants';
import '../../styles/members.css';

export default function ExpenseSummaryPage() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState(getCurrentMonth());
  const year = getCurrentYear();
  
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchSummary = async () => {
      setLoading(true);
      try {
        const [paymentsRes, expensesRes, staffRes] = await Promise.all([
          api.get('/payments'),
          api.get('/expenses'),
          api.get('/staff')
        ]);

        if (!isMounted) return;

        const localPayments = paymentsRes.data.data || [];
        const localExpenses = expensesRes.data.data || [];
        const staffData = staffRes.data.data || [];
        
        const localStaffPayments = [];
        staffData.forEach(s => {
          if (s.staff_payments) s.staff_payments.forEach(p => localStaffPayments.push(p));
        });

        let filteredExpenses = localExpenses;
        let filteredPayments = localPayments;
        let filteredStaff = localStaffPayments;

        if (viewMode === 'this_year') {
          filteredExpenses = localExpenses.filter(e => new Date(e.expense_date).getFullYear() === year);
          filteredPayments = localPayments.filter(p => new Date(p.payment_date).getFullYear() === year);
          filteredStaff = localStaffPayments.filter(p => p.year === year);
        } else if (viewMode !== 'all_time') {
          // specific month of current year
          const m = Number(viewMode);
          filteredExpenses = localExpenses.filter(e => {
            const d = new Date(e.expense_date);
            return d.getFullYear() === year && (d.getMonth() + 1) === m;
          });
          filteredPayments = localPayments.filter(p => {
            const d = new Date(p.payment_date);
            return d.getFullYear() === year && (d.getMonth() + 1) === m;
          });
          filteredStaff = localStaffPayments.filter(p => p.year === year && p.month === m);
        }

        const rev = filteredPayments.reduce((s, p) => s + p.amount, 0);
        const exp = filteredExpenses.reduce((s, e) => s + e.amount, 0);
        const sal = filteredStaff.reduce((s, p) => s + Number(p.amount_paid), 0);
        const totalExp = exp + sal;

        const byCategory = {};
        filteredExpenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; });

        setSummary({
          revenue: rev,
          expenses: totalExp,
          profit: rev - totalExp,
          salaryOnly: sal,
          generalExpenseOnly: exp,
          byCategory
        });
      } catch (err) {
        console.error('Failed to compute summary from API:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    
    fetchSummary();
    return () => { isMounted = false; };
  }, [year, viewMode]);

  if (loading || !summary) return (
    <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <Loader2 className="spin" size={48} style={{ color: 'var(--primary)' }} />
    </div>
  );

  const revenue = summary.revenue || 0;
  const expenses = summary.expenses || 0;
  const profit = summary.profit || 0;
  const byCategory = summary.byCategory || {};

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <h1 className="page-title">Profit / Loss</h1>
      </div>

      <select className="form-select" style={{ marginBottom: 'var(--space-lg)' }} value={viewMode} onChange={e => setViewMode(e.target.value)}>
        <option value="this_year">This Year</option>
        <option value="all_time">All Time</option>
        <optgroup label="Specific Month (This Year)">
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>)}
        </optgroup>
      </select>

      {/* 4 Boxes Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <TrendingUp size={20} style={{ color: 'var(--status-active)', margin: '0 auto var(--space-xs)' }} />
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Revenue</div>
          <div style={{ fontSize: 'var(--font-md)', fontWeight: 800, color: 'var(--status-active)' }}>{formatPKR(revenue)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <Minus size={20} style={{ color: '#e84393', margin: '0 auto var(--space-xs)' }} />
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Staff Salaries</div>
          <div style={{ fontSize: 'var(--font-md)', fontWeight: 800, color: '#e84393' }}>{formatPKR(summary.salaryOnly || 0)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <Minus size={20} style={{ color: '#fdcb6e', margin: '0 auto var(--space-xs)' }} />
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>General Expenses</div>
          <div style={{ fontSize: 'var(--font-md)', fontWeight: 800, color: '#fdcb6e' }}>{formatPKR(summary.generalExpenseOnly || 0)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <Minus size={20} style={{ color: 'var(--status-danger)', margin: '0 auto var(--space-xs)' }} />
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Total All Expenses</div>
          <div style={{ fontSize: 'var(--font-md)', fontWeight: 800, color: 'var(--status-danger)' }}>{formatPKR(expenses)}</div>
        </div>
      </div>

      <div className="card" style={{ textAlign: 'center', border: `2px solid ${profit >= 0 ? 'rgba(0,184,148,0.3)' : 'rgba(255,118,117,0.3)'}`, marginBottom: 'var(--space-lg)' }}>
        {profit >= 0 ? <TrendingUp size={24} style={{ color: 'var(--status-active)', margin: '0 auto var(--space-xs)' }} /> : <TrendingDown size={24} style={{ color: 'var(--status-danger)', margin: '0 auto var(--space-xs)' }} />}
        <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>Net Profit</div>
        <div style={{ fontSize: 'var(--font-2xl)', fontWeight: 900, color: profit >= 0 ? 'var(--status-active)' : 'var(--status-danger)' }}>{formatPKR(profit)}</div>
      </div>

      {/* Category Breakdown */}
      <h3 className="section-title">Expense Breakdown</h3>
      <div className="card">
        {Object.entries(byCategory).map(([cat, amt]) => {
          const catInfo = EXPENSE_CATEGORIES.find(c => c.value === cat);
          const pct = expenses > 0 ? Math.round((amt / expenses) * 100) : 0;
          return (
            <div key={cat} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <span style={{ fontSize: 20 }}>{catInfo?.icon || '📦'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 'var(--font-sm)', fontWeight: 500 }}>{catInfo?.label || cat}</span>
                  <span style={{ fontSize: 'var(--font-sm)', fontWeight: 700 }}>{formatPKR(amt)}</span>
                </div>
                <div style={{ height: 4, background: 'var(--bg-tertiary)', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent-gradient)', borderRadius: 2, transition: 'width 0.5s ease' }}></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
