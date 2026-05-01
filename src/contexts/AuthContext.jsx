import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '../lib/api';


const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('core_gym_user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = useCallback(async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const data = response.data;

      if (data.success) {
        const keysToKeep = ['core_gym_theme'];
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && !keysToKeep.includes(key)) localStorage.removeItem(key);
        }


        const gymUser = {
          email,
          role: data.role,
          name: data.role === 'admin' ? 'Super Admin' : data.gym.owner_name,
          gym_id: data.gym?.id,
          gym_name: data.gym?.gym_name,
          token: data.token
        };
        localStorage.setItem('core_gym_user', JSON.stringify(gymUser));
        setUser(gymUser);



        return { success: true, role: data.role };
      }
      return { success: false, error: 'Login failed' };
    } catch (err) {
      if (err.response && err.response.data && err.response.data.message) {
        return { success: false, error: err.response.data.message };
      }
      return { success: false, error: 'Network error or backend is not running.' };
    }
  }, []);

  const switchSession = useCallback(async (data) => {

    const keysToKeep = ['core_gym_theme'];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && !keysToKeep.includes(key)) localStorage.removeItem(key);
    }


    const gymUser = {
      email: data.gym.email,
      role: data.role,
      name: data.gym.owner_name,
      gym_id: data.gym.id,
      token: data.token
    };
    localStorage.setItem('core_gym_user', JSON.stringify(gymUser));
    setUser(gymUser);


  }, []);


  const logout = useCallback(async () => {

    const keysToKeep = ['core_gym_theme'];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && !keysToKeep.includes(key)) localStorage.removeItem(key);
    }
    setUser(null);

  }, []);



  // Active session polling for suspension check
  useEffect(() => {
    if (!user || user.role !== 'gym_owner') return;

    const interval = setInterval(async () => {
      try {
        await api.get('/auth/verify');
      } catch (err) {
        // Global interceptor handles the logout automatically
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [user]);

  // ── Session Verification: Check suspension on mount/refresh ──
  useEffect(() => {
    if (user && user.role === 'gym_owner' && navigator.onLine) {
      api.get('/auth/verify').catch(() => {
        // Interceptor handles logout if suspended
      });
    }
  }, []);

  const isAdmin = user?.role === 'admin';
  const isGymOwner = user?.role === 'gym_owner';

  return (
    <AuthContext.Provider value={{ user, login, logout, switchSession, isAdmin, isGymOwner, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
