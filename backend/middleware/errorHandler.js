/**
 * Global error handler.
 *
 * Every error leaves here as one plain sentence saying what went wrong, so the
 * person at the front desk can fix it themselves: which field is wrong, which
 * ID is already taken, or that the database could not be reached. A bare
 * "Internal server error" is only used when the cause really is unknown, and
 * even then the server log carries the details.
 */

// Field names as people see them on the forms
const LABELS = {
  name: 'Name',
  phone: 'Phone number',
  cnic: 'CNIC',
  gender: 'Gender',
  join_date: 'Join date',
  emergency_contact: 'Emergency contact',
  fingerprint_id: 'Fingerprint ID',
  membership_id: 'Membership ID',
  status: 'Status',
  notes: 'Notes',
  member_id: 'Member',
  amount: 'Amount',
  payment_date: 'Payment date',
  plan_duration_months: 'Plan',
  custom_days: 'Custom days',
  payment_method: 'Payment method',
  payment_type: 'Payment type',
  received_by: 'Received by',
  expense_date: 'Expense date',
  category: 'Category',
  description: 'Description',
  email: 'Email',
  password: 'Password',
  role: 'Role',
  salary: 'Salary',
  monthly_salary: 'Monthly salary',
  staff_id: 'Staff member',
};
const label = (path) => {
  const key = Array.isArray(path) ? path.filter((p) => typeof p === 'string').pop() : path;
  if (!key) return 'A field';
  return LABELS[key] || String(key).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
};

/** One readable line per Zod issue: "Phone number must be at least 10 characters". */
function zodIssueText(issue) {
  const field = label(issue.path);
  // zod 3 calls the value's kind `type`, zod 4 calls it `origin`
  issue = { ...issue, type: issue.type || issue.origin, received: issue.received ?? (issue.input === undefined ? 'undefined' : undefined) };
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null'
        ? `${field} is required`
        : `${field} must be ${issue.expected === 'number' ? 'a number' : `a ${issue.expected}`}`;
    case 'too_small':
      if (issue.type === 'string') return issue.minimum <= 1 ? `${field} is required` : `${field} must be at least ${issue.minimum} characters`;
      if (issue.type === 'number') return `${field} must be ${issue.inclusive ? 'at least' : 'more than'} ${issue.minimum}`;
      return `${field} is too short`;
    case 'too_big':
      if (issue.type === 'string') return `${field} must be at most ${issue.maximum} characters`;
      if (issue.type === 'number') return `${field} must be at most ${issue.maximum}`;
      return `${field} is too long`;
    case 'invalid_enum_value':
    case 'invalid_value':
      return `${field} must be one of: ${(issue.options || []).join(', ')}`;
    case 'invalid_string':
      return issue.validation === 'uuid' ? `${field} is not valid (please select it again)` : `${field} is not valid`;
    case 'invalid_union':
      return `${field} is not valid`;
    default:
      return `${field}: ${issue.message}`;
  }
}

// "Key (gym_id, fingerprint_id)=(…, 267) already exists." -> { column: 'fingerprint_id', value: '267' }
function parseKey(details = '') {
  const m = String(details).match(/Key \(([^)]+)\)=\(([^)]*)\)/);
  if (!m) return {};
  const cols = m[1].split(',').map((s) => s.trim());
  const vals = m[2].split(',').map((s) => s.trim());
  const i = cols.findIndex((c) => c !== 'gym_id');
  return i >= 0 ? { column: cols[i], value: vals[i] } : {};
}

/** Postgres / Supabase errors -> [status, message] */
function databaseError(err) {
  const text = `${err.message || ''} ${err.details || ''}`;
  switch (err.code) {
    case '23505': { // unique_violation
      const { column, value } = parseKey(err.details);
      const col = column || (/fingerprint/i.test(text) ? 'fingerprint_id' : /membership/i.test(text) ? 'membership_id' : /phone/i.test(text) ? 'phone' : null);
      if (col) return [409, `${label(col)}${value ? ` ${value}` : ''} is already used by another record. Please use a different one.`];
      return [409, 'This record already exists (duplicate). Please check and try again.'];
    }
    case '23503': // foreign_key_violation
      return /delete|update/i.test(err.message || '') && /still referenced/i.test(text)
        ? [409, 'This record is still linked to other records (payments, attendance or messages), so it cannot be removed yet.']
        : [400, 'This refers to a member or record that no longer exists. Please refresh the page and try again.'];
    case '23502': { // not_null_violation
      const col = (String(err.message).match(/column "([^"]+)"/) || [])[1];
      return [400, `${label(col)} is required.`];
    }
    case '22P02': // invalid_text_representation (bad uuid / number)
      return [400, 'One of the values is in the wrong format (for example a letter where a number is expected). Please check the form.'];
    case '22001': // string too long
      return [400, 'One of the values is too long. Please shorten it.'];
    case '22007':
    case '22008':
      return [400, 'One of the dates is not valid. Please pick it again.'];
    case 'PGRST116':
      return [404, 'Record not found. It may have been deleted — please refresh the page.'];
    case '42703':
    case '42P01':
      return [500, 'The database is missing a field this screen needs. Please tell the developer.'];
    default:
      if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(text)) {
        return [503, 'Could not reach the database. Please check the internet and try again in a minute.'];
      }
      if (String(err.code || '').startsWith('PGRST')) return [400, err.message];
      return null;
  }
}

const errorHandler = (err, req, res, next) => {
  console.error('[ERROR]', req.method, req.originalUrl, '|', err.code || err.name || '', err.message, err.details || '', err.stack?.split('\n')[1] || '');
  if (res.headersSent) return next(err);

  // Form validation
  if (err.name === 'ZodError') {
    const issues = err.errors || err.issues || [];
    const errors = issues.map((e) => ({ field: e.path.join('.'), message: zodIssueText(e) }));
    return res.status(400).json({
      success: false,
      message: errors.length ? errors.map((e) => e.message).join('. ') : 'Some fields are not valid',
      errors,
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Your login has expired. Please log in again.' });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Please log in again.' });
  }

  // Request body problems (from express.json / express.text)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'The data sent was not readable. Please refresh the page and try again.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'The data sent is too large.' });
  }
  if (err.type === 'request.aborted') {
    return res.status(400).json({ success: false, message: 'The request was interrupted. Please try again.' });
  }

  const db = err.code || err.details ? databaseError(err) : null;
  if (db) return res.status(db[0]).json({ success: false, message: db[1], code: err.code });

  const status = err.status || err.statusCode || 500;
  const message = status < 500 && err.message
    ? err.message
    : 'Something went wrong on the server. Please try again; if it keeps happening, tell the developer the time it happened.';
  res.status(status).json({ success: false, message });
};

/**
 * Async wrapper — catches thrown errors and passes to error handler
 */
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler };
