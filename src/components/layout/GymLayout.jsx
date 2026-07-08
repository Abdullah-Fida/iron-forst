import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Settings, LogOut, Wifi, WifiOff, Cloud, Sun, Moon } from 'lucide-react';
import { useRef, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';

import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import MoreDrawer from './MoreDrawer';
import './layout.css';

import { getActiveMode, toggleMode } from '../../lib/theme';

export default function GymLayout() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { saveScroll, getScroll } = useNavigation();
  const online = true; // App is now fully online
  const mainRef = useRef(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [mode, setMode] = useState(getActiveMode());

  const handleToggleMode = () => {
    const next = toggleMode();
    setMode(next);
  };

  // Save scroll before route change
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const handleScroll = () => {
      saveScroll(location.pathname + location.search, main.scrollTop);
    };

    main.addEventListener('scroll', handleScroll);
    return () => main.removeEventListener('scroll', handleScroll);
  }, [location.pathname, location.search, saveScroll]);

  // Restore scroll and Verify session on route change
  useEffect(() => {
    const main = mainRef.current;
    if (main) {
      const saved = getScroll(location.pathname + location.search);
      // Small timeout to ensure content has rendered
      setTimeout(() => {
        main.scrollTo({ top: saved, behavior: 'instant' });
      }, 50);
    }

    // Proactive suspension check on every "page go"
    const checkSuspension = async () => {
      try {
        const { default: api } = await import('../../lib/api');
        await api.get('/auth/verify');
      } catch (e) {
        // Interceptor handles logout
      }
    };
    
    if (online) checkSuspension();
  }, [location.pathname, location.search, getScroll, online]);

  return (
    <div className="gym-layout">
      <Sidebar />
      <div className="gym-main-content">
        <header className="gym-header">
          <div className="gym-header-logo" onClick={() => navigate('/')}>
            <div className="logo-icon">{user?.gym_name ? user.gym_name.substring(0, 2).toUpperCase() : 'CG'}</div>
            <h1 style={{fontSize: '20px', letterSpacing: '-0.5px'}}>{user?.gym_name || 'IRON FOST'}</h1>
          </div>

          <div className="gym-header-actions">

            <button
              className="btn btn-icon theme-toggle-btn"
              onClick={handleToggleMode}
              title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {mode === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button className="btn btn-icon desktop-only" onClick={() => navigate('/settings')} title="Settings">
              <Settings size={18} />
            </button>
            <button className="btn btn-icon desktop-only" onClick={() => { logout(); navigate('/login'); }} title="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main ref={mainRef}>
          <Outlet />
        </main>

        <BottomNav onMoreClick={() => setIsMoreOpen(true)} />
        <MoreDrawer isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} />
      </div>
    </div>
  );
}
