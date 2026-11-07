import { useEffect, useState } from 'react';
import { Clock, ChevronDown, ChevronUp, Save, Loader2, Users } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';

const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' }, { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
];

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/**
 * Automatic WhatsApp reminder schedule: when messages may go out, who gets
 * one, and how often. Also previews exactly who the next run will message.
 */
export default function ReminderSettingsCard() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showList, setShowList] = useState(false);

  const load = async () => {
    try {
      const res = await api.get('/whatsapp/reminder-settings');
      setSettings(res.data.data);
      setSaved(res.data.data);
    } catch {
      toast.error('Could not load reminder settings');
    }
  };

  const loadPreview = async () => {
    try {
      const res = await api.get('/whatsapp/reminder-preview');
      setPreview(res.data.data);
    } catch {
      setPreview(null);
    }
  };

  useEffect(() => { load(); loadPreview(); }, []);

  const set = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  const toggleDay = (n) => set('days', settings.days.includes(n) ? settings.days.filter((d) => d !== n) : [...settings.days, n]);
  const dirty = settings && saved && JSON.stringify(settings) !== JSON.stringify(saved);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/whatsapp/reminder-settings', settings);
      setSettings(res.data.data);
      setSaved(res.data.data);
      toast.success('Reminder settings saved');
      loadPreview();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;

  const run = settings.lastRunSummary;
  const summaryLine = settings.enabled
    ? `On · ${to12h(settings.startTime)} – ${to12h(settings.endTime)} · expired in last ${settings.expiredWithinDays} days${settings.dueSoonDays ? ` + due within ${settings.dueSoonDays} days` : ''}`
    : 'Off · no automatic messages';

  return (
    <div className="card reminder-card">
      <button type="button" className="reminder-card-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="reminder-card-icon"><Clock size={20} /></div>
        <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
          <h3>Automatic reminders</h3>
          <p>{summaryLine}</p>
        </div>
        {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>

      {open && (
        <div className="reminder-card-body">
          <label className="reminder-switch">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            <span>Send reminders automatically</span>
          </label>

          <div className="reminder-grid">
            <div className="form-group">
              <label className="form-label">Start sending at</label>
              <input type="time" className="form-input" value={settings.startTime} onChange={(e) => set('startTime', e.target.value)} disabled={!settings.enabled} />
            </div>
            <div className="form-group">
              <label className="form-label">Stop sending at</label>
              <input type="time" className="form-input" value={settings.endTime} onChange={(e) => set('endTime', e.target.value)} disabled={!settings.enabled} />
            </div>
          </div>
          <p className="reminder-hint">No message is sent outside these hours. If WhatsApp is reconnecting, it keeps trying until the stop time.</p>

          <div className="form-group">
            <label className="form-label">Days</label>
            <div className="reminder-days">
              {DAYS.map((d) => (
                <button type="button" key={d.n} disabled={!settings.enabled}
                  className={`reminder-day ${settings.days.includes(d.n) ? 'on' : ''}`} onClick={() => toggleDay(d.n)}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="reminder-grid">
            <div className="form-group">
              <label className="form-label">Remind members expired within (days)</label>
              <input type="number" min="1" max="365" className="form-input" value={settings.expiredWithinDays}
                onChange={(e) => set('expiredWithinDays', e.target.value)} disabled={!settings.enabled} />
            </div>
            <div className="form-group">
              <label className="form-label">Also remind before expiry (days, 0 = off)</label>
              <input type="number" min="0" max="30" className="form-input" value={settings.dueSoonDays}
                onChange={(e) => set('dueSoonDays', e.target.value)} disabled={!settings.enabled} />
            </div>
            <div className="form-group">
              <label className="form-label">Don't repeat to the same member for (days)</label>
              <input type="number" min="1" max="60" className="form-input" value={settings.repeatEveryDays}
                onChange={(e) => set('repeatEveryDays', e.target.value)} disabled={!settings.enabled} />
            </div>
            <div className="form-group">
              <label className="form-label">Gap between messages (seconds)</label>
              <input type="number" min="5" max="120" className="form-input" value={settings.gapSeconds}
                onChange={(e) => set('gapSeconds', e.target.value)} disabled={!settings.enabled} />
            </div>
          </div>
          <p className="reminder-hint">Members unpaid for longer than this are listed under "Older" but never messaged automatically.</p>

          <button type="button" className="btn btn-primary btn-block" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />} {dirty ? 'Save settings' : 'Saved'}
          </button>

          {preview && (
            <div className="reminder-preview">
              <div className="reminder-preview-head">
                <Users size={16} />
                <strong>Next run will message {preview.toSend.length} member{preview.toSend.length === 1 ? '' : 's'}</strong>
                {preview.toSend.length > 0 && (
                  <button type="button" className="btn-text-only" onClick={() => setShowList((v) => !v)}>
                    {showList ? 'Hide' : 'Show'} list
                  </button>
                )}
              </div>
              <p className="reminder-hint">
                Due soon: {preview.counts.dueSoon} · Expired in range: {preview.counts.recent} · Older (not messaged): {preview.counts.older}
                {preview.counts.skippedRecentlyMessaged > 0 && ` · Already messaged recently: ${preview.counts.skippedRecentlyMessaged}`}
              </p>
              {showList && (
                <ul className="reminder-preview-list">
                  {preview.toSend.map((m) => (
                    <li key={m.id}>
                      <span>{m.name}</span>
                      <span className={m.days < 0 ? 'overdue' : 'due'}>{m.days < 0 ? `${Math.abs(m.days)}d overdue` : m.days === 0 ? 'ends today' : `ends in ${m.days}d`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {run && (
            <p className="reminder-hint" style={{ marginTop: 12 }}>
              Last run {run.date}: {run.finished ? `sent ${run.sent} of ${run.planned}${run.failed ? `, ${run.failed} failed` : ''}${run.stoppedReason ? ` (stopped: ${run.stoppedReason})` : ''}` : 'in progress…'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
