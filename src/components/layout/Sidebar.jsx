import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { 
  Home, Users, CreditCard, Bell, ClipboardList, 
  Dumbbell, Receipt, BarChart2, TrendingUp, Settings, 
  DollarSign, LogOut, ChevronRight, CheckCircle, Fingerprint
} from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import './layout.css';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await api.get('/members');
        const localMembers = res.data.data || [];
        const now = new Date();
        let count = 0;
        
        localMembers.forEach(m => {
          if (!m.latest_expiry || m.status === 'inactive' || m.status === 'deleted') return;
          const expiryDate = new Date(m.latest_expiry);
          const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 3) count++;
        });
        setPendingCount(count);
      } catch (err) {
        console.error('Failed to calculate notification count', err);
      }
    };
    fetchCount();
  }, []);

  const menuGroups = [
    {
      title: 'Main',
      items: [
        { path: '/dashboard', icon: Home, label: 'Dashboard' },
        { path: '/members', icon: Users, label: 'Members' },
        { path: '/attendance', icon: Fingerprint, label: 'Gate & Attendance' },
        { path: '/notifications', icon: Bell, label: 'Alerts', badge: pendingCount },
      ]
    },
    {
      title: 'Finance',
      items: [
        { path: '/payments', icon: DollarSign, label: 'Payments', end: true, extraActivePaths: ['/payments/add'] },
        { path: '/payments/pending', icon: CreditCard, label: 'Unpaid Fees' },
        { path: '/payments/revenue', icon: BarChart2, label: 'Revenue' },
        { path: '/expenses', icon: Receipt, label: 'Expenses', end: true, extraActivePaths: ['/expenses/add', '/expenses/:id/edit'] },
        { path: '/expenses/summary', icon: TrendingUp, label: 'Profit / Loss' },
      ]
    },
    {
      title: 'Management',
      items: [
        { path: '/staff', icon: Dumbbell, label: 'Staff' },
        { path: '/settings', icon: Settings, label: 'Settings' },
      ]
    }
  ];

  const isMenuItemActive = (item, isActive) => {
    if (isActive) return true;
    if (!item.extraActivePaths?.length) return false;

    return item.extraActivePaths.some((pathPattern) => (
      Boolean(matchPath({ path: pathPattern, end: true }, location.pathname))
    ));
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon">{user?.gym_name ? user.gym_name.substring(0, 2).toUpperCase() : 'CG'}</div>
        <h1>{user?.gym_name || 'CoreGym'}</h1>
      </div>

      <nav className="sidebar-nav">
        {menuGroups.map((group, idx) => (
          <div key={idx} className="sidebar-group">
            <div className="sidebar-group-title">{group.title}</div>
            {group.items.map(item => (
              <NavLink 
                key={item.path} 
                to={item.path} 
                end={item.end}
                className={({ isActive }) => `sidebar-item ${isMenuItemActive(item, isActive) ? 'active' : ''}`}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
                {item.badge > 0 && <span className="sidebar-badge">{item.badge}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-item sidebar-logout" onClick={() => { logout(); navigate('/login'); }}>
          <LogOut size={20} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
