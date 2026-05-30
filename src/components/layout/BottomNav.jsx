import { Home, Users, CreditCard, LayoutGrid, Building2, AlertTriangle, LayoutDashboard, LogOut } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function BottomNav({ onMoreClick }) {
  const { isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  if (isAdmin) {
    return (
      <nav className="bottom-nav">
        <NavLink to="/admin/dashboard" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={22} />
          <span>Overview</span>
        </NavLink>
        <NavLink to="/admin/gyms" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <Building2 size={22} />
          <span>Gyms</span>
        </NavLink>
        <NavLink to="/admin/alerts" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <AlertTriangle size={22} />
          <span>Alerts</span>
        </NavLink>
        <button 
          className="bottom-nav-item" 
          onClick={() => { logout(); navigate('/login'); }}
          style={{ color: 'var(--status-danger)' }}
        >
          <LogOut size={22} />
          <span>Logout</span>
        </button>
      </nav>
    );
  }

  return (
    <nav className="bottom-nav">
      <NavLink to="/" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <Home size={22} />
        <span>Home</span>
      </NavLink>
      <NavLink to="/members" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <Users size={22} />
        <span>Members</span>
      </NavLink>
      <NavLink to="/action-center" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <AlertTriangle size={22} />
        <span>Action Center</span>
      </NavLink>
      <button className="bottom-nav-item" onClick={onMoreClick}>
        <LayoutGrid size={22} />
        <span>More</span>
      </button>
    </nav>
  );
}
