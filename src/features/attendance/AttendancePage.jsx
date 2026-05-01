import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { identifyFingerprint } from '../../lib/biometrics';
import { daysFromNow, formatPKR, getInitials, formatDate } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import { ModernLoader } from '../../components/common/ModernLoader';
import { 
  Fingerprint, 
  History, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  ShieldAlert, 
  Search, 
  Clock, 
  UserCheck 
} from 'lucide-react';
import '../../styles/members.css';

export default function AttendancePage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('gate'); // 'gate', 'history'
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Load today's history from API
  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await api.get('/attendance', { params: { date: new Date().toISOString().split('T')[0] } });
      setHistory(res.data.data || []);
    } catch (err) { console.error(err); } finally { setLoadingHistory(false); }
  };

  // Global search for members when typing
  useEffect(() => {
    const performSearch = async () => {
      if (!searchTerm || searchTerm.length < 2) {
        setSearchResults([]);
        return;
      }
      try {
        const res = await api.get('/members');
        const allMembers = res.data.data || [];
        const results = allMembers.filter(m => 
          m.status !== 'deleted' &&
          (m.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
          m.phone.includes(searchTerm))
        ).slice(0, 10);
        setSearchResults(results);
      } catch (err) {
        console.error('Member search failed', err);
      }
    };
    performSearch();
  }, [searchTerm]);

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
  }, [activeTab]);

  const handleScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const member = await identifyFingerprint();
      const days = member.latest_expiry ? daysFromNow(member.latest_expiry) : null;
      const isExpired = member.status === 'expired' || (days !== null && days < 0);
      
      if (isExpired) {
        setScanResult({ member, allowed: false, message: `Access Denied! Fee overdue by ${Math.abs(days)} days.` });
        toast.error('Membership Expired!');
      } else {
        const record = { id: crypto.randomUUID(), member_id: member.id, timestamp: new Date().toISOString(), status: 'present' };
        await api.post('/attendance', record);
        setScanResult({ member, allowed: true, message: `Welcome, ${member.name}! Access Granted.` });
        toast.success(`Welcome back, ${member.name.split(' ')[0]}!`);
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') toast.error(err.message || 'Identification failed');
    } finally { setScanning(false); }
  };

  const formatTime = (ts) => {
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '--:--';
      return d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    } catch (e) { return '--:--'; }
  };

  const handleManualMark = async (memberId) => {
    try {
      const record = { id: crypto.randomUUID(), member_id: memberId, timestamp: new Date().toISOString(), status: 'present' };
      await api.post('/attendance', record);
      toast.success('Attendance marked');
      setSearchTerm('');
      fetchHistory();
    } catch (err) { toast.error('Failed to mark attendance'); }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{marginBottom: '24px'}}>
         <h1 className="page-title">Attendance <span>Hub</span></h1>
         <p className="page-subtitle">Central gateway for biometric access and logs</p>
      </div>

      {/* Professional Tab Switcher */}
      <div className="filter-tabs" style={{marginBottom: '32px'}}>
         <button 
           className={`filter-tab ${activeTab === 'gate' ? 'active' : ''}`} 
           onClick={() => setActiveTab('gate')}
         >
           <Fingerprint size={16} style={{marginRight: 8}}/> Live Gate Scanner
         </button>
         <button 
           className={`filter-tab ${activeTab === 'history' ? 'active' : ''}`} 
           onClick={() => setActiveTab('history')}
         >
           <History size={16} style={{marginRight: 8}}/> Entry History Logs
         </button>
      </div>

      {activeTab === 'gate' ? (
        <div className="gate-tab-content animate-in">
           <div className="grid-2" style={{alignItems: 'start'}}>
              
              {/* Left Column: The Scanner */}
              <div className="card" style={{padding: '40px', textAlign: 'center'}}>
                 <div style={{
                    width: '120px', height: '120px', margin: '0 auto 32px', borderRadius: '50%',
                    background: scanResult ? (scanResult.allowed ? 'var(--status-active-bg)' : 'var(--status-danger-bg)') : 'var(--bg-tertiary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: scanResult ? (scanResult.allowed ? 'var(--status-active)' : 'var(--status-danger)') : (scanning ? 'var(--accent-primary)' : 'var(--text-muted)'),
                    transition: 'all 0.3s ease',
                    boxShadow: scanning ? '0 0 40px rgba(56, 189, 248, 0.4)' : 'none'
                 }}>
                    {scanning ? (
                      <Loader2 size={48} className="spin" />
                    ) : scanResult ? (
                      scanResult.allowed ? <CheckCircle2 size={64} /> : <XCircle size={64} />
                    ) : (
                      <Fingerprint size={64} />
                    )}
                 </div>

                 {scanResult ? (
                    <div>
                       <div style={{
                          width: '80px', height: '80px', borderRadius: '50%', background: 'var(--bg-secondary)', 
                          margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '24px', fontWeight: '800', border: '2px solid var(--border-color)'
                       }}>
                          {getInitials(scanResult.member.name)}
                       </div>
                       <h2 style={{fontSize: '24px', fontWeight: '900'}}>{scanResult.member.name}</h2>
                       <p style={{
                          fontSize: '16px', fontWeight: '700', marginTop: '4px',
                          color: scanResult.allowed ? 'var(--status-active)' : 'var(--status-danger)',
                          marginBottom: '24px'
                       }}>
                         {scanResult.message}
                       </p>
                       <button className="btn btn-secondary btn-block" onClick={() => setScanResult(null)}>Scan Next Member</button>
                    </div>
                 ) : (
                    <div>
                       <h3 style={{fontWeight: '800', marginBottom: '8px'}}>Ready to Identify</h3>
                       <p style={{color: 'var(--text-muted)', fontSize: '14px', marginBottom: '32px'}}>Ask the member to press the scanner</p>
                       <button className="btn btn-primary btn-lg btn-block" disabled={scanning} onClick={handleScan}>
                          {scanning ? 'Verifying Identity...' : 'Identify Fingerprint'}
                       </button>
                    </div>
                 )}

                 {/* Browser Support Warning */}
                 {window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && (
                    <div style={{marginTop: '20px', padding: '12px', background: 'var(--status-danger-bg)', borderRadius: '8px', color: 'var(--status-danger)', fontSize: '11px'}}>
                       ⚠️ Biometrics disabled: Browsers require <b>HTTPS</b> or <b>localhost</b> for fingerprint security. 
                       Currently using an insecure connection.
                    </div>
                 )}
              </div>

              {/* Right Column: Information & Manual Entry */}
              <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                 
                 {/* Manual Entry Fallback */}
                 <div className="card" style={{padding: '24px', border: '1px solid var(--accent-primary)'}}>
                    <h3 style={{fontSize: '15px', fontWeight: '800', marginBottom: '12px'}}>Manual Entry</h3>
                    <p style={{fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px'}}>If the scanner is unavailable, search for a member to mark attendance manually.</p>
                    <div className="search-bar" style={{background: 'var(--bg-secondary)'}}>
                       <Search size={16} />
                       <input 
                         placeholder="Member Name or Phone..." 
                         onChange={(e) => {
                            const val = e.target.value;
                            if (val.length > 2) {
                               setSearchTerm(val);
                               setActiveTab('history'); // Jump to history to see and mark
                            }
                         }}
                       />
                    </div>
                 </div>

                 <div className="card" style={{padding: '24px'}}>
                    <h3 style={{fontSize: '15px', fontWeight: '800', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: 8}}>
                       <UserCheck size={18} style={{color: 'var(--accent-primary)'}}/> Access rules
                    </h3>
                    <ul style={{padding: 0, margin: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px'}}>
                       <li style={{fontSize: '13px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)'}}>
                          <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--status-active)'}}></div>
                          Active members get auto-logged.
                       </li>
                       <li style={{fontSize: '13px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)'}}>
                          <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--status-danger)'}}></div>
                          Expired members are blocked at gate.
                       </li>
                       <li style={{fontSize: '13px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)'}}>
                          <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-primary)'}}></div>
                          Local fingerprint sensor required.
                       </li>
                    </ul>
                 </div>

                 <div className="card" style={{padding: '24px', background: 'var(--bg-secondary)', borderStyle: 'dashed'}}>
                    <h3 style={{fontSize: '14px', fontWeight: '800', marginBottom: '8px'}}>Member Registration</h3>
                    <p style={{fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px'}}>
                       To register a new fingerprint, visit the specific member's profile page and use the biometric enrollment section.
                    </p>
                    <button className="btn btn-secondary btn-sm" onClick={() => (window.location.href = '/members')}>Manage Members</button>
                 </div>
              </div>
           </div>
        </div>
      ) : (
        <div className="history-tab-content animate-in">
           <div className="card" style={{padding: '20px'}}>
              <div className="search-bar" style={{marginBottom: '20px'}}>
                 <Search size={18} />
                 <input 
                   placeholder="Search entries by name or phone..." 
                   value={searchTerm}
                   onChange={e => setSearchTerm(e.target.value)}
                 />
              </div>

              {loadingHistory && !searchTerm ? (
                 <div style={{padding: '40px 0'}}>
                   <ModernLoader type="bar" text="Loading History..." />
                 </div>
              ) : searchTerm.length >= 2 ? (
                 <div className="attendance-list">
                    <div style={{fontSize: '11px', fontWeight: '800', opacity: 0.5, marginBottom: '16px', textTransform: 'uppercase'}}>Global Directory Results</div>
                    {searchResults.length === 0 ? (
                       <div style={{padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)'}}>No members matching "{searchTerm}"</div>
                    ) : (
                       searchResults.map(m => (
                          <div key={m.id} style={{
                             display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                             padding: '16px', background: 'var(--bg-tertiary)', borderRadius: '12px', marginBottom: '8px'
                          }}>
                             <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
                                <div style={{width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700'}}>
                                   {getInitials(m.name)}
                                </div>
                                <div>
                                   <div style={{fontWeight: '700', fontSize: '15px'}}>{m.name}</div>
                                   <div style={{fontSize: '11px', color: 'var(--text-muted)'}}>{m.phone || 'No phone'}</div>
                                </div>
                             </div>
                             <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                                <span className={`status-pill ${m.status || 'active'}`} style={{fontSize: '10px', padding: '2px 8px'}}>{m.status || 'Active'}</span>
                                <button className="btn btn-primary btn-sm" onClick={() => handleManualMark(m.id)}>Check In</button>
                             </div>
                          </div>
                       ))
                    )}
                 </div>
              ) : history.length === 0 ? (
                 <div style={{padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)'}}>
                    No attendance records found for today.
                 </div>
              ) : (
                 <div className="attendance-list">
                    <div style={{fontSize: '11px', fontWeight: '800', opacity: 0.5, marginBottom: '16px', textTransform: 'uppercase'}}>Today's Check-ins ({history.length})</div>
                    {history.map(log => (
                       <div key={log.id} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '16px', background: 'var(--bg-tertiary)', borderRadius: '12px', marginBottom: '8px'
                       }}>
                          <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
                             <div style={{width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700'}}>
                                {getInitials(log.member?.name)}
                             </div>
                             <div>
                                <div style={{fontWeight: '700', fontSize: '15px'}}>{log.member?.name}</div>
                                <div style={{fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4}}>
                                   <Clock size={10} /> {formatTime(log.timestamp)}
                                </div>
                             </div>
                          </div>
                          <div style={{fontSize: '11px', fontWeight: '800', color: 'var(--status-active)', background: 'var(--status-active-bg)', padding: '4px 10px', borderRadius: '4px'}}>
                             PRESENT
                          </div>
                       </div>
                    ))}
                 </div>
              )}
           </div>
        </div>
      )}
    </div>
  );
}
