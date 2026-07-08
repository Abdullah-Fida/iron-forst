import { Home, Users, AlertTriangle, LayoutGrid } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export default function BottomNav({ onMoreClick }) {
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

