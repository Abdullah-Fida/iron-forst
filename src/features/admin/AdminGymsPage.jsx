import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Building2, Plus, Power, PowerOff, Loader2, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { formatDate, calculateHealthScore, getInitials } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import '../../styles/admin.css';

export default function AdminGymsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
  const [gyms, setGyms] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Add Gym modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGym, setNewGym] = useState({
    gym_name: '', owner_name: '', phone: '', email: '', password: '', city: '',
    default_monthly_fee: ''
  });

  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    async function fetchGyms() {
      setLoading(true);
      try {
        const params = { search, plan_type: planFilter };
        if (statusFilter === 'active') params.is_active = 'true';
        if (statusFilter === 'churned') params.is_active = 'false';
        
        const res = await api.get('/admin/gyms', { params });
        setGyms(res.data.data);
      } catch (err) {
        toast.error('Failed to fetch gyms');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchGyms();
  }, [search, planFilter, statusFilter, refresh]);

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/admin/gyms', newGym);
      toast.success(res.data.message || 'Gym registered successfully!');
      setShowAddModal(false);
      setNewGym({ gym_name: '', owner_name: '', phone: '', email: '', password: '', city: '', default_monthly_fee: '' });
      setRefresh(r => r + 1);
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to register gym';
      toast.error(msg);
      console.error('Registration error:', err.response?.data);
    } finally {
      setLoading(false);
    }
  };

  const toggleGym = async (e, id, currentStatus) => {
    e.stopPropagation(); // prevent row click
    try {
      await api.patch(`/admin/gyms/${id}/plan`, { is_active: !currentStatus });
      toast.success(`Gym ${!currentStatus ? 'activated' : 'suspended'} successfully.`);
      setRefresh(r => r + 1);
    } catch (err) {
      toast.error('Failed to update status');
    }
  };



  return (
    <div className="admin-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        <div>
          <h1 className="page-title">All Gyms</h1>
          <p className="page-subtitle">{gyms.length} gyms registered</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
          <Plus size={16} /> Add New Gym
        </button>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
          <Search />
          <input placeholder="Search gym, owner, city..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-select" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="churned">Churned / Suspended</option>
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={planFilter} onChange={e => setPlanFilter(e.target.value)}>
          <option value="">All Plans</option>
          <option value="free">Free</option>
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
        </select>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
          <Loader2 className="spin" size={40} />
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Gym Name</th>
                <th>Owner</th>
                <th>City</th>
                <th>Plan</th>
                <th>Members</th>
                <th>Last Login</th>
                <th>Health</th>
                <th>Access</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {gyms.map(g => {
                const health = calculateHealthScore(g);
                const hClass = health <= 30 ? 'red' : health <= 60 ? 'yellow' : 'green';
                return (
                  <tr key={g.id} className="clickable" onClick={() => navigate(`/admin/gyms/${g.id}`)}>
                    <td style={{ fontWeight: 600 }}>{g.gym_name}</td>
                    <td>{g.owner_name}</td>
                    <td>{g.city}</td>
                    <td><span className={`badge ${g.plan_type === 'pro' ? 'badge-active' : g.plan_type === 'basic' ? 'badge-info' : 'badge-neutral'}`}>{g.plan_type}</span></td>
                    <td>{g.members?.[0]?.count || 0}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}>{formatDate(g.last_login_at)}</td>
                    <td><span className={`health-badge ${hClass}`}>{health}</span></td>
                    <td>
                      <span className={`badge ${g.is_active ? 'badge-active' : 'badge-danger'}`}>
                        {g.is_active ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                        <button 
                          className={`btn btn-sm ${g.is_active ? 'btn-secondary' : 'btn-primary'}`} 
                          onClick={(e) => toggleGym(e, g.id, g.is_active)}
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          title={g.is_active ? 'Suspend Gym' : 'Activate Gym'}
                        >
                          {g.is_active ? <PowerOff size={14} /> : <Power size={14} />} 
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 'var(--space-md)' }}>Register New Gym</h2>
            <form onSubmit={handleAddSubmit}>
              <div className="form-group">
                <label className="form-label">Email (For Login)*</label>
                <input required type="email" className="form-input" value={newGym.email} onChange={e => setNewGym({...newGym, email: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Password*</label>
                <input required type="text" className="form-input" value={newGym.password} onChange={e => setNewGym({...newGym, password: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Gym Name*</label>
                <input required className="form-input" value={newGym.gym_name} onChange={e => setNewGym({...newGym, gym_name: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Owner Name*</label>
                <input required className="form-input" value={newGym.owner_name} onChange={e => setNewGym({...newGym, owner_name: e.target.value})} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={newGym.phone} onChange={e => setNewGym({...newGym, phone: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">City</label>
                  <input className="form-input" value={newGym.city} onChange={e => setNewGym({...newGym, city: e.target.value})} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Default Monthly Fee (For Gym Members)*</label>
                <input type="text" inputMode="numeric" className="form-input" placeholder="3000" value={newGym.default_monthly_fee} onChange={e => setNewGym({...newGym, default_monthly_fee: e.target.value})} />
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
                <button type="button" className="btn btn-secondary btn-block" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
                  {loading ? <Loader2 className="spin" size={18} /> : 'Create Gym'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
