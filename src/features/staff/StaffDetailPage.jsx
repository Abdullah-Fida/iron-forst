import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, CreditCard, Trash2, CalendarCheck, Loader2, Printer } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { getInitials, formatPKR, formatDate, getCurrentMonth, getCurrentYear, getMonthName, generateId } from '../../lib/utils';
import { STAFF_ROLES, PAYMENT_METHODS } from '../../lib/constants';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { ModernLoader } from '../../components/common/ModernLoader';
import { printThermalReceipt } from '../../lib/thermalPrinter';
import '../../styles/members.css';

export default function StaffDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  
  const [staff, setStaff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayForm, setShowPayForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteOptions, setShowDeleteOptions] = useState(false);
  const [payForm, setPayForm] = useState({ 
    amount_paid: '', 
    paid_date: new Date().toISOString().split('T')[0], 
    payment_method: 'cash', 
    notes: '' 
  });

  const month = getCurrentMonth();
  const year = getCurrentYear();

  useEffect(() => {
    const fetchStaff = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/staff/${id}`);
        const s = res.data.data;
        if (s) {
          setStaff(s);
          setPayForm(p => ({ ...p, amount_paid: String(s.monthly_salary) }));
        } else {
          toast.error('Staff member not found');
        }
      } catch (err) {
        console.error('Failed to fetch staff member', err);
        toast.error('Staff member not found');
      } finally {
        setLoading(false);
      }
    };
    fetchStaff();
  }, [id]);

  if (loading) return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <ModernLoader type="morph" text="Loading Staff Profile..." />
    </div>
  );

  if (!staff) return <div className="page-container"><p>Staff not found</p></div>;

  const salaryHistory = staff.staff_payments || [];
  
  let isPaid = false;
  if (salaryHistory.length > 0) {
    const sorted = [...salaryHistory].sort((a, b) => new Date(b.paid_date) - new Date(a.paid_date));
    const lastDate = new Date(sorted[0].paid_date);
    const today = new Date();
    today.setHours(0,0,0,0);
    lastDate.setHours(0,0,0,0);
    const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
    isPaid = diffDays <= 30;
  }
  const roleInfo = STAFF_ROLES.find(r => r.value === staff.role);

  const handlePaySalary = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const pid = generateId();
      const payload = { 
        id: pid,
        staff_id: id,
        month, 
        year, 
        amount_paid: Number(payForm.amount_paid), 
        paid_date: payForm.paid_date, 
        payment_method: payForm.payment_method, 
        notes: payForm.notes,
      };
      await api.post(`/staff/${id}/salary`, payload);

      toast.success(`Salary marked as paid for ${staff.name}!`);
      setShowPayForm(false);

      // Auto-print salary receipt
      printSalaryReceipt({
        id: pid,
        staffName: staff.name,
        staffPhone: staff.phone,
        amount: Number(payForm.amount_paid),
        month, year,
        paidDate: payForm.paid_date,
        paymentMethod: payForm.payment_method,
        gymName: user?.gym_name || 'IRON FOST',
      });
      
      // Refresh from API
      const res = await api.get(`/staff/${id}`);
      if (res.data.data) setStaff(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to log salary payment');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (permanent = false) => {
    setShowDeleteOptions(false);
    try {
      if (permanent) {
        await api.delete(`/staff/${id}?permanent=true`);
        toast.success(`${staff.name} and all records permanently deleted`);
      } else {
        await api.delete(`/staff/${id}`);
        toast.success(`${staff.name} removed (financial history preserved)`);
      }
      navigate('/staff');
    } catch (err) {
      console.error('Failed to delete staff', err);
      toast.error('Failed to remove staff');
    }
  };

  const printSalaryReceipt = (data) => {
    printThermalReceipt({
      gymName: user?.gym_name || 'IRON FOST',
      invoiceId: data.id,
      memberName: data.staffName,
      memberPhone: data.staffPhone,
      amount: data.amount,
      paymentDate: data.paidDate,
      paymentMethod: data.paymentMethod,
      reason: `Salary — ${getMonthName(data.month)} ${data.year}`,
    });
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
        <button className="btn btn-icon btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>Staff Profile</span>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
        <div className="avatar avatar-xl" style={{ background: roleInfo?.color || 'var(--accent-gradient)', margin: '0 auto var(--space-md)' }}>{getInitials(staff.name)}</div>
        <h2>{staff.name}</h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>{staff.phone}</div>
        <div style={{ marginTop: 'var(--space-sm)', display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center' }}>
          <span className="badge" style={{ background: (roleInfo?.color || '#6c5ce7') + '22', color: roleInfo?.color }}>{roleInfo?.label || staff.custom_role}</span>
          <span className={`badge ${isPaid ? 'badge-active' : 'badge-danger'}`}>{isPaid ? 'Paid' : 'Unpaid'} ({getMonthName(month)})</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Monthly Salary</div>
          <div style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>{formatPKR(staff.monthly_salary)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Joined Date</div>
          <div style={{ fontSize: 'var(--font-sm)' }}>{formatDate(staff.join_date)}</div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <button className="btn btn-secondary" onClick={() => navigate(`/staff/${id}/edit`)}><Edit size={16} /> Edit</button>
        {!isPaid && <button className="btn btn-primary" onClick={() => setShowPayForm(true)}><CreditCard size={16} /> Pay Salary</button>}
        {isPaid && <button className="btn btn-secondary" disabled>✓ Paid</button>}
        <button className="btn btn-danger" style={{ gridColumn: '1 / -1' }} onClick={() => setShowDeleteOptions(true)}><Trash2 size={16} /> Delete Staff Member</button>
      </div>

      {/* Pay Salary Form */}
      {showPayForm && (
        <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--space-md)' }}>Log Salary Payment</h3>
          <form onSubmit={handlePaySalary}>
            <div className="form-group"><label className="form-label">Amount Paid</label><input className="form-input" type="text" inputMode="numeric" value={payForm.amount_paid} onChange={e => setPayForm(p => ({ ...p, amount_paid: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={payForm.paid_date} onChange={e => setPayForm(p => ({ ...p, paid_date: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Payment Method</label><select className="form-select" value={payForm.payment_method} onChange={e => setPayForm(p => ({ ...p, payment_method: e.target.value }))}>{PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <button type="submit" className="btn btn-primary btn-block" disabled={isSaving}>
                {isSaving ? <Loader2 className="spin" size={18} /> : 'Log Salary'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowPayForm(false)} disabled={isSaving}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Salary History */}
      <h3 className="section-title">Salary History</h3>
      <div className="card">
        {salaryHistory.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-md)' }}>No payments yet</p>
        ) : (
          salaryHistory.map(sp => (
            <div key={sp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{getMonthName(sp.month)} {sp.year}</div>
                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{formatDate(sp.paid_date)} • {sp.payment_method}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <div style={{ fontWeight: 700, color: 'var(--status-active)' }}>{formatPKR(sp.amount_paid)}</div>
                <button
                  className="btn btn-icon btn-secondary"
                  style={{ padding: 6, minWidth: 'auto' }}
                  title="Print Receipt"
                  onClick={() => {
                    printSalaryReceipt({
                      id: sp.id,
                      staffName: staff.name,
                      staffPhone: staff.phone,
                      amount: sp.amount_paid,
                      month: sp.month, year: sp.year,
                      paidDate: sp.paid_date,
                      paymentMethod: sp.payment_method,
                      gymName: user?.gym_name || 'IRON FOST',
                    });
                  }}
                >
                  <Printer size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      {/* DELETE OPTIONS MODAL */}
      {showDeleteOptions && (
        <div className="modal-backdrop" style={{ alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', zIndex: 1000 }} onClick={() => setShowDeleteOptions(false)}>
          <div style={{ 
            backgroundColor: 'var(--bg-secondary)',
            maxWidth: 450, 
            width: '90%',
            borderRadius: '28px', 
            border: '1px solid var(--border-color)', 
            textAlign: 'center', 
            padding: 'var(--space-xl)',
            margin: '0 var(--space-md)',
            animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            boxShadow: 'var(--shadow-2xl)',
            position: 'relative'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <div style={{ 
                width: 74, 
                height: 74, 
                background: 'rgba(248, 113, 113, 0.1)', 
                borderRadius: '22px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                margin: '0 auto 24px',
                border: '1px solid rgba(248, 113, 113, 0.2)'
              }}>
                <Trash2 size={36} color="var(--status-danger)" />
              </div>
              <h2 style={{ fontSize: 'var(--font-xl)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Delete Staff Member</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)', lineHeight: 1.6 }}>
                Choose how you want to remove <strong>{staff.name}</strong>.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button className="btn btn-secondary" style={{ 
                textAlign: 'center', 
                padding: '16px', 
                display: 'block', 
                width: '100%', 
                height: 'auto',
                borderRadius: '16px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)'
              }} onClick={() => handleDelete(false)}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 'var(--font-base)' }}>Option 1: Delete Profile Only</div>
              </button>

              <button className="btn btn-danger" style={{ 
                textAlign: 'center', 
                padding: '16px', 
                display: 'block', 
                width: '100%', 
                height: 'auto',
                borderRadius: '16px',
                background: 'rgba(248, 113, 113, 0.05)',
                border: '1px solid rgba(248, 113, 113, 0.2)'
              }} onClick={() => handleDelete(true)}>
                <div style={{ fontWeight: 700, color: 'var(--status-danger)', fontSize: 'var(--font-base)' }}>Option 2: Delete Everything (Permanent)</div>
              </button>

              <button className="btn btn-secondary" style={{ marginTop: 12, width: '100%' }} onClick={() => setShowDeleteOptions(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

