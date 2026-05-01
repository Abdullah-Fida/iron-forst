import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { formatPKR, formatDate, getCurrentMonth, getCurrentYear, getMonthName } from '../../lib/utils';
import { EXPENSE_CATEGORIES } from '../../lib/constants';
import { MemberSkeleton, StateView } from '../../components/common/StateView';
import { ModernLoader } from '../../components/common/ModernLoader';
import api from '../../lib/api';
import { useConfirm } from '../../contexts/ConfirmContext';
import '../../styles/members.css';
import '../../styles/loading.css';

export default function ExpensesListPage() {
  const navigate = useNavigate();
  const [showStaffDetails, setShowStaffDetails] = useState(false);
  const [month, setMonth] = useState(getCurrentMonth());
  const [category, setCategory] = useState('');
  const year = getCurrentYear();
  const confirm = useConfirm();
  const [expenseData, setExpenseData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState([]);

  useEffect(() => {
    let isMounted = true;
    const fetchExpenses = async () => {
      if (isMounted) setIsLoading(true);
      try {
        const res = await api.get('/expenses', { params: { month, year, category } });
        if (isMounted) {
          setExpenseData(res.data.data || []);
        }
      } catch (err) {
        console.error('Expenses api error:', err);
        if (isMounted) setExpenseData([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    
    fetchExpenses();
    return () => { isMounted = false; };
  }, [month, year, category]);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: 'Delete Expense',
      message: 'Are you sure you want to delete this expense? This action cannot be undone.',
      confirmText: 'Delete',
      type: 'danger'
    });
    if (!confirmed) return;
    // Start animation
    setDeletingIds(prev => [...prev, id]);
    await new Promise(r => setTimeout(r, 400));
    
    try {
      await api.delete(`/expenses/${id}`);
      setExpenseData(prev => prev ? prev.filter(e => e.id !== id) : prev);
    } catch (err) {
      console.error('Failed to delete expense:', err);
      alert('Failed to delete expense');
      setDeletingIds(prev => prev.filter(delId => delId !== id)); // revert animation if failed
    }
  };

  const loading = isLoading;
  const allExpenses = expenseData || [];

  const staffSalaries = allExpenses.filter(e => e.is_staff_salary);
  const otherExpenses = allExpenses.filter(e => !e.is_staff_salary);
  const staffTotal = staffSalaries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const total = allExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const getCatIcon = (cat) => EXPENSE_CATEGORIES.find(c => c.value === cat)?.icon || '📦';

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-lg)' }}>
        <div><h1 className="page-title">Expenses</h1><p className="page-subtitle">{getMonthName(month)} {year}</p></div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/expenses/add')}><Plus size={16} /> Add</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
        <select className="form-select" value={month} onChange={e => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>)}
        </select>
        <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All Categories</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <div className="card" style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Total Expenses</div>
        <div style={{ fontSize: 'var(--font-2xl)', fontWeight: 800, color: 'var(--status-danger)' }}>{formatPKR(total)}</div>
      </div>

      <div className="expenses-content">
        {loading ? (
          <div style={{ padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <ModernLoader type="morph" text="Syncing Expenses..." />
          </div>
        ) : allExpenses.length === 0 ? (
          <StateView 
            type="empty" 
            title="No expenses found" 
            description={category ? "Try changing your category filter." : "No expenses recorded for this month."}
          />
        ) : (
          <div className="expense-list">
            {/* Staff Salary Group Card */}
            {staffSalaries.length > 0 && (
              <div style={{ marginBottom: 'var(--space-sm)' }}>
                <div className="card" 
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: 'var(--space-md)', 
                    borderLeft: '4px solid var(--status-active)', cursor: 'pointer',
                    background: showStaffDetails ? 'var(--bg-secondary)' : 'var(--bg-glass)'
                  }}
                  onClick={() => setShowStaffDetails(!showStaffDetails)}
                >
                  <div style={{ fontSize: 24, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,168,107,0.1)', borderRadius: '50%', color: 'var(--status-active)' }}>💰</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: 'var(--status-active)' }}>Staff Salaries</div>
                    <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                      {staffSalaries.length} staff members paid • {showStaffDetails ? 'Click to hide' : 'Click to view names'}
                    </div>
                  </div>
                  <div style={{ fontWeight: 800, color: 'var(--status-danger)' }}>{formatPKR(staffTotal)}</div>
                </div>

                {/* Individual Staff Salaries (Visible when expanded) */}
                {showStaffDetails && (
                  <div style={{ marginLeft: 'var(--space-md)', paddingLeft: 'var(--space-sm)', borderLeft: '2px dashed var(--border-color)', marginTop: 'var(--space-xs)' }}>
                    {staffSalaries.map(sp => (
                      <div key={sp.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: '4px', padding: '10px 15px', background: 'var(--bg-primary)' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)' }}>
                            {sp.description.includes(': ') ? sp.description.split(': ')[1] : sp.description}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Paid on: {formatDate(sp.expense_date)}</div>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 'var(--font-sm)', color: 'var(--status-danger)' }}>{formatPKR(sp.amount)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Regular Expenses */}
            {otherExpenses.map(exp => {
              const isDeleting = deletingIds.includes(exp.id);
              return (
                <div key={exp.id} className="card" 
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-sm)', cursor: 'pointer',
                    transform: isDeleting ? 'translateX(100px)' : 'none',
                    opacity: isDeleting ? 0 : 1,
                    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    pointerEvents: isDeleting ? 'none' : 'auto'
                  }}
                  onClick={() => navigate(`/expenses/${exp.id}/edit`)}>
                <div style={{ fontSize: 28, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', flexShrink: 0 }}>
                  {getCatIcon(exp.category)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{exp.custom_category || EXPENSE_CATEGORIES.find(c => c.value === exp.category)?.label}</div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{exp.description}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatDate(exp.expense_date)}{exp.is_recurring ? ' • 🔄 Recurring' : ''}
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--status-danger)', whiteSpace: 'nowrap' }}>{formatPKR(exp.amount)}</div>
                <button 
                  className="btn btn-icon" 
                  style={{ color: 'var(--status-danger)', background: 'rgba(255,118,117,0.1)' }}
                  onClick={(e) => handleDelete(e, exp.id)}
                  title="Delete Expense"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 'var(--space-lg)', textAlign: 'center' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/expenses/summary')}>📊 Profit/Loss Summary</button>
      </div>
    </div>
  );
}
