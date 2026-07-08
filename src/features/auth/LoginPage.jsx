import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, LogIn, Activity, Users, TrendingUp, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import '../../styles/auth.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('expired') === '1') {
      setError('Your session has expired. Please log in again.');
      window.history.replaceState(null, '', '/login');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Please enter email and password'); return; }
    setLoading(true);

    const result = await login(email, password);
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-mesh-bg">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>
      
      <div className="auth-split-container">
        {/* Left Column: Welcome Message */}
        <div className="auth-welcome-col">
          <div className="welcome-content">
            <div className="welcome-logo">
              <div className="logo-box">CG</div>
              <span>Iron Fost</span>
            </div>
            <h1 className="welcome-title">Elevate Your Fitness Business.</h1>
            <p className="welcome-subtitle">
              The all-in-one management platform designed specifically for modern gyms and fitness centers.
            </p>
            
            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-icon"><Users size={20} /></div>
                <div className="feature-text">
                  <h3>Smart Member Management</h3>
                  <p>Track attendance, subscriptions, and active members easily.</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon"><Activity size={20} /></div>
                <div className="feature-text">
                  <h3>Real-time Analytics</h3>
                  <p>Monitor your daily snapshots and business growth.</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon"><ShieldCheck size={20} /></div>
                <div className="feature-text">
                  <h3>Secure & Reliable</h3>
                  <p>Your data is protected with enterprise-grade security.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Login Form */}
        <div className="auth-form-col">
          <div className="auth-form-wrapper">
            <div className="auth-header-mobile">
               <div className="logo-box mobile-only">CG</div>
               <h2>Welcome Back</h2>
               <p>Please enter your details to sign in.</p>
            </div>

            {error && <div className="auth-error">{error}</div>}

            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email or Phone</label>
                <input
                  id="login-email"
                  type="text"
                  className="form-input"
                  placeholder="Enter your email or phone"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="login-password"
                    type={showPass ? 'text' : 'password'}
                    className="form-input"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="btn-pass-toggle"
                  >
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="auth-options">
                <Link to="/forgot-password" className="forgot-link">
                  Forgot password?
                </Link>
              </div>

              <button id="login-submit" type="submit" className="auth-submit-btn" disabled={loading}>
                {loading ? <span className="spinner"></span> : <><LogIn size={20} /> Sign In</>}
              </button>
            </form>

            <div className="auth-footer">
              Don't have an account? <span className="contact-link">Contact Support</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
