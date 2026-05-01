import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { identifyFingerprint } from '../../lib/biometrics';
import { daysFromNow, formatPKR, getInitials } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import { Fingerprint, CheckCircle2, XCircle, Loader2, ShieldAlert } from 'lucide-react';
import '../../styles/members.css';

export default function AttendanceScanner() {
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null); // { member, allowed, message }

  const handleScan = async () => {
    setScanning(true);
    setResult(null);
    try {
      // 1. Trigger the sensor to identify the member
      const member = await identifyFingerprint();
      
      // 2. Check their membership status
      const days = member.latest_expiry ? daysFromNow(member.latest_expiry) : null;
      const isExpired = member.status === 'expired' || (days !== null && days < 0);
      
      if (isExpired) {
        setResult({
          member,
          allowed: false,
          message: `Access Denied! Membership expired ${Math.abs(days)} days ago.`
        });
        toast.error('Membership Expired!');
      } else {
        // 3. Mark Attendance via API
        const attendanceRecord = {
          id: crypto.randomUUID(),
          member_id: member.id,
          timestamp: new Date().toISOString(),
          status: 'present'
        };
        
        await api.post('/attendance', attendanceRecord);

        setResult({
          member,
          allowed: true,
          message: `Welcome back, ${member.name.split(' ')[0]}!`
        });
        toast.success(`Welcome, ${member.name}!`);
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        toast.error(err.message || 'Scan failed');
      }
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="page-container" style={{maxWidth: '600px', margin: '0 auto', textAlign: 'center'}}>
      <div className="page-header">
         <h1 className="page-title">Gym Access Gate</h1>
         <p className="page-subtitle">Scan fingerprint to grant entry and mark attendance</p>
      </div>

      <div className="card" style={{padding: '40px', marginTop: '20px', position: 'relative', overflow: 'hidden'}}>
        
        {/* Visual Animation for scanning */}
        <div style={{
          width: '120px', height: '120px', margin: '0 auto 32px', borderRadius: '50%',
          background: result ? (result.allowed ? 'var(--status-active-bg)' : 'var(--status-danger-bg)') : 'var(--bg-tertiary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: result ? (result.allowed ? 'var(--status-active)' : 'var(--status-danger)') : (scanning ? 'var(--accent-primary)' : 'var(--text-muted)'),
          transition: 'all 0.3s ease',
          boxShadow: scanning ? '0 0 30px rgba(56, 189, 248, 0.4)' : 'none'
        }}>
           {scanning ? (
             <Loader2 size={48} className="spin" />
           ) : result ? (
             result.allowed ? <CheckCircle2 size={64} /> : <XCircle size={64} />
           ) : (
             <Fingerprint size={64} />
           )}
        </div>

        {result ? (
          <div className="animate-in">
             <div style={{
               width: '80px', height: '80px', borderRadius: '50%', background: 'var(--bg-secondary)', 
               margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
               fontSize: '24px', fontWeight: '800', border: '2px solid var(--border-color)'
             }}>
                {getInitials(result.member.name)}
             </div>
             <h2 style={{fontSize: '24px', fontWeight: '800', marginBottom: '8px'}}>{result.member.name}</h2>
             <p style={{
               fontSize: '16px', fontWeight: '600', 
               color: result.allowed ? 'var(--status-active)' : 'var(--status-danger)',
               marginBottom: '24px'
             }}>
               {result.message}
             </p>
             
             {!result.allowed && (
                <div style={{background: 'var(--accent-light)', padding: '12px', borderRadius: '12px', color: 'var(--accent-primary)', fontSize: '14px', marginBottom: '24px'}}>
                  <ShieldAlert size={16} style={{display: 'inline', verticalAlign: -3, marginRight: 6}}/>
                  Please clear dues to enter the gym.
                </div>
             )}

             <button className="btn btn-secondary btn-block" onClick={() => setResult(null)}>Clear & Ready</button>
          </div>
        ) : (
          <div>
             <h3 style={{fontWeight: '700', marginBottom: '8px'}}>Ready to Scan</h3>
             <p style={{color: 'var(--text-muted)', fontSize: '14px', marginBottom: '32px'}}>Ask the member to place their finger on the sensor</p>
             <button className="btn btn-primary btn-lg btn-block" disabled={scanning} onClick={handleScan}>
                {scanning ? 'Wait for sensor...' : 'Start Scanner'}
             </button>
          </div>
        )}
      </div>

      <div style={{marginTop: '40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px'}}>
         <div className="card" style={{padding: '16px', textAlign: 'left'}}>
            <div style={{fontSize: '11px', fontWeight: '800', opacity: 0.6, textTransform: 'uppercase'}}>Entry Rule</div>
            <div style={{fontSize: '13px', marginTop: '4px', fontWeight: '600'}}>Strict Expiry Check</div>
         </div>
         <div className="card" style={{padding: '16px', textAlign: 'left'}}>
            <div style={{fontSize: '11px', fontWeight: '800', opacity: 0.6, textTransform: 'uppercase'}}>Log Status</div>
            <div style={{fontSize: '13px', marginTop: '4px', fontWeight: '600'}}>Auto Attendance Enabled</div>
         </div>
      </div>
    </div>
  );
}
