import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, Trash2, UserPlus, EyeOff, Eye, Wifi, WifiOff, Loader2, ChevronRight } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { matchesText } from '../../lib/search';
import { formatDateShort, getInitials } from '../../lib/utils';
import { StateView } from '../../components/common/StateView';
import { ModernLoader } from '../../components/common/ModernLoader';
import '../../styles/members.css';
import '../../styles/device.css';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    : '';

// Privilege 14 = administrator on the machine (can open its settings menu)
const isAdmin = (u) => Number(u.privilege) === 14;

const displayName = (u) => u.member?.name || u.device_name || `Fingerprint ID ${u.pin}`;

// When this person turned up: enrolled on the machine, scanned at the door, or listed
const appearedAt = (u) => u.enrolled_at || u.last_scan_at || u.first_seen_at;

function memberBadge(m) {
  if (!m) return { cls: 'secondary', text: 'Not in software' };
  if (m.unpaid_2_months) return { cls: 'danger', text: m.days_overdue !== null ? `Unpaid ${m.days_overdue} days` : 'Never paid' };
  if (m.days_overdue !== null && m.days_overdue > 0) return { cls: 'warning', text: `Expired ${m.days_overdue}d ago` };
  if (m.days_overdue === null) return { cls: 'secondary', text: 'No payment' };
  return { cls: 'active', text: 'Active' };
}

/**
 * Fingerprint machine: who is enrolled on it, how they match members, new
 * registrations to add, and deleting users from the machine.
 */
export default function DevicePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [section, setSection] = useState('new');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState([]); // delete command ids we are waiting on
  const [report, setReport] = useState(null);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/device/users');
      setData(res.data.data);
      setLoadError(null);
      if (firstLoad.current) {
        firstLoad.current = false;
        // Nothing new to add: open on the full machine list instead
        const d = res.data.data;
        if (d && !d.users.some((u) => u.is_new)) setSection('machine');
      }
    } catch (err) {
      setLoadError(err.response?.data?.message || 'Could not load the fingerprint machine list');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Follow deletes until the machine has answered every one, then say what happened.
  const checkCommands = useCallback(async () => {
    if (!watching.length) return;
    try {
      const res = await api.get('/device/commands', { params: { ids: watching.join(',') } });
      const cmds = res.data.data.commands;
      const open = cmds.filter((c) => c.status === 'queued' || c.status === 'sent');
      // Deleting the member in the software runs just after the machine confirms
      const settling = cmds.some((c) => c.status === 'done' && c.memberName && !c.memberResult);
      if (open.length || settling) return;
      const done = cmds.filter((c) => c.status === 'done');
      const failed = cmds.filter((c) => c.status === 'failed');
      const membersDeleted = done.filter((c) => c.memberResult === 'deleted' || c.memberResult === 'already_deleted').length;
      // The server restarted while waiting: those deletes were never sent
      const lost = watching.filter((id) => !cmds.some((c) => c.id === id)).length;
      if (lost) {
        failed.push(...Array.from({ length: lost }, (_, i) => ({ id: `lost-${i}`, pin: '?', error: 'The server restarted before this was sent. Check the list and delete again if needed.' })));
      }
      setWatching([]);
      setReport({ done, failed, membersDeleted, at: new Date().toISOString() });
      if (done.length && !failed.length) {
        toast.success(`Deleted ${plural(done.length, 'user')} from the machine${membersDeleted ? `, ${plural(membersDeleted, 'member')} also deleted in the software` : ''}`);
      } else if (failed.length) {
        toast.error(`${plural(failed.length, 'delete')} did not go through. See the list at the top.`);
      }
      window.dispatchEvent(new Event('device-updated'));
      load();
    } catch {
      // try again on the next tick
    }
  }, [watching, load, toast]);

  const reading = data?.device?.read?.status === 'running';
  const active = reading || watching.length > 0 || (data?.device?.pendingCommands || 0) > 0;
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      load();
      checkCommands();
    }, active ? 4000 : 30000);
    return () => clearInterval(t);
  }, [active, load, checkCommands]);

  useEffect(() => { setSelected(new Set()); }, [section, filter]);

  const users = useMemo(() => data?.users || [], [data]);
  const pendingPins = useMemo(() => new Set((data?.device?.pendingDeletes || []).map((c) => c.pin)), [data]);

  const groups = useMemo(() => {
    const newRegs = users
      .filter((u) => !u.member && u.source !== 'initial' && (showHidden || !u.dismissed))
      .sort((a, b) => Date.parse(appearedAt(b) || 0) - Date.parse(appearedAt(a) || 0));
    const linked = users.filter((u) => u.member);
    const unlinked = users.filter((u) => !u.member);
    const unpaid = linked
      .filter((u) => u.member.unpaid_2_months)
      .sort((a, b) => (b.member.days_overdue ?? 99999) - (a.member.days_overdue ?? 99999));
    return { newRegs, all: users, linked, unlinked, unpaid, softwareOnly: data?.softwareOnly || [] };
  }, [users, data, showHidden]);

  const newCount = users.filter((u) => u.is_new).length;

  const rows = useMemo(() => {
    const source = section === 'new' ? groups.newRegs
      : filter === 'linked' ? groups.linked
        : filter === 'unlinked' ? groups.unlinked
          : filter === 'unpaid' ? groups.unpaid
            : filter === 'software' ? groups.softwareOnly
              : groups.all;
    if (!search.trim()) return source;
    return source.filter((u) => {
      const m = u.member || u;
      return matchesText(`${u.pin ?? u.fingerprint_id} ${u.device_name || ''} ${m.name || ''} ${m.phone || ''} ${m.membership_id || ''}`, search);
    });
  }, [section, filter, groups, search]);

  const selectable = !(section === 'machine' && filter === 'software');
  // Machine admins are never bulk-selected: deleting the last one can open the
  // machine's settings menu to anyone. They can still be deleted one at a time.
  const selectableRows = selectable ? rows.filter((u) => !pendingPins.has(u.pin) && !isAdmin(u)) : [];
  const allSelected = selectableRows.length > 0 && selectableRows.every((u) => selected.has(u.pin));

  const toggle = (pin) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(pin)) next.delete(pin); else next.add(pin);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableRows.map((u) => u.pin)));

  // ── Actions ──
  const readFromMachine = async () => {
    setBusy(true);
    try {
      const res = await api.post('/device/sync');
      toast.info(res.data.message);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not ask the machine for its users');
    } finally {
      setBusy(false);
    }
  };

  const deleteUsers = async (list) => {
    if (!list.length) return;
    const linked = list.filter((u) => u.member);
    const admins = list.filter(isAdmin);
    const ok = await confirm({
      title: list.length === 1 ? `Delete ${displayName(list[0])} from the machine?` : `Delete ${list.length} users from the machine?`,
      message: (
        <span className="device-confirm">
          {list.length > 1 && (
            <span className="device-confirm-list">
              {list.slice(0, 12).map((u) => <span key={u.pin}>ID {u.pin} · {displayName(u)}</span>)}
              {list.length > 12 && <span>and {list.length - 12} more</span>}
            </span>
          )}
          Their finger and face will stop opening the door.
          {linked.length > 0 && (
            <strong className="device-confirm-warn">
              {list.length === 1
                ? ' This member will also be deleted in the software.'
                : linked.length === 1
                  ? ' 1 of them is a member and will also be deleted in the software.'
                  : ` ${linked.length} of them are members and will also be deleted in the software.`}
            </strong>
          )}
          {linked.length > 0 && ' Their payment history stays for your reports.'}
          {admins.length > 0 && (
            <strong className="device-confirm-warn">
              {' '}{displayName(admins[0])} is an admin on the machine. Make sure another admin remains, or anyone can open the machine's settings.
            </strong>
          )}
        </span>
      ),
      confirmText: list.length === 1 ? 'Delete' : `Delete ${list.length}`,
      type: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post('/device/delete', { pins: list.map((u) => u.pin) });
      const ids = res.data.data.queued.map((c) => c.id);
      setWatching((w) => [...new Set([...w, ...ids])]);
      setSelected(new Set());
      setReport(null);
      toast.info(res.data.message);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not send the delete to the machine');
    } finally {
      setBusy(false);
    }
  };

  const setHidden = async (u, dismissed) => {
    try {
      await api.put(`/device/users/${encodeURIComponent(u.pin)}/dismiss`, { dismissed });
      window.dispatchEvent(new Event('device-updated'));
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update');
    }
  };

  const addMember = (u) => {
    navigate('/members/add', { state: { prefill: { fingerprint_id: u.pin, name: u.device_name || '' } } });
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="page-container">
        <div style={{ padding: '60px 0', display: 'flex', justifyContent: 'center' }}>
          <ModernLoader type="morph" text="Loading fingerprint machine..." />
        </div>
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <div className="page-container">
        <StateView type="error" title="Could not load" description={loadError} onRetry={() => { setLoading(true); load(); }} />
      </div>
    );
  }

  if (data?.tableMissing) {
    return (
      <div className="page-container">
        <div className="page-header"><div><h1 className="page-title">Fingerprint machine</h1></div></div>
        <StateView type="error" title="Not set up yet" description={data.message} />
      </div>
    );
  }

  const device = data.device;
  const read = device.read;

  return (
    <div className="page-container device-page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 className="page-title">Fingerprint machine</h1>
          <p className="page-subtitle">{plural(users.length, 'user')} on the machine · {plural(groups.linked.length, 'linked member')}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={readFromMachine} disabled={busy || reading}>
          {reading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          <span className="device-btn-label long">{reading ? 'Reading…' : 'Read users from machine'}</span>
          <span className="device-btn-label short">{reading ? 'Reading…' : 'Read users'}</span>
        </button>
      </div>

      {/* Machine status */}
      <div className="card device-status">
        <span className={`device-chip ${device.online ? 'on' : 'off'}`}>
          {device.online ? <Wifi size={14} /> : <WifiOff size={14} />}
          {device.online ? 'Connected' : 'Not connected'}
        </span>
        <span className="device-status-text">
          {device.lastSeenAt ? `Last contact ${ago(device.lastSeenAt)}` : 'No contact since the server started'}
          {device.reported?.users != null && ` · machine says ${plural(device.reported.users, 'user')}`}
        </span>
        <span className="device-status-text">
          {reading
            ? (read.stage === 'by_pin'
              ? `Checking each fingerprint ID… ${plural(read.usersReceived, 'user')} found so far`
              : `Reading users… ${read.usersReceived} received`)
            : read?.status === 'done'
              ? `Last read ${ago(read.finishedAt)}: ${plural(read.usersReceived, 'user')}${read.message ? ` · ${read.message}` : ''}`
              : read?.status === 'failed'
                ? read.message
                : !data.hasList
                  ? 'Press "Read users from machine" once to load everyone. New registrations show up here by themselves.'
                  : null}
        </span>
        {watching.length > 0 && (
          <span className="device-status-text"><Loader2 size={13} className="spin" /> Waiting for the machine to confirm {plural(watching.length, 'delete')}…</span>
        )}
      </div>

      {report && (report.failed.length > 0) && (
        <div className="card device-report">
          <strong>{plural(report.failed.length, 'delete')} did not go through</strong>
          <ul>
            {report.failed.map((c) => (
              <li key={c.id}>ID {c.pin}{c.memberName ? ` · ${c.memberName}` : ''}: {c.error}</li>
            ))}
          </ul>
          <button className="btn-text-only" onClick={() => setReport(null)}>Dismiss</button>
        </div>
      )}

      {/* Sections */}
      <div className="device-sections" role="tablist">
        <button role="tab" aria-selected={section === 'new'} className={section === 'new' ? 'active' : ''} onClick={() => setSection('new')}>
          New registrations{newCount > 0 && <span className="device-count">{newCount}</span>}
        </button>
        <button role="tab" aria-selected={section === 'machine'} className={section === 'machine' ? 'active' : ''} onClick={() => setSection('machine')}>
          All on machine <span className="device-count muted">{users.length}</span>
        </button>
      </div>

      <div className="search-bar">
        <Search />
        <input placeholder="Search name, phone or fingerprint ID" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {section === 'machine' && (
        <div className="filter-tabs">
          {[
            ['all', `All (${groups.all.length})`],
            ['linked', `Linked (${groups.linked.length})`],
            ['unlinked', `Not in software (${groups.unlinked.length})`],
            ['unpaid', `Unpaid 2+ months (${groups.unpaid.length})`],
            ...(data.hasList ? [['software', `In software, not on machine (${groups.softwareOnly.length})`]] : []),
          ].map(([key, label]) => (
            <button key={key} className={`filter-tab ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
      )}

      {section === 'new' && (
        <p className="device-hint">
          People enrolled on the machine who are not members in the software yet. Tap <strong>Add member</strong>, fill in the phone and fee, and save.
          {' '}<button className="btn-text-only" onClick={() => setShowHidden((v) => !v)}>{showHidden ? 'Hide hidden ones' : 'Show hidden ones'}</button>
        </p>
      )}
      {section === 'machine' && filter === 'unpaid' && (
        <p className="device-hint">Members on the machine whose fee ended {data.unpaidDays}+ days ago (or who never paid and joined {data.unpaidDays}+ days ago).</p>
      )}
      {section === 'machine' && filter === 'software' && (
        <p className="device-hint">Members with a fingerprint ID that the machine does not have. Their finger will not work at the door; check the ID on their profile.</p>
      )}

      {selectable && selectableRows.length > 0 && (
        <label className="device-select-all">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Select all shown ({selectableRows.length})
        </label>
      )}

      <div className="members-content">
        {rows.length === 0 ? (
          <StateView
            type="empty"
            title={search ? 'No match' : section === 'new' ? 'No new registrations' : 'Nobody here'}
            description={search
              ? 'Try a different name or ID.'
              : section === 'new'
                ? 'When the gym enrolls someone on the machine, they appear here so you can add them as a member.'
                : !data.hasList
                  ? 'Press "Read users from machine" to load the list.'
                  : 'No users match this filter.'}
          />
        ) : section === 'machine' && filter === 'software' ? (
          rows.map((m) => (
            <div key={m.id} className="member-card" onClick={() => navigate(`/members/${m.id}`)}>
              <div className="avatar" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{getInitials(m.name || '?')}</div>
              <div className="member-info">
                <div className="member-name">{m.name}</div>
                <div className="member-tags">
                  <span className="member-tag missing">FP {m.fingerprint_id} not on machine</span>
                  {m.membership_id && <span className="member-tag">{m.membership_id}</span>}
                  {m.phone && <span className="member-tag">{m.phone}</span>}
                </div>
              </div>
              <ChevronRight size={18} style={{ alignSelf: 'center', color: 'var(--text-muted)' }} />
            </div>
          ))
        ) : (
          rows.map((u) => {
            const pending = pendingPins.has(u.pin);
            const badge = memberBadge(u.member);
            const nameOnMachineDiffers = u.member && u.device_name && u.device_name.trim().toLowerCase() !== u.member.name.trim().toLowerCase();
            return (
              <div key={u.pin} className={`member-card device-row ${pending ? 'pending' : ''} ${selected.has(u.pin) ? 'selected' : ''}`}>
                <input
                  type="checkbox"
                  className="device-check"
                  aria-label={`Select ${displayName(u)}`}
                  checked={selected.has(u.pin)}
                  disabled={pending || isAdmin(u)}
                  title={isAdmin(u) ? 'Machine admins are deleted one at a time' : undefined}
                  onChange={() => toggle(u.pin)}
                />
                <div className="avatar device-pin" title="Fingerprint ID">{u.pin}</div>
                <div className="member-info" onClick={() => u.member && navigate(`/members/${u.member.id}`)} style={{ cursor: u.member ? 'pointer' : 'default' }}>
                  <div className="member-name">{u.member?.name || u.device_name || <span className="device-noname">No name on machine</span>}</div>
                  <div className="member-tags">
                    {u.member?.membership_id && <span className="member-tag">{u.member.membership_id}</span>}
                    {u.member?.phone && <span className="member-tag">{u.member.phone}</span>}
                    {nameOnMachineDiffers && <span className="member-tag">On machine: {u.device_name}</span>}
                    {u.fingers > 0 && <span className="member-tag">{plural(u.fingers, 'finger')}</span>}
                    {u.has_face && <span className="member-tag">Face</span>}
                    {isAdmin(u) && <span className="member-tag missing">Machine admin</span>}
                    {u.dismissed && <span className="member-tag">Hidden</span>}
                  </div>
                  {section === 'new' && (
                    <div className="device-when">
                      {u.enrolled_at ? `Enrolled ${when(u.enrolled_at)}` : u.source === 'scan' ? `First seen at the door ${when(u.first_seen_at)}` : `Found on machine ${when(u.first_seen_at)}`}
                      {u.last_scan_at && ` · last scan ${ago(u.last_scan_at)}`}
                    </div>
                  )}
                  {section === 'machine' && u.member?.latest_expiry && (
                    <div className="device-when">Fee {u.member.days_overdue > 0 ? 'ended' : 'ends'} {formatDateShort(u.member.latest_expiry)}</div>
                  )}
                </div>
                <div className="member-meta">
                  {pending ? (
                    <span className="badge badge-secondary"><Loader2 size={12} className="spin" /> Deleting…</span>
                  ) : (
                    <span className={`badge badge-${badge.cls}`}>{badge.text}</span>
                  )}
                  <div className="device-actions">
                    {!u.member && !pending && (
                      <button className="btn btn-primary btn-sm" onClick={() => addMember(u)}>
                        <UserPlus size={15} /> Add member
                      </button>
                    )}
                    {section === 'new' && !pending && (
                      <button className="btn-icon-plain" onClick={() => setHidden(u, !u.dismissed)} title={u.dismissed ? 'Show again' : 'Hide from new registrations'} aria-label={u.dismissed ? 'Show again' : 'Hide'}>
                        {u.dismissed ? <Eye size={17} /> : <EyeOff size={17} />}
                      </button>
                    )}
                    {!pending && (
                      <button className="btn-icon-plain danger" onClick={() => deleteUsers([u])} title="Delete from machine" aria-label={`Delete ${displayName(u)} from machine`} disabled={busy}>
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {selected.size > 0 && (
        <div className="device-bulk-bar">
          <span>{selected.size} selected</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          <button
            className="btn btn-sm device-delete-btn"
            disabled={busy}
            onClick={() => deleteUsers(users.filter((u) => selected.has(u.pin)))}
          >
            <Trash2 size={15} /> Delete from machine
          </button>
        </div>
      )}
    </div>
  );
}
