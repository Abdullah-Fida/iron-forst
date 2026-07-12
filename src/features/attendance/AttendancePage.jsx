import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { getInitials } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import { ModernLoader } from '../../components/common/ModernLoader';
import { 
  Fingerprint, 
  History, 
  CheckCircle2, 
  Search, 
  UserCheck,
  RefreshCw
} from 'lucide-react';
import '../../styles/members.css';

export default function AttendancePage() {
  const toast = useToast();
  const [history, setHistory] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load today's history from API
  const fetchHistory = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoadingHistory(true);
    
    try {
      const res = await api.get('/attendance', { params: { date: new Date().toISOString().split('T')[0] } });
      setHistory(res.data.data || []);
    } catch (err) { 
      console.error(err); 
      toast.error('Failed to load attendance');
    } finally { 
      setLoadingHistory(false); 
      setRefreshing(false);
    }
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
    fetchHistory();
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => fetchHistory(), 30000);
    return () => clearInterval(interval);
  }, []);

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
      toast.success('Attendance marked manually');
      setSearchTerm('');
      fetchHistory(true);
    } catch (err) { 
      toast.error('Failed to mark attendance'); 
    }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{marginBottom: '24px'}}>
         <h1 className="page-title">Attendance <span>Hub</span></h1>
         <p className="page-subtitle">Live daily check-ins from fingerprint device</p>
      </div>

      <div className="grid-2" style={{alignItems: 'start'}}>
        
        {/* Left Column: Live Feed */}
        <div className="card" style={{padding: '24px', minHeight: '60vh'}}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <History size={18} className="text-primary" /> Today's Live Feed
            </h3>
            <button 
              className="btn btn-secondary btn-icon" 
              onClick={() => fetchHistory(true)}
              title="Refresh"
            >
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            </button>
          </div>

          <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: '12px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total Check-ins Today</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--text-primary)' }}>{history.length}</div>
            </div>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--status-active-bg)', color: 'var(--status-active)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserCheck size={24} />
            </div>
          </div>

          {loadingHistory && !refreshing ? (
             <div style={{padding: '40px 0'}}>
               <ModernLoader type="bar" text="Loading Live Feed..." />
             </div>
          ) : history.length === 0 ? (
             <div style={{padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)'}}>
                <Fingerprint size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
                <div>No check-ins yet today.</div>
                <div style={{ fontSize: '12px', marginTop: '8px' }}>Waiting for device scans...</div>
             </div>
          ) : (
             <div className="attendance-list">
                {history.map(log => (
                   <div key={log.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '16px', background: 'var(--bg-secondary)', borderRadius: '12px', marginBottom: '8px',
                      borderLeft: '4px solid var(--status-active)'
                   }}>
                      <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
                         <div style={{width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700'}}>
                            {getInitials(log.member?.name)}
                         </div>
                         <div>
                            <div style={{fontWeight: '700', fontSize: '15px'}}>{log.member?.name || 'Unknown Member'}</div>
                            <div style={{fontSize: '11px', color: 'var(--text-muted)'}}>PIN: {log.member?.fingerprint_id || 'N/A'}</div>
                         </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                         <div style={{ fontWeight: '800', fontSize: '14px' }}>{formatTime(log.check_in_time)}</div>
                         <div style={{ fontSize: '10px', color: 'var(--status-active)', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                           <CheckCircle2 size={10} /> Present
                         </div>
                      </div>
                   </div>
                ))}
             </div>
          )}
        </div>

        {/* Right Column: Information & Manual Entry */}
        <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
           
           {/* Manual Entry Fallback */}
           <div className="card" style={{padding: '24px', border: '1px solid var(--accent-primary)'}}>
              <h3 style={{fontSize: '15px', fontWeight: '800', marginBottom: '12px'}}>Manual Entry</h3>
              <p style={{fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px'}}>If a member forgot to scan, you can mark them present manually here.</p>
              <div className="search-bar" style={{background: 'var(--bg-secondary)', marginBottom: '16px'}}>
                 <Search size={16} />
                 <input 
                   placeholder="Search Member Name or Phone..." 
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                 />
              </div>

              {searchTerm.length >= 2 && (
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {searchResults.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>No matches found</div>
                  ) : (
                    searchResults.map(m => (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', marginBottom: '8px' }}>
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '13px' }}>{m.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{m.phone}</div>
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={() => handleManualMark(m.id)}>Mark</button>
                      </div>
                    ))
                  )}
                </div>
              )}
           </div>

           <div className="card" style={{padding: '24px'}}>
              <h3 style={{fontSize: '15px', fontWeight: '800', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: 8}}>
                 <Fingerprint size={18} style={{color: 'var(--accent-primary)'}}/> Device Status
              </h3>
              <p style={{fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px'}}>
                The biometric device is connected. When a member scans their finger, they will automatically appear in the Live Feed on the left.
              </p>
              <ul style={{padding: 0, margin: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px'}}>
                 <li style={{fontSize: '13px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)'}}>
                    <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--status-active)'}}></div>
                    Active members get marked present.
                 </li>
                 <li style={{fontSize: '13px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)'}}>
                    <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--status-danger)'}}></div>
                    Expired members are denied access.
                 </li>
              </ul>
           </div>
        </div>
      </div>
    </div>
  );
}
