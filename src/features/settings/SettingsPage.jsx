import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, LogOut, Loader2, Palette, CheckCircle2, Printer } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useFormDraft } from '../../hooks/useFormDraft';
import { ModernLoader } from '../../components/common/ModernLoader';
import { THEME_PRESETS, applyTheme, getActiveThemeId } from '../../lib/theme';
import { getPrinterSettings, savePrinterSettings, printTestPage } from '../../lib/thermalPrinter';
import '../../styles/members.css';

export default function SettingsPage() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState(getActiveThemeId());
  const [isApplyingTheme, setIsApplyingTheme] = useState(false);
  const [printerPaperWidth, setPrinterPaperWidth] = useState(() => getPrinterSettings().paperWidth);

  const { saveDraft, clearDraft } = useFormDraft('settings', {}, (draft) => {
    if (draft.form) setForm(prev => ({ ...prev, ...(draft.form || {}) }));
  });

  useEffect(() => {
    if (form) saveDraft({ form });
  }, [form, saveDraft]);

  useEffect(() => {
    const fetchGym = async () => {
      setLoading(true);
      try {
        const cachedRaw = localStorage.getItem('core_gym_settings');
        const cachedSettings = cachedRaw ? JSON.parse(cachedRaw) : null;
        let g = null;
        try {
          const res = await api.get('/gym');
          g = {
            ...(cachedSettings || {}),
            ...(res.data.data || {}),
          };
          localStorage.setItem('core_gym_settings', JSON.stringify(g));
        } catch (err) {
          if (cachedSettings) g = cachedSettings;
          else throw new Error("No settings cached");
        }

        if (g) {
          setForm(prev => {
            if (prev && prev.gym_name) return prev;
            return {
              gym_name: g.gym_name || '',
              owner_name: g.owner_name || '',
              phone: g.phone || '',
              city: g.city || '',
              address: g.address || '',
              default_monthly_fee: String(g.default_monthly_fee || 0),
              wa_msg_active: g.wa_msg_active || '',
              wa_msg_due_soon: g.wa_msg_due_soon || '',
              wa_msg_expired: g.wa_msg_expired || '',
              attendance_active: g.attendance_active ?? false,
            };
          });
        }
      } catch (err) {
        console.error('Failed to fetch gym settings', err);
        setForm({
          gym_name: '', owner_name: '', phone: '', city: '', address: '', default_monthly_fee: '0',
          wa_msg_active: '', wa_msg_due_soon: '', wa_msg_expired: '', attendance_active: false
        });
        toast.error('Running offline with no cached settings');
      } finally {
        setLoading(false);
      }
    };
    fetchGym();
  }, []);

  const [passForm, setPassForm] = useState({ current: '', newPass: '', confirm: '' });

  if (loading || !form) return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <ModernLoader type="morph" text="Opening Control Panel..." />
    </div>
  );

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload = { ...form, default_monthly_fee: Number(form.default_monthly_fee) };
      localStorage.setItem('core_gym_settings', JSON.stringify(payload));

      try {
        await api.put('/gym', payload);
        toast.success('Settings saved!');
      } catch (apiErr) {
        toast.success('Settings saved locally (Offline mode)');
      }

      clearDraft();
    } catch (err) {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passForm.newPass !== passForm.confirm) { toast.error('Passwords do not match'); return; }

    setIsChangingPass(true);
    try {
      await api.post('/auth/change-password', { gym_id: user.gym_id, current_password: passForm.current, new_password: passForm.newPass });
      toast.success('Password changed!');
      setPassForm({ current: '', newPass: '', confirm: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password');
    } finally {
      setIsChangingPass(false);
    }
  };

  const handleApplyTheme = () => {
    setIsApplyingTheme(true);
    try {
      const appliedThemeId = applyTheme(selectedTheme);
      setSelectedTheme(appliedThemeId);
      toast.success('Theme applied successfully');
    } catch (err) {
      toast.error('Could not apply theme');
    } finally {
      setIsApplyingTheme(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="page-container">
      <h1 className="page-title" style={{ marginBottom: 'var(--space-lg)' }}>Settings</h1>

      <form onSubmit={handleSave}>
        <h3 className="section-title">Gym Information</h3>
        <div className="form-group"><label className="form-label">Gym Name</label><input className="form-input" value={form.gym_name} onChange={e => set('gym_name', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Owner Name</label><input className="form-input" value={form.owner_name} onChange={e => set('owner_name', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Phone Number</label><input className="form-input" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">City</label><input className="form-input" value={form.city} onChange={e => set('city', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Address</label><input className="form-input" value={form.address} onChange={e => set('address', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Default Monthly Fee (PKR)</label><input className="form-input" type="text" inputMode="numeric" value={form.default_monthly_fee} onChange={e => set('default_monthly_fee', e.target.value)} /></div>
        <button type="submit" className="btn btn-primary btn-block" disabled={isSaving}>
          {isSaving ? <Loader2 className="spin" size={18} /> : <><Save size={18} /> Save Changes</>}
        </button>
      </form>

      <div style={{ marginTop: 'var(--space-lg)' }}>
        <h3 className="section-title">App Color Theme</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)', marginBottom: 'var(--space-md)' }}>
          Choose a color style for your full website and click apply.
        </p>

        <div className="theme-picker-grid">
          {THEME_PRESETS.map((theme) => {
            const isSelected = selectedTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                className={`theme-picker-card ${isSelected ? 'active' : ''}`}
                onClick={() => setSelectedTheme(theme.id)}
              >
                <span className="theme-picker-swatch" style={{ background: theme.preview }} />
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>{theme.label}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{theme.description}</div>
                </div>
                {isSelected && <CheckCircle2 size={16} style={{ color: 'var(--accent-primary)' }} />}
              </button>
            );
          })}
        </div>

        <button type="button" className="btn btn-primary btn-block" onClick={handleApplyTheme} disabled={isApplyingTheme}>
          {isApplyingTheme ? <Loader2 className="spin" size={18} /> : <><Palette size={18} /> Apply Theme</>}
        </button>
      </div>

      <div style={{ marginTop: 'var(--space-lg)' }}>
        <h3 className="section-title">Thermal Printer</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)', marginBottom: 'var(--space-md)' }}>
          Set your thermal printer paper width and test the connection.
        </p>

        <div className="form-group">
          <label className="form-label">Paper Width</label>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            {['58mm', '80mm'].map(w => (
              <button
                key={w}
                type="button"
                className={`btn ${printerPaperWidth === w ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                onClick={() => {
                  setPrinterPaperWidth(w);
                  savePrinterSettings({ paperWidth: w });
                  toast.success(`Paper width set to ${w}`);
                }}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => {
            printTestPage();
            toast.info('Test page sent to printer');
          }}
        >
          <Printer size={18} /> Print Test Page
        </button>
      </div>

      <form onSubmit={handleSave} style={{ marginTop: 'var(--space-lg)' }}>
        <h3 className="section-title">WhatsApp Message Templates</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)', marginBottom: 'var(--space-md)' }}>
          Available Placeholders: [Name], [GymName], [Days], [Amount], [Phone]
        </p>
        <div className="form-group">
          <label className="form-label">Active Members Message</label>
          <textarea className="form-textarea" rows="3" value={form.wa_msg_active} onChange={e => set('wa_msg_active', e.target.value)} placeholder="Message for paid members..." />
        </div>
        <div className="form-group">
          <label className="form-label">Due Soon Message (0-3 Days Left)</label>
          <textarea className="form-textarea" rows="3" value={form.wa_msg_due_soon} onChange={e => set('wa_msg_due_soon', e.target.value)} placeholder="Message for members whose fee is due soon..." />
        </div>
        <div className="form-group">
          <label className="form-label">Expired Members Message</label>
          <textarea className="form-textarea" rows="3" value={form.wa_msg_expired} onChange={e => set('wa_msg_expired', e.target.value)} placeholder="Message for members whose fee is expired..." />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={isSaving}>
          {isSaving ? <Loader2 className="spin" size={18} /> : <><Save size={18} /> Save Messages</>}
        </button>
      </form>

      <div className="divider" style={{ margin: 'var(--space-xl) 0' }}></div>

      <form onSubmit={handlePasswordChange}>
        <h3 className="section-title">Change Password</h3>
        <div className="form-group"><label className="form-label">Current Password</label><input className="form-input" type="password" value={passForm.current} onChange={e => setPassForm(p => ({ ...p, current: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">New Password</label><input className="form-input" type="password" value={passForm.newPass} onChange={e => setPassForm(p => ({ ...p, newPass: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">Confirm Password</label><input className="form-input" type="password" value={passForm.confirm} onChange={e => setPassForm(p => ({ ...p, confirm: e.target.value }))} /></div>
        <button type="submit" className="btn btn-secondary btn-block" disabled={isChangingPass}>
          {isChangingPass ? <Loader2 className="spin" size={18} /> : 'Change Password'}
        </button>
      </form>

      <div className="divider" style={{ margin: 'var(--space-xl) 0' }}></div>

      <button className="btn btn-danger btn-block" onClick={handleLogout}>
        <LogOut size={18} /> Logout
      </button>

      <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, marginTop: 'var(--space-lg)' }}>
        Core Gym v1.0 — Made for Pakistan 🇵🇰
      </p>
    </div>
  );
}
