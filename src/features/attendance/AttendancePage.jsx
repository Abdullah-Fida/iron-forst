import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { getInitials } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import { ModernLoader } from '../../components/common/ModernLoader';
import { 
  Fingerprint, 
  History, 
  CheckCircle2, 
  XCircle,
  Search, 
  UserCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Clock,
  Phone,
  CalendarDays,
  Link2,
  X,
  Wifi,
  WifiOff,
  AlertTriangle
} from 'lucide-react';
import '../../styles/members.css';

export default function AttendancePage() {
  const toast = useToast();

  // ── State ──
  const [history, setHistory] = useState([]);
  const [accessLogs, setAccessLogs] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [lastScan, setLastScan] = useState(null);     // Latest SSE scan event
  const [showProfile, setShowProfile] = useState(false); // Show member profile modal
  const [activeTab, setActiveTab] = useState('live');  // 'live' | 'access-log'

  // Enrollment state
  const [enrollSearch, setEnrollSearch] = useState('');
  const [enrollResults, setEnrollResults] = useState([]);
  const [enrollMember, setEnrollMember] = useState(null);
  const [enrollFpId, setEnrollFpId] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  const eventSourceRef = useRef(null);

  // ── Load today's attendance history from API ──
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

  // ── Load access logs (granted + denied) ──
  const fetchAccessLogs = async () => {
    try {
      const res = await api.get('/attendance/access-logs', { params: { date: new Date().toISOString().split('T')[0] } });
      setAccessLogs(res.data.data || []);
    } catch (err) {
      console.error('Failed to load access logs:', err);
    }
  };

  // ── SSE Connection ──
  useEffect(() => {
    const saved = localStorage.getItem('core_gym_user');
    if (!saved) return;
    const user = JSON.parse(saved);
    if (!user.token) return;

    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    // Go from /api to /api/live/feed
    const sseUrl = `${baseUrl}/live/feed?token=${encodeURIComponent(user.token)}`;

    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onopen = () => {
      setSseConnected(true);
      console.log('📡 SSE Connected');
    };

    es.addEventListener('scan', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('🔔 SSE Scan Event:', data);

        setLastScan(data);
        setShowProfile(true);

        // Auto-hide profile after 8 seconds
        setTimeout(() => setShowProfile(false), 8000);

        // Add to appropriate list
        if (data.access === 'granted') {
          setHistory(prev => [{
            id: data.timestamp,
            member_id: data.member?.id,
            check_in_time: data.scanTime,
            date: new Date().toISOString().split('T')[0],
            member: data.member,
            members: data.member,
          }, ...prev]);
        }

        // Always add to access logs
        setAccessLogs(prev => [{
          id: data.timestamp,
          member_id: data.member?.id,
          fingerprint_id: data.fingerprintId,
          timestamp: data.scanTime,
          device: data.device,
          status: data.status,
          member: data.member,
        }, ...prev]);

        // Toast
        if (data.access === 'granted') {
          toast.success(`✅ ${data.member?.name || 'Member'} — Access Granted`);
        } else {
          toast.error(`❌ ${data.member?.name || 'Unknown'} — Access Denied`);
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    });

    es.onerror = () => {
      setSseConnected(false);
      console.warn('⚠️ SSE disconnected, will retry...');
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  // ── Member search for manual attendance ──
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

  // ── Enrollment member search ──
  useEffect(() => {
    const search = async () => {
      if (!enrollSearch || enrollSearch.length < 2) {
        setEnrollResults([]);
        return;
      }
      try {
        const res = await api.get('/members');
        const allMembers = res.data.data || [];
        setEnrollResults(allMembers.filter(m => 
          m.status !== 'deleted' &&
          (m.name.toLowerCase().includes(enrollSearch.toLowerCase()) || 
          m.phone.includes(enrollSearch))
        ).slice(0, 8));
      } catch (err) {
        console.error(err);
      }
    };
    search();
  }, [enrollSearch]);

  useEffect(() => {
    fetchHistory();
    fetchAccessLogs();
    // Fallback poll every 60 seconds (SSE handles real-time)
    const interval = setInterval(() => {
      fetchHistory();
      fetchAccessLogs();
    }, 60000);
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

  const handleEnroll = async () => {
    if (!enrollMember || !enrollFpId.trim()) {
      toast.error('Select a member and enter Fingerprint ID');
      return;
    }
    setEnrolling(true);
    try {
      const res = await api.post('/attendance/fingerprint/enroll', {
        member_id: enrollMember.id,
        fingerprint_id: enrollFpId.trim(),
      });
      if (res.data.success) {
        toast.success(`✅ Fingerprint linked for ${enrollMember.name}`);
        setEnrollMember(null);
        setEnrollFpId('');
        setEnrollSearch('');
      } else {
        toast.error(res.data.message || 'Enrollment failed');
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Enrollment failed';
      toast.error(msg);
    } finally {
      setEnrolling(false);
    }
  };

  const getStatusColor = (status) => {
    if (status === 'GRANTED') return 'var(--status-active)';
    if (status === 'EXPIRED') return 'var(--status-warning)';
    return 'var(--status-danger)';
  };

  const getStatusBg = (status) => {
    if (status === 'GRANTED') return 'var(--status-active-bg)';
    if (status === 'EXPIRED') return 'var(--status-warning-bg)';
    return 'var(--status-danger-bg)';
  };

  const getStatusIcon = (status) => {
    if (status === 'GRANTED') return <CheckCircle2 size={16} />;
    if (status === 'EXPIRED') return <AlertTriangle size={16} />;
    return <XCircle size={16} />;
  };

  const getStatusLabel = (status) => {
    if (status === 'GRANTED') return 'Access Granted';
    if (status === 'EXPIRED') return 'Fees Expired';
    if (status === 'MEMBER_NOT_FOUND') return 'Not Registered';
    return 'Denied';
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{marginBottom: '24px'}}>
         <h1 className="page-title">Attendance <span>Hub</span></h1>
         <p className="page-subtitle">
           Live fingerprint scanning • Real-time access monitoring
         </p>
      </div>

      {/* ── SSE Connection Status Banner ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 16px', borderRadius: '10px', marginBottom: '20px',
        background: sseConnected ? 'var(--status-active-bg)' : 'var(--status-danger-bg)',
        border: `1px solid ${sseConnected ? 'rgba(52, 211, 153, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`,
        fontSize: '13px', fontWeight: '600',
        color: sseConnected ? 'var(--status-active)' : 'var(--status-danger)',
      }}>
        {sseConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
        {sseConnected ? 'Live Feed Connected — Waiting for scans' : 'Live Feed Disconnected — Reconnecting...'}
        <div style={{
          marginLeft: 'auto',
          width: '8px', height: '8px', borderRadius: '50%',
          background: sseConnected ? 'var(--status-active)' : 'var(--status-danger)',
          animation: sseConnected ? 'pulse-dot 2s ease-in-out infinite' : 'none',
        }} />
      </div>

      {/* ── Member Profile Popup (appears on scan) ── */}
      {showProfile && lastScan && (
        <div className="scan-profile-popup" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', zIndex: 9999,
          animation: 'fadeIn 0.3s ease',
        }}>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: '24px',
            padding: '40px', maxWidth: '420px', width: '90%',
            textAlign: 'center', position: 'relative',
            border: `2px solid ${lastScan.access === 'granted' ? 'var(--status-active)' : 'var(--status-danger)'}`,
            boxShadow: lastScan.access === 'granted'
              ? '0 0 60px rgba(52, 211, 153, 0.3)'
              : '0 0 60px rgba(248, 113, 113, 0.3)',
            animation: 'scaleIn 0.3s ease',
          }}>
            <button onClick={() => setShowProfile(false)} style={{
              position: 'absolute', top: '16px', right: '16px',
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: '4px',
            }}>
              <X size={20} />
            </button>

            {/* Access Icon */}
            <div style={{
              width: '100px', height: '100px', borderRadius: '50%', margin: '0 auto 20px',
              background: lastScan.access === 'granted' ? 'var(--status-active-bg)' : 'var(--status-danger-bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: lastScan.access === 'granted' ? 'var(--status-active)' : 'var(--status-danger)',
              animation: 'pulse-ring 1s ease-out',
            }}>
              {lastScan.access === 'granted'
                ? <ShieldCheck size={48} />
                : <ShieldAlert size={48} />
              }
            </div>

            {/* Access Status */}
            <div style={{
              fontSize: '22px', fontWeight: '800', marginBottom: '4px',
              color: lastScan.access === 'granted' ? 'var(--status-active)' : 'var(--status-danger)',
            }}>
              {lastScan.access === 'granted' ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
            </div>

            {/* Member Info */}
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%', margin: '20px auto 12px',
              background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '20px', fontWeight: '800',
              border: '2px solid var(--border-color)',
            }}>
              {getInitials(lastScan.member?.name)}
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '4px' }}>
              {lastScan.member?.name || 'Unknown Member'}
            </h2>

            {lastScan.member?.phone && (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '8px' }}>
                <Phone size={12} /> {lastScan.member.phone}
              </div>
            )}

            {/* Details Grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
              marginTop: '20px', textAlign: 'left',
            }}>
              <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Fingerprint ID</div>
                <div style={{ fontSize: '14px', fontWeight: '700', marginTop: '4px' }}>{lastScan.fingerprintId || 'N/A'}</div>
              </div>
              <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Scan Time</div>
                <div style={{ fontSize: '14px', fontWeight: '700', marginTop: '4px' }}>{formatTime(lastScan.scanTime)}</div>
              </div>
              <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Status</div>
                <div style={{ fontSize: '14px', fontWeight: '700', marginTop: '4px', color: lastScan.member?.status === 'active' ? 'var(--status-active)' : 'var(--status-danger)' }}>
                  {lastScan.member?.status?.toUpperCase() || 'N/A'}
                </div>
              </div>
              <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Expiry</div>
                <div style={{ fontSize: '14px', fontWeight: '700', marginTop: '4px' }}>
                  {lastScan.member?.latest_expiry || 'N/A'}
                </div>
              </div>
            </div>

            {lastScan.access !== 'granted' && (
              <div style={{
                marginTop: '20px', padding: '12px', borderRadius: '12px',
                background: 'var(--status-danger-bg)', color: 'var(--status-danger)',
                fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center',
                gap: '8px', justifyContent: 'center',
              }}>
                <ShieldAlert size={16} />
                {lastScan.status === 'EXPIRED' ? 'Membership fees have expired. Please renew.' : 'Fingerprint not registered or access denied.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Main Grid ── */}
      <div className="grid-2" style={{alignItems: 'start'}}>
        
        {/* ═══ Left Column: Live Feed + Access Logs (Tabbed) ═══ */}
        <div className="card" style={{padding: '24px', minHeight: '60vh'}}>
          {/* Tab Bar */}
          <div style={{ display: 'flex', gap: '4px', padding: '4px', background: 'var(--bg-tertiary)', borderRadius: '12px', marginBottom: '20px' }}>
            <button
              onClick={() => setActiveTab('live')}
              style={{
                flex: 1, padding: '10px', borderRadius: '10px', border: 'none',
                fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                transition: 'all 0.2s',
                background: activeTab === 'live' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'live' ? 'white' : 'var(--text-muted)',
              }}
            >
              <History size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> Live Feed
            </button>
            <button
              onClick={() => { setActiveTab('access-log'); fetchAccessLogs(); }}
              style={{
                flex: 1, padding: '10px', borderRadius: '10px', border: 'none',
                fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                transition: 'all 0.2s',
                background: activeTab === 'access-log' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'access-log' ? 'white' : 'var(--text-muted)',
              }}
            >
              <ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> Access Log
            </button>
          </div>

          {/* Header Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {activeTab === 'live'
                ? <><History size={18} className="text-primary" /> Today's Check-ins</>
                : <><ShieldCheck size={18} className="text-primary" /> Access Attempts</>
              }
            </h3>
            <button 
              className="btn btn-secondary btn-icon" 
              onClick={() => { fetchHistory(true); fetchAccessLogs(); }}
              title="Refresh"
            >
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            </button>
          </div>

          {/* Stats Bar */}
          <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: '12px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {activeTab === 'live' ? (
              <>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total Check-ins Today</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--text-primary)' }}>{history.length}</div>
                </div>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--status-active-bg)', color: 'var(--status-active)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UserCheck size={24} />
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '24px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Granted</div>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: 'var(--status-active)' }}>
                      {accessLogs.filter(l => l.status === 'GRANTED').length}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Denied</div>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: 'var(--status-danger)' }}>
                      {accessLogs.filter(l => l.status !== 'GRANTED').length}
                    </div>
                  </div>
                </div>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--status-info-bg)', color: 'var(--status-info)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ShieldCheck size={24} />
                </div>
              </>
            )}
          </div>

          {/* ── Tab Content: LIVE FEED ── */}
          {activeTab === 'live' && (
            <>
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
                  {history.map((log, idx) => {
                    const memberData = log.member || log.members;
                    return (
                      <div key={log.id || idx} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '16px', background: 'var(--bg-secondary)', borderRadius: '12px', marginBottom: '8px',
                        borderLeft: '4px solid var(--status-active)',
                        transition: 'all 0.3s ease',
                      }}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
                          <div style={{width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700'}}>
                            {getInitials(memberData?.name)}
                          </div>
                          <div>
                            <div style={{fontWeight: '700', fontSize: '15px'}}>{memberData?.name || 'Unknown Member'}</div>
                            <div style={{fontSize: '11px', color: 'var(--text-muted)'}}>PIN: {memberData?.fingerprint_id || 'N/A'}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: '800', fontSize: '14px' }}>{formatTime(log.check_in_time)}</div>
                          <div style={{ fontSize: '10px', color: 'var(--status-active)', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                            <CheckCircle2 size={10} /> Present
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Tab Content: ACCESS LOG ── */}
          {activeTab === 'access-log' && (
            <>
              {accessLogs.length === 0 ? (
                <div style={{padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)'}}>
                  <ShieldCheck size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
                  <div>No access attempts recorded today.</div>
                  <div style={{ fontSize: '12px', marginTop: '8px' }}>Scans will appear here in real-time</div>
                </div>
              ) : (
                <div className="attendance-list">
                  {accessLogs.map((log, idx) => {
                    const isGranted = log.status === 'GRANTED';
                    return (
                      <div key={log.id || idx} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '16px', background: 'var(--bg-secondary)', borderRadius: '12px', marginBottom: '8px',
                        borderLeft: `4px solid ${getStatusColor(log.status)}`,
                        transition: 'all 0.3s ease',
                      }}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
                          {/* Status Icon */}
                          <div style={{
                            width: '40px', height: '40px', borderRadius: '10px',
                            background: getStatusBg(log.status),
                            color: getStatusColor(log.status),
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '16px',
                          }}>
                            {isGranted
                              ? <CheckCircle2 size={20} />
                              : <XCircle size={20} />
                            }
                          </div>
                          <div>
                            <div style={{fontWeight: '700', fontSize: '15px'}}>
                              {log.member?.name || 'Unknown'}
                            </div>
                            <div style={{fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px'}}>
                              <Fingerprint size={10} /> PIN: {log.fingerprint_id || 'N/A'}
                              {log.device && <><span style={{opacity:0.3}}>•</span> {log.device}</>}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: '800', fontSize: '14px' }}>{formatTime(log.timestamp)}</div>
                          <div style={{
                            fontSize: '10px', fontWeight: '700',
                            color: getStatusColor(log.status),
                            display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end',
                          }}>
                            {getStatusIcon(log.status)} {getStatusLabel(log.status)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* ═══ Right Column: Enrollment + Manual Entry + Info ═══ */}
        <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>

          {/* ── Fingerprint Enrollment ── */}
          <div className="card" style={{padding: '24px', border: '1px solid var(--accent-border)'}}>
            <h3 style={{fontSize: '15px', fontWeight: '800', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: 8}}>
              <Link2 size={18} style={{color: 'var(--accent-primary)'}}/> Assign Fingerprint ID
            </h3>
            <p style={{fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px'}}>
              Link a fingerprint ID from the device to a member's profile. The ID will be used for automatic check-in and access control.
            </p>

            {!enrollMember ? (
              <>
                <div className="search-bar" style={{background: 'var(--bg-secondary)', marginBottom: '12px'}}>
                  <Search size={16} />
                  <input 
                    placeholder="Search Member to Enroll..." 
                    value={enrollSearch}
                    onChange={(e) => setEnrollSearch(e.target.value)}
                  />
                </div>
                {enrollSearch.length >= 2 && (
                  <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                    {enrollResults.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>No matches</div>
                    ) : (
                      enrollResults.map(m => (
                        <div key={m.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: '8px', marginBottom: '6px',
                          cursor: 'pointer', transition: 'all 0.2s',
                        }}
                          onClick={() => { setEnrollMember(m); setEnrollSearch(''); }}
                        >
                          <div>
                            <div style={{ fontWeight: '700', fontSize: '13px' }}>{m.name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {m.phone} {m.fingerprint_id ? `• FP: ${m.fingerprint_id}` : ''}
                            </div>
                          </div>
                          <Fingerprint size={16} style={{ color: 'var(--accent-primary)', opacity: 0.6 }} />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            ) : (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
                  background: 'var(--bg-tertiary)', borderRadius: '12px', marginBottom: '16px',
                }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px', background: 'var(--accent-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: '700', color: 'var(--accent-primary)', fontSize: '14px',
                  }}>
                    {getInitials(enrollMember.name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '700', fontSize: '14px' }}>{enrollMember.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {enrollMember.phone}
                      {enrollMember.fingerprint_id && ` • Current FP: ${enrollMember.fingerprint_id}`}
                    </div>
                  </div>
                  <button onClick={() => setEnrollMember(null)} style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px',
                  }}>
                    <X size={16} />
                  </button>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                    Fingerprint ID (from device)
                  </label>
                  <input
                    type="text"
                    value={enrollFpId}
                    onChange={(e) => setEnrollFpId(e.target.value)}
                    placeholder="e.g. 1, 2, 3..."
                    style={{
                      width: '100%', padding: '12px 16px', borderRadius: '10px',
                      border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)', fontSize: '14px', fontWeight: '600',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>

                <button
                  className="btn btn-primary btn-block"
                  onClick={handleEnroll}
                  disabled={enrolling || !enrollFpId.trim()}
                  style={{ fontWeight: '700' }}
                >
                  {enrolling ? 'Linking...' : '🔗 Link Fingerprint'}
                </button>
              </div>
            )}
          </div>
           
          {/* ── Manual Entry Fallback ── */}
          <div className="card" style={{padding: '24px'}}>
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

          {/* ── Device Status ── */}
          <div className="card" style={{padding: '24px'}}>
            <h3 style={{fontSize: '15px', fontWeight: '800', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: 8}}>
              <Fingerprint size={18} style={{color: 'var(--accent-primary)'}}/> Device Status
            </h3>
            <p style={{fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px'}}>
              The biometric device is connected. When a member scans their finger, they will automatically appear in the Live Feed.
            </p>
            <ul style={{padding: 0, margin: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px'}}>
              <li style={{fontSize: '13px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)'}}>
                <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--status-active)'}}></div>
                <CheckCircle2 size={12} style={{color: 'var(--status-active)'}}/> Active members get marked present.
              </li>
              <li style={{fontSize: '13px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)'}}>
                <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--status-danger)'}}></div>
                <XCircle size={12} style={{color: 'var(--status-danger)'}}/> Expired members are denied access.
              </li>
              <li style={{fontSize: '13px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)'}}>
                <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--status-info)'}}></div>
                <Fingerprint size={12} style={{color: 'var(--status-info)'}}/> Unregistered fingerprints are logged.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
