import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { ModernLoader } from '../../components/common/ModernLoader';
import { StateView } from '../../components/common/StateView';
import { getInitials } from '../../lib/utils';
import { STAFF_ROLES } from '../../lib/constants';
import api from '../../lib/api';
import '../../styles/members.css';
import '../../styles/loading.css';

export default function StaffListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [staffData, setStaffData] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchStaff = async () => {
      try {
        const res = await api.get('/staff');
        if (!isMounted) return;
        
        let localStaff = res.data.data || [];
        let activeStaff = localStaff.filter(s => s.status !== 'deleted');

        let results = activeStaff.map(s => {
          const staffPayments = s.staff_payments || [];
          
          let isPaid = false;
          if (staffPayments.length > 0) {
            const sorted = [...staffPayments].sort((a, b) => new Date(b.paid_date) - new Date(a.paid_date));
            const lastDate = new Date(sorted[0].paid_date);
            const today = new Date();
            today.setHours(0,0,0,0);
            lastDate.setHours(0,0,0,0);
            const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
            isPaid = diffDays <= 30;
          }

          return { ...s, staff_payments: staffPayments, isPaid };
        });

        setStaffData(results);
      } catch (err) {
        console.error('Staff API error:', err);
        if (isMounted) setStaffData([]);
      }
    };
    fetchStaff();
    return () => { isMounted = false; };
  }, []);

  const loading = !staffData;
  const staff = staffData || [];
  
  let filteredStaff = staff;
  if (filter !== 'all') {
    filteredStaff = staff.filter(s => s.status === filter);
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-lg)' }}>
        <div><h1 className="page-title">Staff</h1><p className="page-subtitle">{filteredStaff.length} staff members</p></div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/staff/add')}><UserPlus size={16} /> Add</button>
      </div>

      <div className="filter-tabs">
        {['all', 'active', 'inactive'].map(f => (
          <button key={f} className={`filter-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="staff-content">
        {loading ? (
          <div style={{ padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <ModernLoader type="morph" text="Syncing Staff..." />
          </div>
        ) : filteredStaff.length === 0 ? (
          <StateView 
            type="empty" 
            title="No staff members found" 
            description={filter !== 'all' ? "Try changing your filter settings." : "Start by adding your first gym staff member."}
          />
        ) : (
          filteredStaff.map(s => {
            const roleInfo = STAFF_ROLES.find(r => r.value === s.role);
            const isPaid = s.isPaid;
            return (
              <div key={s.id} className="card card-clickable" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-sm)' }}
                onClick={() => navigate(`/staff/${s.id}`)}>
                <div className="avatar" style={{ background: roleInfo?.color || 'var(--accent-gradient)' }}>{getInitials(s.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{s.phone}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="badge" style={{ background: roleInfo?.color + '22', color: roleInfo?.color, marginBottom: 4, display: 'block' }}>
                    {roleInfo?.label || s.custom_role || 'Staff'}
                  </span>
                  <span className={`badge ${isPaid ? 'badge-active' : 'badge-danger'}`} style={{ fontSize: 10 }}>
                    {isPaid ? '✓ PAID' : 'UNPAID'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
