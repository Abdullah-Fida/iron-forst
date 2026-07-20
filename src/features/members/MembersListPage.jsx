import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, UserPlus, Trash2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getInitials, daysFromNow, formatDateShort, calculateMemberStatus } from '../../lib/utils';
import { MemberSkeleton, StateView } from '../../components/common/StateView';
import { ModernLoader } from '../../components/common/ModernLoader';
import api from '../../lib/api';
import '../../styles/members.css';
import '../../styles/loading.css';

export default function MembersListPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [genderFilter, setGenderFilter] = useState(searchParams.get('gender') || 'all');
  const [sort, setSort] = useState('name');
  const [errorDetail, setErrorDetail] = useState(null);
  

  const [membersData, setMembersData] = useState(null);

  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const res = await api.get('/members');
        let results = res.data.data || [];
        results = results.filter(m => m.status !== 'deleted');
        
        results = results.map(m => {
           let lastPayDate = null;
           if (m.payments && m.payments.length > 0) {
             const sorted = [...m.payments].sort((a,b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());
             lastPayDate = sorted[0].payment_date;
           }
           const status = calculateMemberStatus(m);
           return { ...m, status, lastPayDate };
        });
        setMembersData(results);
      } catch (err) {
        console.error(err);
        setMembersData([]);
      }
    };
    fetchMembers();
  }, []);

  const processedMembers = (() => {
    if (!membersData) return null;
    let results = [...membersData];
    
    if (search) {
      const s = search.toLowerCase();
      results = results.filter(m => {
        const nameMatch = (m.name || '').toLowerCase().includes(s);
        const phoneMatch = String(m.phone || '').includes(s);
        const idMatch = (m.membership_id || '').toLowerCase().includes(s);
        return nameMatch || phoneMatch || idMatch;
      });
    }
    
    if (statusFilter !== 'all') {
      results = results.filter(m => m.status === statusFilter);
    }
    
    if (genderFilter !== 'all') {
      results = results.filter(m => m.gender === genderFilter);
    }
    
    if (sort === 'name') {
      results.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sort === 'join_date') {
      results.sort((a, b) => {
        const da = a.join_date ? new Date(a.join_date).getTime() : 0;
        const db2 = b.join_date ? new Date(b.join_date).getTime() : 0;
        return db2 - da;
      });
    } else if (sort === 'overdue') {
      results.sort((a, b) => {
        let aExp = a.latest_expiry;
        if (!aExp && a.payments && a.payments.length > 0) {
          const sortedA = [...a.payments].sort((x, y) => new Date(y.expiry_date || y.payment_date || 0) - new Date(x.expiry_date || x.payment_date || 0));
          aExp = sortedA[0].expiry_date || sortedA[0].payment_date;
        }
        let bExp = b.latest_expiry;
        if (!bExp && b.payments && b.payments.length > 0) {
          const sortedB = [...b.payments].sort((x, y) => new Date(y.expiry_date || y.payment_date || 0) - new Date(x.expiry_date || x.payment_date || 0));
          bExp = sortedB[0].expiry_date || sortedB[0].payment_date;
        }
        const da = aExp ? daysFromNow(aExp) : 9999;
        const db2 = bExp ? daysFromNow(bExp) : 9999;
        return da - db2;
      });
    }
    return results;
  })();

  const loading = !membersData;
  const members = processedMembers || [];
  const totalCount = members.length;

  const [deleteModal, setDeleteModal] = useState({ isOpen: false, memberId: null, name: '' });
  const [deletingIds, setDeletingIds] = useState([]);

  const handleDeleteMember = (e, id, name) => {
    e.stopPropagation();
    setDeleteModal({ isOpen: true, memberId: id, name });
  };

  const processDeletion = async (permanent = false) => {
    const { memberId, name } = deleteModal;
    setDeleteModal({ isOpen: false, memberId: null, name: '' });
    
    // Start animation
    setDeletingIds(prev => [...prev, memberId]);
    await new Promise(r => setTimeout(r, 400));

    try {
      if (permanent) {
        await api.delete(`/members/${memberId}?permanent=true`);
        toast.success(`${name} and all associated records permanently deleted`);
      } else {
        await api.delete(`/members/${memberId}`);
        toast.success(`${name} removed (financial records preserved)`);
      }
      setMembersData(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      console.error('Failed to delete member locally', err);
      toast.error('Could not delete.');
      setDeletingIds(prev => prev.filter(id => id !== memberId)); // revert animation if failed
    }
  };

  const tabs = [
    { key: 'all', label: `All` },
    { key: 'active', label: `Active` },
    { key: 'trial', label: `Trial` },
    { key: 'inactive', label: `Inactive` },
    { key: 'due_soon', label: `Due Soon` },
    { key: 'expired', label: `Expired` },
  ];

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Members</h1>
          <p className="page-subtitle">{totalCount} total members</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/members/add')}>
          <UserPlus size={16} /> Add
        </button>
      </div>

      {/* Search */}
      <div className="search-bar">
        <Search />
        <input placeholder="Search by name, phone or ID..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Filter Tabs */}
      <div className="filter-tabs">
        {tabs.map(t => (
          <button key={t.key} className={`filter-tab ${statusFilter === t.key ? 'active' : ''}`} onClick={() => setStatusFilter(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Sort & Gender */}
      <div style={{ marginBottom: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)' }}>
        <select className="form-select" style={{ padding: '8px 12px', fontSize: 'var(--font-xs)', flex: 1 }} value={sort} onChange={e => setSort(e.target.value)}>
          <option value="name">A → Z</option>
          <option value="join_date">Newest First</option>
          <option value="overdue">Most Overdue</option>
        </select>

        <select className="form-select" style={{ padding: '8px 12px', fontSize: 'var(--font-xs)', flex: 1 }} value={genderFilter} onChange={e => setGenderFilter(e.target.value)}>
          <option value="all">All Genders</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>

      {/* States: Loading -> Error -> Empty -> List */}
      <div className="members-content">
        {loading ? (
          <div style={{ padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <ModernLoader type="morph" text="Syncing Member Directory..." />
          </div>
        ) : members.length === 0 ? (
          <StateView 
            type="empty" 
            title="No members found" 
            description={search || statusFilter !== 'all' ? "Try changing your search or filters." : "Start by adding your first gym member."}
          />
        ) : (
          members.map(member => {
            let actualExpiry = member.latest_expiry;
            if (!actualExpiry && member.payments && member.payments.length > 0) {
              const sorted = [...member.payments].sort((a, b) => new Date(b.expiry_date || b.payment_date || 0) - new Date(a.expiry_date || a.payment_date || 0));
              actualExpiry = sorted[0].expiry_date || sorted[0].payment_date;
            }
            const days = actualExpiry ? daysFromNow(actualExpiry) : null;
            const isExpired = member.status === 'expired' || (days !== null && days < 0);
            const isDueSoon = member.status === 'due_soon' || (days !== null && days >= 0 && days <= 3);

            return (
              <div 
                key={member.id} 
                className="member-card" 
                onClick={() => navigate(`/members/${member.id}`)}
                style={deletingIds.includes(member.id) ? { transform: 'translateX(100px)', opacity: 0, transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)', pointerEvents: 'none' } : { transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}
              >
                <div className="avatar" style={{
                  background: isExpired ? 'var(--status-danger-bg)' : isDueSoon ? 'var(--status-warning-bg)' : (member.status === 'inactive' || days === null) ? 'var(--bg-secondary)' : 'var(--accent-gradient)',
                  color: isExpired ? 'var(--status-danger)' : isDueSoon ? 'var(--status-warning)' : (member.status === 'inactive' || days === null) ? 'var(--text-muted)' : 'white'
                }}>
                  {getInitials(member.name || '??')}
                </div>
                <div className="member-info">
                  <div className="member-name">
                    {member.name} {member.gender === 'female' ? '👩' : member.gender === 'male' ? '👨' : ''}
                  </div>
                  <div className="member-phone">
                    {member.phone} {member.membership_id ? `• ID: ${member.membership_id}` : ''}
                  </div>
                  {member.status === 'trial' && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Trial Mode</div>
                  )}
                </div>
                <div className="member-meta">
                  <span className={`badge badge-${member.status === 'trial' ? 'secondary' : (member.status === 'active' && days !== null) ? 'active' : member.status === 'due_soon' ? 'warning' : member.status === 'expired' ? 'danger' : 'secondary'}`}>
                    <span className={`badge-dot ${member.status === 'trial' ? 'secondary' : (member.status === 'active' && days !== null) ? 'active' : member.status === 'due_soon' ? 'warning' : member.status === 'expired' ? 'danger' : 'secondary'}`}></span>
                    {(member.status === 'active' && days !== null) ? 'Active' : member.status === 'due_soon' ? 'Due Soon' : member.status === 'expired' ? 'Expired' : member.status === 'trial' ? 'Trial' : 'Inactive'}
                  </span>
                  <div className="member-days" style={{ color: isExpired ? 'var(--status-danger)' : isDueSoon ? 'var(--status-warning)' : member.status === 'inactive' ? 'var(--text-muted)' : 'var(--status-active)' }}>
                    {days === null ? 'No payment' : isExpired ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d left`}
                  </div>
                  {member.lastPayDate && (
                     <div className="member-last-pay">Last: {formatDateShort(member.lastPayDate)}</div>
                  )}
                </div>
                
                <button 
                  className="btn-icon-danger" 
                  style={{ marginLeft: 'var(--space-sm)', padding: 8, background: 'none', border: 'none', color: 'var(--status-danger)', cursor: 'pointer' }}
                  onClick={(e) => handleDeleteMember(e, member.id, member.name)}
                  title="Delete Member"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* ERROR DETAIL MODAL (The 'proper way to tell the issue') */}
      {errorDetail && (
        <div className="modal-backdrop" onClick={() => setErrorDetail(null)}>
          <div className="modal-content" style={{ maxWidth: 500, borderColor: 'var(--status-danger)', borderStyle: 'solid' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ color: 'var(--status-danger)', marginBottom: 'var(--space-md)' }}>❌ Link-data Conflict</h2>
            <div style={{ background: '#f8f8f8', padding: 'var(--space-md)', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'monospace', fontSize: 12, marginBottom: 'var(--space-md)', color: '#444', overflowX: 'auto' }}>
              <p><strong>ISSUE:</strong> {errorDetail.title}</p>
              <hr style={{ margin: '10px 0' }} />
              <p><strong>DB DETAIL:</strong> {errorDetail.detail}</p>
              {errorDetail.hint && <p style={{ marginTop: 5, color: 'var(--primary)', fontWeight: 700 }}><strong>HINT:</strong> {errorDetail.hint}</p>}
            </div>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-lg)' }}>
              This member cannot be deleted yet because they have hidden records (like old notifications or logs). Contact system support or try clearing their data first.
            </p>
            <button className="btn btn-primary btn-block" onClick={() => setErrorDetail(null)}>Close Diagnostic</button>
          </div>
        </div>
      )}
      {/* DELETE OPTIONS MODAL */}
      {deleteModal.isOpen && (
        <div className="modal-backdrop" style={{ alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', zIndex: 1000 }} onClick={() => setDeleteModal({ isOpen: false, memberId: null, name: '' })}>
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
              <h2 style={{ fontSize: 'var(--font-xl)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Delete Member</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)', lineHeight: 1.6 }}>
                How would you like to remove <strong>{deleteModal.name}</strong>?
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
              }} onClick={() => processDeletion(false)}>
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
              }} onClick={() => processDeletion(true)}>
                <div style={{ fontWeight: 700, color: 'var(--status-danger)', fontSize: 'var(--font-base)' }}>Option 2: Delete Everything (Permanent)</div>
              </button>

              <button className="btn btn-secondary" style={{ marginTop: 12, width: '100%' }} onClick={() => setDeleteModal({ isOpen: false, memberId: null, name: '' })}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
