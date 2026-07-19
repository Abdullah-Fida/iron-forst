import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Download, FileSpreadsheet, Loader2, X } from 'lucide-react';
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

// ─── Main Component ──────────────────────────────────────────────────────────

export function ImportDataSection() {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState(null);
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

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Reset input so the same file can be re-uploaded if needed
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        processData(data);
      } catch (err) {
        toast.error('Error parsing file: ' + err.message);
      }
    };
    reader.readAsBinaryString(file);
  };

  const processData = (rows) => {
    const members = [];
    let totalPayments = 0;

    const headerMap = {};
    const paymentDateCols = [];
    const paymentAmountCols = [];
    let headerRowIndex = -1;

    // Flexible header scan: check first 10 rows
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!val) continue;

        // Member field headers — use includes() for robustness with merged/multi-line cells
        if (val === 'name' || val.includes('member name') || val.includes('full name')) {
          headerMap['name'] = c; headerRowIndex = Math.max(headerRowIndex, r);
        }
        if (val === 'gender' || val === 'sex') {
          headerMap['gender'] = c; headerRowIndex = Math.max(headerRowIndex, r);
        }
        if (val.includes('membership') || val.includes('member id') || val.includes('fingerprint') || val === 'sr no.' || val === 'sr no') {
          if (!headerMap.hasOwnProperty('membership_number')) {
            headerMap['membership_number'] = c; headerRowIndex = Math.max(headerRowIndex, r);
          }
        }
        if (val.includes('contact') || val.includes('phone') || val.includes('mobile')) {
          if (!headerMap.hasOwnProperty('phone')) {
            headerMap['phone'] = c; headerRowIndex = Math.max(headerRowIndex, r);
          }
        }
        if (val.includes('received by')) {
          headerMap['received_by'] = c; headerRowIndex = Math.max(headerRowIndex, r);
        }

        // Payment date columns: "Payment Date Oct 2025" or "Payment Date Oct-25"
        if (val.includes('payment date')) {
          const monthMatch = val.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
          if (monthMatch) {
            paymentDateCols.push({ month: monthMatch[1].toLowerCase(), colIndex: c });
          }
        }

        // Payment amount columns: "Oct-25" or "Oct 25"
        const amountMatch = val.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-\s]?(\d{2}|\d{4})$/i);
        if (amountMatch) {
          paymentAmountCols.push({
            monthStr: amountMatch[1].toLowerCase(),
            yearStr: amountMatch[2].length === 2 ? `20${amountMatch[2]}` : amountMatch[2],
            colIndex: c
          });
        }
      }
    }

    if (headerMap['name'] === undefined) {
      toast.error('Could not find a "Name" column in the first 10 rows. Please check your file format.');
      return;
    }

    rows.forEach((row, rowIndex) => {
      // Skip all header rows
      if (rowIndex <= headerRowIndex) return;
      if (!row || row.length === 0) return;

      const name = String(row[headerMap['name']] || '').trim();
      if (!name) return; // Skip empty rows

      const membership_number = String(row[headerMap['membership_number']] != null ? row[headerMap['membership_number']] : '').trim();
      const genderRaw = String(row[headerMap['gender']] || '').trim().toLowerCase();
      const gender = genderRaw === 'female' ? 'female' : 'male';
      const phone = String(row[headerMap['phone']] || '').trim();
      const received_by = String(row[headerMap['received_by']] || '').trim();

      const payments = [];

      paymentAmountCols.forEach(col => {
        const rawVal = row[col.colIndex];
        const amountStr = String(rawVal || '').replace(/,/g, '').trim();
        const amount = parseInt(amountStr, 10);

        if (!isNaN(amount) && amount > 0) {
          // Find matching payment date column
          const dateCol = paymentDateCols.find(d => d.month === col.monthStr);

          // Default to 1st of the payment month
          let payment_date = new Date(`${col.monthStr} 1, ${col.yearStr}`);

          if (dateCol !== undefined && row[dateCol.colIndex]) {
            const cellVal = row[dateCol.colIndex];
            if (cellVal instanceof Date && !isNaN(cellVal)) {
              payment_date = cellVal;
            } else {
              const parsed = new Date(cellVal);
              if (!isNaN(parsed)) payment_date = parsed;
            }
          }

          // Guard against invalid dates
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

      // Unique key: membership number > phone > name (in priority order)
      const uniqueKey = membership_number || phone || name;

      members.push({
        name,
        gender,
        membership_number: uniqueKey,
        phone: phone || '0000000000',
        payments
      });
    });

    if (members.length === 0) {
      toast.error('No valid member rows found. Make sure your file has a "Name" column with data below the header.');
      return;
    }

    setPreview({ totalMembers: members.length, totalPayments, members });
  };

  const handleImport = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const res = await api.post('/gym/import', { members: preview.members });
      toast.success(res.data.message || `Import successful! ${preview.totalMembers} members processed.`);
      setPreview(null);
      window.dispatchEvent(new CustomEvent('local-db-changed'));
    } catch (err) {
      toast.error('Import failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
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
          <label className="btn btn-primary" style={{ flex: 1, minWidth: 140, cursor: 'pointer', textAlign: 'center' }}>
            <FileSpreadsheet size={18} /> Import from Excel
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
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

          <div style={{ display: 'flex', gap: 'var(--space-xl)', fontSize: 'var(--font-sm)', marginBottom: 'var(--space-md)' }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-primary)' }}>{preview.totalMembers}</div>
              <div style={{ color: 'var(--text-muted)' }}>Members</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-primary)' }}>{preview.totalPayments}</div>
              <div style={{ color: 'var(--text-muted)' }}>Payments</div>
            </div>
          </div>

          {/* Sample preview list */}
          <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 'var(--space-md)', fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
            {preview.members.slice(0, 5).map((m, i) => (
              <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-color)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{m.name}</strong>
                <span style={{ marginLeft: 8 }}>{m.phone}</span>
                <span style={{ marginLeft: 8, color: 'var(--accent-primary)' }}>{m.payments.length} payment{m.payments.length !== 1 ? 's' : ''}</span>
              </div>
            ))}
            {preview.members.length > 5 && (
              <div style={{ padding: '4px 0', fontStyle: 'italic' }}>...and {preview.members.length - 5} more</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button className="btn btn-primary" onClick={handleImport} disabled={loading} style={{ flex: 1 }}>
              {loading ? <><Loader2 className="spin" size={18} /> Importing...</> : <><Upload size={18} /> Confirm Import</>}
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
