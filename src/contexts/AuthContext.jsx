import { createContext, useContext, useState, useCallback } from 'react';
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
          role: 'gym_owner',
          name: data.gym.owner_name,
          gym_id: data.gym?.id,
          gym_name: data.gym?.gym_name,
          token: data.token
        };
        localStorage.setItem('core_gym_user', JSON.stringify(gymUser));
        setUser(gymUser);

        return { success: true };
      }
      return { success: false, error: 'Login failed' };
    } catch (err) {
      if (err.response && err.response.data && err.response.data.message) {
        return { success: false, error: err.response.data.message };
      }
      return { success: false, error: 'Network error or backend is not running.' };
    }
  }, []);


  const logout = useCallback(async () => {

    const keysToKeep = ['core_gym_theme'];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && !keysToKeep.includes(key)) localStorage.removeItem(key);
    }
    setUser(null);

  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

