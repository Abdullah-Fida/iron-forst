import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Download, FileSpreadsheet, Loader2, X, Undo2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateForExcel(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}

function parseFlexibleDate(cellVal) {
  if (!cellVal) return null;
  // Already a Date object (XLSX cellDates: true)
  if (cellVal instanceof Date && !isNaN(cellVal)) return cellVal;
  const str = String(cellVal).trim();
  if (!str) return null;
  // Try DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (ddmmyyyy) {
    const day = parseInt(ddmmyyyy[1], 10);
    const month = parseInt(ddmmyyyy[2], 10);
    let year = parseInt(ddmmyyyy[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (!isNaN(d)) return d;
  }
  // Fallback: let JS parse it
  const parsed = new Date(str);
  if (!isNaN(parsed)) return parsed;
  return null;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ImportDataSection() {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [lastBatch, setLastBatch] = useState(null); // { batchId, imported, message }
  const [undoing, setUndoing] = useState(false);
  const toast = useToast();

  // ─── EXPORT ───────────────────────────────────────────────────────────────

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get('/gym/export');
      const members = res.data.data || [];

      if (!members.length) {
        toast.error('No members found to export.');
        return;
      }

      // Collect all unique payment months across all members
      const monthSet = new Set();
      members.forEach(m => {
        (m.payments || []).forEach(p => {
          if (p.payment_date) {
            const d = new Date(p.payment_date);
            if (!isNaN(d)) {
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              monthSet.add(key);
            }
          }
        });
      });

      // Sort months chronologically
      const sortedMonths = Array.from(monthSet).sort();

      // Build header row
      const headerCols = [
        'Sr No.', 'Name', 'Gender', 'Membership Number', 'Contact Number',
        ...sortedMonths.flatMap(ym => {
          const [y, m] = ym.split('-');
          const d = new Date(Number(y), Number(m) - 1, 1);
          const label = d.toLocaleString('en-US', { month: 'short' }) + '-' + String(y).slice(2);
          return [`Payment Date ${label}`, label];
        }),
        'Received By', 'Status', 'Latest Expiry'
      ];

      // Build data rows
      const rows = members.map((m, i) => {
        // Build a lookup of payments by month key
        const payByMonth = {};
        (m.payments || []).forEach(p => {
          if (p.payment_date) {
            const d = new Date(p.payment_date);
            if (!isNaN(d)) {
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              // Keep only first payment per month
              if (!payByMonth[key]) payByMonth[key] = p;
            }
          }
        });

        const receivedBy = m.payments?.find(p => p.received_by)?.received_by || '';

        const paymentCols = sortedMonths.flatMap(ym => {
          const pay = payByMonth[ym];
          return [
            pay ? formatDateForExcel(pay.payment_date) : '',
            pay ? pay.amount : ''
          ];
        });

        return [
          i + 1,
          m.name || '',
          m.gender || 'male',
          m.fingerprint_id || '',
          m.phone || '',
          ...paymentCols,
          receivedBy,
          m.status || '',
          formatDateForExcel(m.latest_expiry)
        ];
      });

      // Build worksheet
      const wsData = [headerCols, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Auto column widths
      ws['!cols'] = headerCols.map((h, i) => ({
        wch: Math.max(h.length, ...rows.map(r => String(r[i] || '').length)) + 2
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Members');

      const fileName = `iron-fost-members-${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success(`Exported ${members.length} members to ${fileName}`);
    } catch (err) {
      toast.error('Export failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setExporting(false);
    }
  };

  // ─── IMPORT ───────────────────────────────────────────────────────────────

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Reset input so the same file can be re-uploaded if needed
    e.target.value = '';
    
    setLoading(true);
    try {
      // Step 1: Parse the Excel file
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const bstr = evt.target.result;
            const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            resolve(rows);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsBinaryString(file);
      });

      // Step 2: Fetch existing members for duplicate detection
      let existingData = { membershipNumbers: {}, phones: {} };
      try {
        const existRes = await api.get('/gym/existing-members');
        existingData = existRes.data.data || existingData;
      } catch (err) {
        console.warn('Could not fetch existing members for duplicate check:', err.message);
      }

      // Step 3: Process the data
      processData(data, existingData);
    } catch (err) {
      toast.error('Error parsing file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const processData = (rows, existingData) => {
    const members = [];
    let totalPayments = 0;

    const headerMap = {};
    const paymentDateCols = [];
    const paymentAmountCols = [];
    let standaloneAmountCol = -1;
    let headerRowIndex = -1;

    // Flexible header scan: check first 10 rows
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!val) continue;

        // Member field headers
        if (val === 'name' || val.includes('member name') || val.includes('full name')) {
          headerMap['name'] = c; headerRowIndex = Math.max(headerRowIndex, r);
        }
        if (val === 'gender' || val === 'sex') {
          headerMap['gender'] = c; headerRowIndex = Math.max(headerRowIndex, r);
        }
        if (val.includes('membership') || val.includes('member id') || val.includes('fingerprint')) {
          if (!headerMap.hasOwnProperty('membership_number')) {
            headerMap['membership_number'] = c; headerRowIndex = Math.max(headerRowIndex, r);
          }
        }
        // "Sr No." should NOT be treated as membership number
        if (val === 'sr no.' || val === 'sr no') {
          headerMap['sr_no'] = c; headerRowIndex = Math.max(headerRowIndex, r);
        }
        if (val.includes('contact') || val.includes('phone') || val.includes('mobile')) {
          if (!headerMap.hasOwnProperty('phone')) {
            headerMap['phone'] = c; headerRowIndex = Math.max(headerRowIndex, r);
          }
        }
        if (val.includes('received by')) {
          headerMap['received_by'] = c; headerRowIndex = Math.max(headerRowIndex, r);
        }

        // ── JOIN DATE detection ──
        if (val.includes('member since') || val.includes('join date') || val.includes('joined') ||
            val.includes('joining date') || val.includes('registration date') || val.includes('joining')) {
          if (!headerMap.hasOwnProperty('join_date')) {
            headerMap['join_date'] = c; headerRowIndex = Math.max(headerRowIndex, r);
          }
        }

        // ── PAYMENT DATE columns ──
        // "Payment Date Oct 2025" or "Payment Date Oct-25" or "Payment Date Aug 2026"
        if (val.includes('payment date')) {
          const monthMatch = val.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
          if (monthMatch) {
            // Extract year from the header text
            const yearMatch = val.match(/(\d{4})/);
            const year2Match = val.match(/(\d{2})$/);
            let year = null;
            if (yearMatch) year = yearMatch[1];
            else if (year2Match) year = '20' + year2Match[1];
            
            paymentDateCols.push({ 
              month: monthMatch[1].toLowerCase(), 
              year,
              colIndex: c 
            });
          } else {
            // Generic "Payment Date" without month — treat as a date column
            paymentDateCols.push({ month: null, year: null, colIndex: c });
          }
          headerRowIndex = Math.max(headerRowIndex, r);
        }

        // ── AMOUNT columns ──
        // "Oct-25" or "Oct 25" or "Aug-26" (month-year as amount header)
        const amountMatch = val.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-\s]?(\d{2}|\d{4})$/i);
        if (amountMatch) {
          paymentAmountCols.push({
            monthStr: amountMatch[1].toLowerCase(),
            yearStr: amountMatch[2].length === 2 ? `20${amountMatch[2]}` : amountMatch[2],
            colIndex: c
          });
          headerRowIndex = Math.max(headerRowIndex, r);
        }

        // Standalone "Amount" column (no month in header)
        if (val === 'amount' || val === 'fee' || val === 'fees' || val === 'amount paid') {
          standaloneAmountCol = c;
          headerRowIndex = Math.max(headerRowIndex, r);
        }
      }
    }

    if (headerMap['name'] === undefined) {
      toast.error('Could not find a "Name" column in the first 10 rows. Please check your file format.');
      return;
    }

    // Build existing member lookup sets
    const existingMembershipNums = existingData.membershipNumbers || {};
    const existingPhones = existingData.phones || {};

    rows.forEach((row, rowIndex) => {
      // Skip all header rows
      if (rowIndex <= headerRowIndex) return;
      if (!row || row.length === 0) return;

      const name = String(row[headerMap['name']] || '').trim();
      if (!name) return; // Skip empty rows

      const membership_number = headerMap['membership_number'] !== undefined
        ? String(row[headerMap['membership_number']] != null ? row[headerMap['membership_number']] : '').trim()
        : '';
      const genderRaw = String(row[headerMap['gender']] || '').trim().toLowerCase();
      const gender = genderRaw === 'female' ? 'female' : 'male';
      const phone = String(row[headerMap['phone']] || '').trim();
      const received_by = String(row[headerMap['received_by']] || '').trim();

      // Parse join date
      let join_date = null;
      if (headerMap['join_date'] !== undefined) {
        const joinDateParsed = parseFlexibleDate(row[headerMap['join_date']]);
        if (joinDateParsed) {
          join_date = joinDateParsed.toISOString().split('T')[0];
        }
      }

      const payments = [];

      // Strategy 1: month-year amount columns like "Oct-25" paired with "Payment Date Oct"
      if (paymentAmountCols.length > 0) {
        paymentAmountCols.forEach(col => {
          const rawVal = row[col.colIndex];
          const amountStr = String(rawVal || '').replace(/,/g, '').trim();
          const amount = parseInt(amountStr, 10);

          if (!isNaN(amount) && amount > 0) {
            const dateCol = paymentDateCols.find(d => d.month === col.monthStr);
            let payment_date = new Date(`${col.monthStr} 1, ${col.yearStr}`);

            if (dateCol !== undefined && row[dateCol.colIndex]) {
              const parsed = parseFlexibleDate(row[dateCol.colIndex]);
              if (parsed) payment_date = parsed;
            }

            if (isNaN(payment_date)) {
              payment_date = new Date(`${col.monthStr} 1, ${col.yearStr}`);
            }

            payments.push({
              amount,
              payment_date: payment_date.toISOString().split('T')[0],
              plan_duration_months: 1,
              received_by: received_by || 'Import'
            });
            totalPayments++;
          }
        });
      }

      // Strategy 2: Standalone "Amount" column paired with "Payment Date <Month>" columns
      if (payments.length === 0 && standaloneAmountCol >= 0) {
        const rawAmount = row[standaloneAmountCol];
        const amountStr = String(rawAmount || '').replace(/,/g, '').trim();
        const amount = parseInt(amountStr, 10);

        if (!isNaN(amount) && amount > 0) {
          // Find the best payment date from available date columns
          let payment_date = null;

          // Try each payment date column
          for (const dateCol of paymentDateCols) {
            const cellVal = row[dateCol.colIndex];
            const parsed = parseFlexibleDate(cellVal);
            if (parsed) {
              payment_date = parsed;
              break; // Use the first valid date
            }
          }

          // If no payment date found, fall back to join_date
          if (!payment_date && join_date) {
            payment_date = new Date(join_date);
          }

          if (payment_date && !isNaN(payment_date)) {
            payments.push({
              amount,
              payment_date: payment_date.toISOString().split('T')[0],
              plan_duration_months: 1,
              received_by: received_by || 'Import'
            });
            totalPayments++;
          }
        }
      }

      // ── DUPLICATE CHECK ──
      let isDuplicate = false;
      let duplicateOf = '';

      if (membership_number) {
        const key = membership_number.toLowerCase();
        if (existingMembershipNums[key]) {
          isDuplicate = true;
          duplicateOf = existingMembershipNums[key];
        }
      }
      if (!isDuplicate && phone) {
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        if (cleanPhone.length >= 10) {
          const last10 = cleanPhone.slice(-10);
          for (const [existingPhone, existingName] of Object.entries(existingPhones)) {
            if (existingPhone.slice(-10) === last10) {
              isDuplicate = true;
              duplicateOf = existingName;
              break;
            }
          }
        }
      }

      members.push({
        name,
        gender,
        membership_number,
        phone: phone || '0000000000',
        join_date,
        payments,
        isDuplicate,
        duplicateOf
      });
    });

    if (members.length === 0) {
      toast.error('No valid member rows found. Make sure your file has a "Name" column with data below the header.');
      return;
    }

    const newMembers = members.filter(m => !m.isDuplicate);
    const duplicates = members.filter(m => m.isDuplicate);

    setPreview({ 
      totalMembers: members.length, 
      totalPayments, 
      newCount: newMembers.length,
      duplicateCount: duplicates.length,
      members 
    });
  };

  const handleImport = async () => {
    if (!preview) return;
    const newMembers = preview.members.filter(m => !m.isDuplicate);
    if (newMembers.length === 0) {
      toast.error('All members already exist. Nothing to import.');
      return;
    }

    setLoading(true);
    try {
      const batchId = `import_${Date.now()}`;
      // Strip isDuplicate/duplicateOf before sending to backend
      const cleanMembers = newMembers.map(({ isDuplicate, duplicateOf, ...rest }) => rest);
      
      const res = await api.post('/gym/import', { members: cleanMembers, batchId });
      const data = res.data;
      
      toast.success(data.message || 'Import successful!');
      
      // Save batch info for undo
      if (data.imported > 0) {
        setLastBatch({
          batchId: data.batchId,
          imported: data.imported,
          message: data.message
        });
      }
      
      setPreview(null);
      window.dispatchEvent(new CustomEvent('local-db-changed'));
    } catch (err) {
      toast.error('Import failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async () => {
    if (!lastBatch) return;
    if (!window.confirm(`This will permanently remove ${lastBatch.imported} member(s) and all their payments that were just imported.\n\nAre you sure?`)) return;

    setUndoing(true);
    try {
      const res = await api.delete(`/gym/undo-import/${lastBatch.batchId}`);
      if (res.data.success) {
        toast.success(res.data.message || 'Undo complete!');
        setLastBatch(null);
        window.dispatchEvent(new CustomEvent('local-db-changed'));
      } else {
        toast.error(res.data.message || 'Undo failed.');
      }
    } catch (err) {
      toast.error('Undo failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setUndoing(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ marginTop: 'var(--space-lg)' }}>
      <h3 className="section-title">Data Management</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)', marginBottom: 'var(--space-md)' }}>
        Import members from your Excel sheet or export all current data to Excel for backup or editing.
      </p>

      {/* Action Buttons */}
      {!preview && (
        <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', marginBottom: 'var(--space-md)' }}>
          {/* Export Button */}
          <button
            className="btn btn-secondary"
            onClick={handleExport}
            disabled={exporting}
            style={{ flex: 1, minWidth: 140 }}
          >
            {exporting
              ? <><Loader2 className="spin" size={18} /> Exporting...</>
              : <><Download size={18} /> Export to Excel</>
            }
          </button>

          {/* Import Button */}
          <label className="btn btn-primary" style={{ flex: 1, minWidth: 140, cursor: loading ? 'wait' : 'pointer', textAlign: 'center', opacity: loading ? 0.6 : 1 }}>
            {loading
              ? <><Loader2 className="spin" size={18} /> Processing...</>
              : <><FileSpreadsheet size={18} /> Import from Excel</>
            }
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              disabled={loading}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      )}

      {/* Undo Last Import */}
      {lastBatch && !preview && (
        <div style={{ 
          padding: 'var(--space-md)', 
          border: '1px solid rgba(255,152,0,0.3)', 
          borderRadius: 'var(--radius-md)', 
          background: 'rgba(255,152,0,0.05)', 
          marginBottom: 'var(--space-md)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-md)',
          flexWrap: 'wrap'
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <AlertTriangle size={16} style={{ color: '#ff9800' }} />
              <strong style={{ fontSize: 'var(--font-sm)', color: 'var(--text-primary)' }}>Last Import</strong>
            </div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
              {lastBatch.imported} member(s) imported. Click undo to reverse this import.
            </div>
          </div>
          <button 
            className="btn btn-secondary" 
            onClick={handleUndo} 
            disabled={undoing}
            style={{ 
              color: '#f44336', 
              borderColor: 'rgba(244,67,54,0.3)',
              minWidth: 120
            }}
          >
            {undoing ? <><Loader2 className="spin" size={16} /> Undoing...</> : <><Undo2 size={16} /> Undo Import</>}
          </button>
        </div>
      )}

      {/* Import Preview */}
      {preview && (
        <div style={{ padding: 'var(--space-md)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-md)' }}>
            <h4 style={{ color: 'var(--text-primary)', margin: 0 }}>Import Preview</h4>
            <button
              className="btn btn-icon"
              onClick={() => setPreview(null)}
              disabled={loading}
              style={{ padding: 4 }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Summary Stats */}
          <div style={{ display: 'flex', gap: 'var(--space-xl)', fontSize: 'var(--font-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-primary)' }}>{preview.newCount}</div>
              <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle size={14} style={{ color: '#4caf50' }} /> New Members
              </div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: preview.duplicateCount > 0 ? '#f44336' : 'var(--text-muted)' }}>{preview.duplicateCount}</div>
              <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <XCircle size={14} style={{ color: '#f44336' }} /> Duplicates (Skipped)
              </div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-primary)' }}>{preview.totalPayments}</div>
              <div style={{ color: 'var(--text-muted)' }}>Payments</div>
            </div>
          </div>

          {/* Full Preview Table */}
          <div style={{ 
            maxHeight: 400, 
            overflowY: 'auto', 
            overflowX: 'auto',
            marginBottom: 'var(--space-md)', 
            border: '1px solid var(--border-color)', 
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-xs)'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Phone</th>
                  <th style={thStyle}>Gender</th>
                  <th style={thStyle}>Member Since</th>
                  <th style={thStyle}>Membership #</th>
                  <th style={thStyle}>Payment Date</th>
                  <th style={thStyle}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.members.map((m, i) => {
                  const isDup = m.isDuplicate;
                  const rowBg = isDup ? 'rgba(244,67,54,0.05)' : (i % 2 === 0 ? 'transparent' : 'var(--bg-tertiary)');
                  return (
                    <tr key={i} style={{ background: rowBg, opacity: isDup ? 0.6 : 1 }}>
                      <td style={tdStyle}>{i + 1}</td>
                      <td style={tdStyle}>
                        {isDup 
                          ? <span style={{ color: '#f44336', fontWeight: 700, fontSize: 11 }}>❌ Exists</span>
                          : <span style={{ color: '#4caf50', fontWeight: 700, fontSize: 11 }}>✅ New</span>
                        }
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600, textDecoration: isDup ? 'line-through' : 'none' }}>
                        {m.name}
                        {isDup && m.duplicateOf && (
                          <div style={{ fontSize: 10, color: '#f44336', fontWeight: 400, textDecoration: 'none' }}>
                            Matches: {m.duplicateOf}
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>{m.phone}</td>
                      <td style={tdStyle}>{m.gender}</td>
                      <td style={tdStyle}>{formatDateShort(m.join_date)}</td>
                      <td style={tdStyle}>{m.membership_number || '—'}</td>
                      <td style={tdStyle}>
                        {m.payments.length > 0 
                          ? m.payments.map((p, pi) => (
                              <div key={pi}>{formatDateShort(p.payment_date)}</div>
                            ))
                          : '—'
                        }
                      </td>
                      <td style={tdStyle}>
                        {m.payments.length > 0 
                          ? m.payments.map((p, pi) => (
                              <div key={pi}>{Number(p.amount).toLocaleString()}</div>
                            ))
                          : '—'
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Duplicate Warning */}
          {preview.duplicateCount > 0 && (
            <div style={{ 
              padding: '10px 14px', 
              background: 'rgba(244,67,54,0.08)', 
              borderRadius: 'var(--radius-sm)', 
              marginBottom: 'var(--space-md)',
              fontSize: 'var(--font-xs)',
              color: '#f44336',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <XCircle size={16} />
              <span><strong>{preview.duplicateCount} member(s)</strong> already exist in your system and will be skipped. Only {preview.newCount} new member(s) will be imported.</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button 
              className="btn btn-primary" 
              onClick={handleImport} 
              disabled={loading || preview.newCount === 0} 
              style={{ flex: 1 }}
            >
              {loading 
                ? <><Loader2 className="spin" size={18} /> Importing...</> 
                : <><Upload size={18} /> Confirm Import ({preview.newCount} members)</>
              }
            </button>
            <button className="btn btn-secondary" onClick={() => setPreview(null)} disabled={loading}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Table styles
const thStyle = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  borderBottom: '2px solid var(--border-color)',
  whiteSpace: 'nowrap'
};

const tdStyle = {
  padding: '6px 10px',
  borderBottom: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  verticalAlign: 'top'
};
