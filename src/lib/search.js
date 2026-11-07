/**
 * One member search used by every page, so a name that is found on one screen
 * is found on all of them.
 *
 * - Every word typed must match ("ali raza" finds "Raza Ali Khan").
 * - Extra spaces, dots and capital letters are ignored ("m. hanan" = "M.Hanan").
 * - Roman-Urdu spellings that differ only in vowels match each other
 *   ("shahbaz" finds "Shehbaz", "muhammad" finds "Mohammad").
 * - Phone numbers match in any format: 0333-1234567, 03331234567,
 *   +92 333 1234567 and 923331234567 are the same number.
 * - Fingerprint ID and membership ID (e.g. 267 or IF0827) match too.
 */

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[._\-,/\\()'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Letters only, vowels removed and repeats collapsed: "shehbaz" -> "shbz"
const skeleton = (word) =>
  word
    .replace(/[^a-z]/g, '')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/h/g, '');

// Pakistani numbers: 0333..., 92333..., 333... all compare as "333..."
const phoneDigits = (value) => {
  let d = String(value ?? '').replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(4);
  else if (d.startsWith('92') && d.length >= 12) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d;
};

const tokenMatches = (token, fields) => {
  const { nameWords, nameText, nameSkeletons, phone, ids } = fields;
  if (nameText.includes(token)) return true;
  if (ids.some((id) => id === token || (token.length >= 2 && id.includes(token)))) return true;

  const digits = token.replace(/\D/g, '');
  if (digits.length >= 4 && digits.length === token.replace(/[\s+]/g, '').length) {
    if (phone.includes(phoneDigits(digits))) return true;
  }

  // Spelling variants only for longer words, so short ones don't over-match
  if (token.length >= 4 && /[a-z]/.test(token)) {
    const sk = skeleton(token);
    if (sk.length >= 3 && nameSkeletons.some((w) => w.startsWith(sk))) return true;
  }
  return nameWords.some((w) => w.startsWith(token));
};

const fieldsOf = (member) => {
  const nameText = normalize(member?.name);
  const nameWords = nameText.split(' ').filter(Boolean);
  return {
    nameText,
    nameWords,
    nameSkeletons: nameWords.map(skeleton).filter(Boolean),
    phone: phoneDigits(member?.phone),
    ids: [member?.fingerprint_id, member?.membership_id, member?.cnic]
      .map((v) => normalize(v).replace(/\s/g, ''))
      .filter(Boolean),
  };
};

/** True when the member matches what was typed. Empty search matches everyone. */
export const matchesMember = (member, query) => {
  const q = normalize(query);
  if (!q) return true;
  // A whole phone number typed with spaces ("0333 412 1703") is one token
  const compact = q.replace(/\s/g, '');
  const fields = fieldsOf(member);
  if (/^\+?\d{6,}$/.test(compact) && fields.phone.includes(phoneDigits(compact))) return true;
  return q.split(' ').every((token) => tokenMatches(token, fields));
};

/**
 * Filters and ranks: exact name/ID matches first, then spelling-variant
 * matches, so the most likely person is at the top.
 */
export const searchMembers = (members, query) => {
  const q = normalize(query);
  if (!q) return members || [];
  const score = (m) => {
    const f = fieldsOf(m);
    const compact = q.replace(/\s/g, '');
    if (f.ids.includes(compact)) return 0;
    if (f.nameText.startsWith(q)) return 1;
    if (f.nameText.includes(q)) return 2;
    return 3;
  };
  return (members || [])
    .filter((m) => matchesMember(m, query))
    .map((m, i) => ({ m, s: score(m), i }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.m);
};

/** Free-text match for rows that are not members (payments list etc.). */
export const matchesText = (haystack, query) => {
  const q = normalize(query);
  if (!q) return true;
  const text = normalize(haystack);
  const words = text.split(' ');
  const sks = words.map(skeleton).filter(Boolean);
  const digits = String(haystack ?? '').replace(/\D/g, '');
  return q.split(' ').every((t) =>
    text.includes(t)
    || (/^\d{4,}$/.test(t) && phoneDigits(digits).includes(phoneDigits(t)))
    || (t.length >= 4 && /[a-z]/.test(t) && skeleton(t).length >= 3 && sks.some((w) => w.startsWith(skeleton(t)))));
};
