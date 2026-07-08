/**
 * Iron Fost — Thermal Printer Utility
 * 
 * Builds receipt HTML optimized for 58mm / 80mm thermal printers
 * and prints directly via a hidden iframe (no save dialog).
 */

import { formatPKR, formatDate, formatDateTime } from './utils';

// ── Settings (persisted in localStorage) ──────────────────

const SETTINGS_KEY = 'core_gym_printer_settings';

const DEFAULT_SETTINGS = {
  paperWidth: '58mm',  // '58mm' or '80mm'
};

export function getPrinterSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function savePrinterSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...getPrinterSettings(), ...settings }));
}

// ── Thermal CSS ───────────────────────────────────────────

function thermalCSS(paperWidth) {
  const widthPx = paperWidth === '80mm' ? '302px' : '218px'; // ~80mm ≈ 302px, ~58mm ≈ 218px at 96dpi
  const fontSize = paperWidth === '80mm' ? '13px' : '11px';

  return `
    @page {
      size: ${paperWidth} auto;
      margin: 0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: ${fontSize};
      width: ${widthPx};
      max-width: ${widthPx};
      padding: 6px;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
    }
    .receipt { width: 100%; }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .line { border-top: 1px dashed #000; margin: 4px 0; }
    .double-line { border-top: 2px solid #000; margin: 4px 0; }
    .row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
      gap: 4px;
    }
    .row .label { flex-shrink: 0; font-weight: 600; }
    .row .value { text-align: right; word-break: break-word; }
    .header { font-size: ${paperWidth === '80mm' ? '16px' : '14px'}; font-weight: 800; margin: 4px 0; }
    .sub-header { font-size: ${paperWidth === '80mm' ? '12px' : '10px'}; margin-bottom: 4px; }
    .footer { font-size: ${paperWidth === '80mm' ? '11px' : '9px'}; margin-top: 6px; color: #333; }
    .total-row { font-size: ${paperWidth === '80mm' ? '15px' : '13px'}; font-weight: 800; }
    @media print {
      html, body { width: ${widthPx}; }
    }
  `;
}

// ── Receipt HTML Builder ──────────────────────────────────

/**
 * Build thermal-optimized receipt HTML.
 * 
 * @param {Object} data
 * @param {string} data.gymName       — Gym name for the header
 * @param {string} data.invoiceId     — Short invoice ID
 * @param {string} data.memberName    — Member full name
 * @param {string} [data.memberPhone] — Member phone
 * @param {number|string} data.amount — Total amount
 * @param {string} [data.paymentDate] — Payment date string
 * @param {string} [data.paymentMethod] — cash, online, etc.
 * @param {string} [data.expiryDate]  — Membership valid till
 * @param {string} [data.receivedBy]  — Staff who received
 * @param {string} [data.reason]      — Payment reason label
 * @param {string} [data.notes]       — Extra notes
 * @param {Array}  [data.items]       — Itemized breakdown [{label, amount}]
 * @param {number} [data.total]       — Grand total (if itemized)
 * @returns {string} Full HTML document string
 */
export function buildReceiptHTML(data) {
  const settings = getPrinterSettings();
  const css = thermalCSS(settings.paperWidth);
  const shortId = data.invoiceId ? String(data.invoiceId).substring(0, 8) : '';
  const printedAt = formatDateTime(new Date().toISOString());

  // Payment date formatting
  const paymentDateStr = (() => {
    if (!data.paymentDate) return formatDate(new Date().toISOString());
    const hasTime = String(data.paymentDate).includes('T') ||
      new Date(data.paymentDate).getHours() ||
      new Date(data.paymentDate).getMinutes();
    return hasTime ? formatDateTime(data.paymentDate) : formatDate(data.paymentDate);
  })();

  // Build rows
  let itemsHTML = '';
  if (data.items && Array.isArray(data.items) && data.items.length > 0) {
    // Itemized receipt (e.g. membership + registration)
    itemsHTML = data.items.map(it =>
      `<div class="row"><span class="label">${it.label}</span><span class="value">${formatPKR(it.amount)}</span></div>`
    ).join('');
    itemsHTML += `<div class="line"></div>`;
    itemsHTML += `<div class="row total-row"><span class="label">TOTAL</span><span class="value">${formatPKR(data.total || data.amount)}</span></div>`;
  } else {
    // Single amount
    itemsHTML = `<div class="row total-row"><span class="label">Amount</span><span class="value">${formatPKR(data.amount)}</span></div>`;
  }

  let finalGymName = data.gymName;
  if (!finalGymName || finalGymName === 'GYM' || finalGymName === 'IRON FOST') {
    try {
      const cachedRaw = localStorage.getItem('core_gym_settings');
      const userRaw = localStorage.getItem('core_gym_user');
      const settings = cachedRaw ? JSON.parse(cachedRaw) : {};
      const userObj = userRaw ? JSON.parse(userRaw) : {};
      finalGymName = settings.gym_name || userObj.gym_name || 'IRON FOST';
    } catch (e) {
      finalGymName = 'IRON FOST';
    }
  }

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt</title>
  <style>${css}</style>
</head>
<body>
  <div class="receipt">
    <div class="double-line"></div>
    <div class="center header">${finalGymName || 'GYM'}</div>
    <div class="center sub-header">Payment Receipt</div>
    <div class="double-line"></div>

    <div class="row"><span class="label">Invoice</span><span class="value">${shortId}</span></div>
    <div class="row"><span class="label">Date</span><span class="value">${paymentDateStr}</span></div>
    <div class="line"></div>

    <div class="row"><span class="label">Member</span><span class="value">${data.memberName || ''}</span></div>
    ${data.memberPhone ? `<div class="row"><span class="label">Phone</span><span class="value">${data.memberPhone}</span></div>` : ''}
    <div class="line"></div>

    ${itemsHTML}

    ${data.paymentMethod ? `<div class="row"><span class="label">Method</span><span class="value">${data.paymentMethod}</span></div>` : ''}
    ${data.reason ? `<div class="row"><span class="label">For</span><span class="value">${data.reason}</span></div>` : ''}
    ${data.expiryDate ? `<div class="row"><span class="label">Valid Till</span><span class="value bold">${formatDate(data.expiryDate)}</span></div>` : ''}
    ${data.receivedBy ? `<div class="row"><span class="label">Received</span><span class="value">${data.receivedBy}</span></div>` : ''}
    ${data.notes ? `<div class="row"><span class="label">Notes</span><span class="value">${data.notes}</span></div>` : ''}

    <div class="double-line"></div>
    <div class="center footer">Thank you for your payment!</div>
    <div class="center footer">${printedAt}</div>
    <div style="margin-bottom:20px"></div>
  </div>

  <script>setTimeout(function(){ window.print(); }, 200);</script>
</body>
</html>`;

  return html;
}

// ── Build a Test Page ─────────────────────────────────────

export function buildTestPageHTML() {
  const settings = getPrinterSettings();
  const css = thermalCSS(settings.paperWidth);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Printer Test</title>
  <style>${css}</style>
</head>
<body>
  <div class="receipt">
    <div class="double-line"></div>
    <div class="center header">IRON FOST</div>
    <div class="center sub-header">Printer Test Page</div>
    <div class="double-line"></div>
    <div class="row"><span class="label">Status</span><span class="value">OK ✓</span></div>
    <div class="row"><span class="label">Paper</span><span class="value">${settings.paperWidth}</span></div>
    <div class="row"><span class="label">Time</span><span class="value">${new Date().toLocaleString()}</span></div>
    <div class="line"></div>
    <div class="center footer">If you can read this, your printer works!</div>
    <div style="margin-bottom:20px"></div>
  </div>
  <script>setTimeout(function(){ window.print(); }, 200);</script>
</body>
</html>`;
}

// ── Direct Print Helper ───────────────────────────────────

/**
 * Print receipt HTML directly using a hidden iframe.
 * This reuses the existing iframe approach from utils.js but
 * is specifically for thermal receipts.
 */
export function printThermalReceipt(receiptData) {
  const html = buildReceiptHTML(receiptData);
  
  let iframe = document.getElementById('print-iframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'print-iframe';
    iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:none;top:-1000px;left:-1000px;');
    document.body.appendChild(iframe);
  }

  const frameDoc = iframe.contentWindow.document;
  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();
  iframe.contentWindow.focus();
}

/**
 * Print a test page to verify printer works.
 */
export function printTestPage() {
  const html = buildTestPageHTML();

  let iframe = document.getElementById('print-iframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'print-iframe';
    iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:none;top:-1000px;left:-1000px;');
    document.body.appendChild(iframe);
  }

  const frameDoc = iframe.contentWindow.document;
  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();
  iframe.contentWindow.focus();
}
