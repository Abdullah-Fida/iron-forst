import { 
  Users, 
  CreditCard, 
  Receipt, 
  UserSquare, 
  CalendarCheck, 
  Settings, 
  LogOut,
  X,
  PlusCircle,
  FileText,
  ScanFace
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function MoreDrawer({ isOpen, onClose }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleAction = (path) => {
    navigate(path);
    onClose();
  };

  const menuItems = [
    { icon: Receipt, label: 'Expenses', path: '/expenses', color: '#f87171' },
    { icon: UserSquare, label: 'Staff', path: '/staff', color: '#60a5fa' },
    { icon: CalendarCheck, label: 'Attendance', path: '/attendance', color: '#34d399' },
    { icon: ScanFace, label: 'Machine', path: '/device', color: '#0891b2' },
    { icon: FileText, label: 'Reports', path: '/expenses/summary', color: '#fbbf24' },
    { icon: Settings, label: 'Settings', path: '/settings', color: '#8b5cf6' },
  ];

  return (
    <>
      <div className="more-drawer-backdrop" onClick={onClose} />
      <div className="more-drawer">
        <div className="more-drawer-header">
          <span className="more-drawer-title">Quick Access</span>
          <button className="more-drawer-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="more-drawer-grid">
          {menuItems.map((item) => (
            <button 
              key={item.label}
              className="more-drawer-item"
              onClick={() => handleAction(item.path)}
              style={{ '--item-color': item.color }}
            >
              <div className="more-drawer-icon">
                <item.icon size={24} color={item.color} />
              </div>
              <span className="more-drawer-label">{item.label}</span>
            </button>
          ))}
          
          <button 
            className="more-drawer-item logout"
            onClick={() => { logout(); navigate('/login'); }}
            style={{ '--item-color': 'var(--status-danger)' }}
          >
            <div className="more-drawer-icon">
              <LogOut size={24} color="var(--status-danger)" />
            </div>
            <span className="more-drawer-label">Logout</span>
          </button>
        </div>
      </div>
    </>
  );
}
