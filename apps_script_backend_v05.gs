/**
 * Real Estate Lead Organizer V0.5 - Google Sheets Backend
 * New in V0.5:
 * - Users sheet with admin / user roles
 * - login action (returns session token stored client-side)
 * - createUser / deleteUser / changePassword (admin only)
 * - listUsers (admin only)
 * - All existing V0.4 lead/label/sync actions preserved
 *
 * SETUP INSTRUCTIONS
 * ─────────────────────────────────────────────────────────────
 * 1. Create a new Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Paste this entire file into Code.gs and save.
 * 4. Change API_TOKEN below (keep it secret).
 * 5. Run setup() once → click Authorize and accept permissions.
 * 6. Run seedAdminUser() once to create the first admin account.
 *    Default: username = admin  |  password = Admin@1234
 *    → CHANGE the password immediately after first login.
 * 7. Deploy > New deployment > Web app.
 *       Execute as : Me
 *       Who has access : Anyone
 * 8. Copy the Web App URL and the API_TOKEN into the website settings.
 */

// ─── CHANGE THESE ────────────────────────────────────────────
const API_TOKEN   = 'CHANGE_THIS_TO_A_LONG_RANDOM_TOKEN_12345';
// ─────────────────────────────────────────────────────────────

const SHEET_LEADS  = 'Leads';
const SHEET_LABELS = 'Labels';
const SHEET_META   = 'Meta';
const SHEET_USERS  = 'Users';

const LEAD_HEADERS = [
  'id','createdAt','updatedAt','name','phone','channel','handle',
  'intent','status','score','payment','location','ptype','budget',
  'timeline','apptDate','apptTime','remBefore','follow','labels',
  'transcript','notes','nextAction'
];

const USER_HEADERS = ['username','passwordHash','role','createdAt','lastLogin'];

// ─── PUBLIC ENTRY POINTS ─────────────────────────────────────

function doGet(e)  { return respond_(e); }
function doPost(e) { return respond_(e); }

// ─── SETUP ───────────────────────────────────────────────────

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  _createLeadsSheet(ss);
  _createLabelsSheet(ss);
  _createMetaSheet(ss);
  _createUsersSheet(ss);
  return { ok: true, message: 'V0.5 setup complete. Run seedAdminUser() next.' };
}

function seedAdminUser() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) throw new Error('Run setup() first.');
  const existing = getIdColumn_(sheet, 0);
  if (existing.includes('admin')) return { ok: true, message: 'admin already exists.' };
  sheet.appendRow(['admin', hashPassword_('Admin@1234'), 'admin', new Date().toISOString(), '']);
  return { ok: true, message: 'Admin user created. Username: admin | Password: Admin@1234 — CHANGE IT NOW.' };
}

// ─── ROUTER ──────────────────────────────────────────────────

function respond_(e) {
  let payload = {};
  const params   = (e && e.parameter) || {};
  const callback = params.callback;
  try {
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents || '{}');
    }
    if (params.payload) payload = JSON.parse(params.payload);
    payload.action = params.action  || payload.action || 'list';
    payload.token  = params.token   || payload.token  || '';
    return output_(route_(payload), callback);
  } catch (err) {
    return output_({ ok: false, error: String(err && err.message ? err.message : err) }, callback);
  }
}

function route_(payload) {
  const action = payload.action;

  // Public action — no token required
  if (action === 'ping') {
    return { ok: true, message: 'V0.5 backend reachable', time: new Date().toISOString() };
  }

  // Login — token required (protects the endpoint), credentials in payload
  if (action === 'login') {
    requireToken_(payload.token);
    return login_(payload.username || '', payload.password || '');
  }

  // All other actions require token + valid session
  requireToken_(payload.token);
  ensureSetup_();
  requireSession_(payload.sessionToken, payload.action);

  const role = getRoleFromSession_(payload.sessionToken);

  // Admin-only actions
  if (action === 'createUser')    return adminOnly_(role, () => createUser_(payload));
  if (action === 'deleteUser')    return adminOnly_(role, () => deleteUser_(payload.username || ''));
  if (action === 'changePassword') return changePassword_(payload, role);
  if (action === 'listUsers')     return adminOnly_(role, listUsers_);

  // Lead & label actions (admin + user)
  if (action === 'list')       return list_();
  if (action === 'saveLead')   return saveLead_(payload.lead || {});
  if (action === 'deleteLead') return deleteLead_(payload.id   || '');
  if (action === 'saveLabels') return saveLabels_(payload.labels || []);
  if (action === 'bulkSync')   return bulkSync_(payload.labels || [], payload.leads || []);

  throw new Error('Unknown action: ' + action);
}

// ─── AUTH HELPERS ────────────────────────────────────────────

function requireToken_(token) {
  if (!API_TOKEN || API_TOKEN === 'CHANGE_THIS_TO_A_LONG_RANDOM_TOKEN_12345') {
    throw new Error('Set API_TOKEN in Code.gs before deploying.');
  }
  if (String(token) !== String(API_TOKEN)) {
    throw new Error('Invalid API token.');
  }
}

function requireSession_(sessionToken, action) {
  if (!sessionToken) throw new Error('No session token. Please log in.');
  const row = findUserBySession_(sessionToken);
  if (!row) throw new Error('Session expired or invalid. Please log in again.');
}

function adminOnly_(role, fn) {
  if (role !== 'admin') throw new Error('Admin access required.');
  return fn();
}

function getRoleFromSession_(sessionToken) {
  const row = findUserBySession_(sessionToken);
  return row ? row[2] : null; // role is index 2
}

// ─── LOGIN / SESSION ─────────────────────────────────────────
// Session tokens are stored in the Users sheet (column 6, index 5)
// and expire after SESSION_HOURS hours.

const SESSION_HOURS = 8;
const SESSION_COL   = 6; // 1-indexed column for sessionToken
const SESSION_EXP   = 7; // 1-indexed column for sessionExpiry

function login_(username, password) {
  if (!username || !password) throw new Error('Username and password required.');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (!sheet) throw new Error('Users sheet not found. Run setup().');
  const users = getSheetData_(sheet);
  const row   = users.find(r => String(r[0]).toLowerCase() === username.toLowerCase());
  if (!row) throw new Error('Invalid username or password.');
  if (!verifyPassword_(password, String(row[1]))) throw new Error('Invalid username or password.');

  const token   = Utilities.getUuid();
  const expiry  = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  const rowIdx  = users.indexOf(row) + 2; // +2: 1-indexed + header row
  const numCols = sheet.getLastColumn();
  // Extend sheet if needed
  if (numCols < SESSION_EXP) sheet.getRange(1, SESSION_COL, 1, 2).setValues([['sessionToken','sessionExpiry']]);
  sheet.getRange(rowIdx, SESSION_COL, 1, 2).setValues([[token, expiry]]);
  // Update lastLogin
  sheet.getRange(rowIdx, 5).setValue(new Date().toISOString()); // lastLogin col 5

  return {
    ok: true,
    sessionToken: token,
    username: String(row[0]),
    role: String(row[2]),
    expiresAt: expiry
  };
}

function findUserBySession_(sessionToken) {
  if (!sessionToken) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const last = sheet.getLastRow();
  const ncol = Math.max(sheet.getLastColumn(), SESSION_EXP);
  const data = sheet.getRange(2, 1, last - 1, ncol).getValues();
  const now  = new Date();
  return data.find(r => {
    const tok = String(r[SESSION_COL - 1] || '');
    const exp = r[SESSION_EXP - 1] ? new Date(r[SESSION_EXP - 1]) : null;
    return tok === sessionToken && exp && exp > now;
  }) || null;
}

// ─── USER MANAGEMENT ─────────────────────────────────────────

function listUsers_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, users: [] };
  const data = getSheetData_(sheet);
  return {
    ok: true,
    users: data.map(r => ({
      username:  String(r[0]),
      role:      String(r[2]),
      createdAt: String(r[3]),
      lastLogin: String(r[4] || '')
    }))
  };
}

function createUser_(payload) {
  const username = String(payload.username || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const role     = ['admin', 'user'].includes(payload.role) ? payload.role : 'user';
  if (!username || !password) throw new Error('Username and password required.');
  if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new Error('Username must be 3-32 chars: letters, numbers, underscore.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const existing = getIdColumn_(sheet, 0).map(x => x.toLowerCase());
  if (existing.includes(username)) throw new Error('Username already exists.');
  sheet.appendRow([username, hashPassword_(password), role, new Date().toISOString(), '', '', '']);
  return { ok: true, created: username, role };
}

function deleteUser_(username) {
  if (!username) throw new Error('Username required.');
  if (username === 'admin') throw new Error('Cannot delete the primary admin account.');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const ids   = getIdColumn_(sheet, 0).map(x => x.toLowerCase());
  const idx   = ids.indexOf(username.toLowerCase());
  if (idx < 0) throw new Error('User not found.');
  sheet.deleteRow(idx + 2);
  return { ok: true, deleted: username };
}

function changePassword_(payload, role) {
  const username    = String(payload.username || '').trim().toLowerCase();
  const newPassword = String(payload.newPassword || '');
  const oldPassword = String(payload.oldPassword || '');
  if (!username || !newPassword) throw new Error('Username and newPassword required.');
  if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
  const sheet  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const data   = getSheetData_(sheet);
  const rowIdx = data.findIndex(r => String(r[0]).toLowerCase() === username);
  if (rowIdx < 0) throw new Error('User not found.');
  // Non-admins must supply old password; admins can reset anyone's password
  if (role !== 'admin') {
    if (!verifyPassword_(oldPassword, String(data[rowIdx][1]))) {
      throw new Error('Current password is incorrect.');
    }
  }
  sheet.getRange(rowIdx + 2, 2).setValue(hashPassword_(newPassword));
  return { ok: true, message: 'Password updated.' };
}

// ─── PASSWORD HASHING (SHA-256 + salt) ───────────────────────

function hashPassword_(plain) {
  const salt   = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + plain,
    Utilities.Charset.UTF_8
  );
  const hex = digest.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  return salt + ':' + hex;
}

function verifyPassword_(plain, stored) {
  const parts  = stored.split(':');
  if (parts.length !== 2) return false;
  const salt   = parts[0];
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + plain,
    Utilities.Charset.UTF_8
  );
  const hex = digest.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  return hex === parts[1];
}

// ─── LEAD ACTIONS ────────────────────────────────────────────

function list_() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const leadsSheet  = ss.getSheetByName(SHEET_LEADS);
  const labelsSheet = ss.getSheetByName(SHEET_LABELS);
  const leads  = readObjects_(leadsSheet, LEAD_HEADERS).map(rowToLead_);
  const labels = labelsSheet.getLastRow() > 1
    ? labelsSheet.getRange(2, 1, labelsSheet.getLastRow() - 1, 1).getValues().flat().filter(String)
    : [];
  return { ok: true, leads, labels, count: leads.length, time: new Date().toISOString() };
}

function saveLead_(lead) {
  if (!lead.id) lead.id = Utilities.getUuid();
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_LEADS);
    const now   = new Date().toISOString();
    lead.updatedAt = now;
    if (!lead.createdAt) lead.createdAt = now;
    const ids      = getIdColumn_(sheet, 0);
    const rowIndex = ids.indexOf(lead.id);
    const values   = [leadToRow_(lead)];
    if (rowIndex >= 0) {
      sheet.getRange(rowIndex + 2, 1, 1, LEAD_HEADERS.length).setValues(values);
      return { ok: true, action: 'updated', id: lead.id };
    } else {
      sheet.appendRow(values[0]);
      return { ok: true, action: 'created', id: lead.id };
    }
  } finally { lock.releaseLock(); }
}

function deleteLead_(id) {
  if (!id) throw new Error('Missing id');
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const sheet    = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LEADS);
    const ids      = getIdColumn_(sheet, 0);
    const rowIndex = ids.indexOf(id);
    if (rowIndex >= 0) { sheet.deleteRow(rowIndex + 2); return { ok: true, deleted: id }; }
    return { ok: true, deleted: null, message: 'Lead not found' };
  } finally { lock.releaseLock(); }
}

function saveLabels_(labels) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LABELS);
  sheet.clear();
  sheet.getRange(1, 1).setValue('label');
  const clean = unique_(labels.map(String).map(s => s.trim()).filter(Boolean));
  if (clean.length) sheet.getRange(2, 1, clean.length, 1).setValues(clean.map(x => [x]));
  sheet.autoResizeColumn(1);
  return { ok: true, labels: clean, count: clean.length };
}

function bulkSync_(labels, leads) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_LEADS);
    sheet.clear();
    sheet.getRange(1, 1, 1, LEAD_HEADERS.length).setValues([LEAD_HEADERS]);
    const rows = leads.map(leadToRow_);
    if (rows.length) sheet.getRange(2, 1, rows.length, LEAD_HEADERS.length).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, LEAD_HEADERS.length);
    saveLabels_(labels);
    return { ok: true, count: rows.length };
  } finally { lock.releaseLock(); }
}

// ─── SHEET SETUP HELPERS ─────────────────────────────────────

function ensureSetup_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_LEADS) || !ss.getSheetByName(SHEET_LABELS) || !ss.getSheetByName(SHEET_USERS)) {
    setup();
  }
}

function _createLeadsSheet(ss) {
  const sheet = getOrCreateSheet_(ss, SHEET_LEADS);
  sheet.clear();
  sheet.getRange(1, 1, 1, LEAD_HEADERS.length).setValues([LEAD_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, LEAD_HEADERS.length);
}

function _createLabelsSheet(ss) {
  const sheet = getOrCreateSheet_(ss, SHEET_LABELS);
  const defaultLabels = ['Cash Buyer','Financing','Investor','Need Viewing','Seller Lead','Rental','Urgent','Negotiation','WhatsApp Lead','Messenger Lead','Viber Lead'];
  sheet.clear();
  sheet.getRange(1, 1).setValue('label');
  sheet.getRange(2, 1, defaultLabels.length, 1).setValues(defaultLabels.map(x => [x]));
  sheet.setFrozenRows(1);
  sheet.autoResizeColumn(1);
}

function _createUsersSheet(ss) {
  const sheet = getOrCreateSheet_(ss, SHEET_USERS);
  sheet.clear();
  sheet.getRange(1, 1, 1, USER_HEADERS.length + 2).setValues([
    [...USER_HEADERS, 'sessionToken', 'sessionExpiry']
  ]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, USER_HEADERS.length + 2);
}

function _createMetaSheet(ss) {
  const sheet = getOrCreateSheet_(ss, SHEET_META);
  sheet.clear();
  sheet.getRange(1, 1, 7, 2).setValues([
    ['app', 'Real Estate Lead Organizer'],
    ['version', '0.5'],
    ['createdAt', new Date()],
    ['webAppAccess', 'Deploy as Web App: Execute as Me, Anyone'],
    ['tokenInstruction', 'Copy API_TOKEN from Code.gs into website Sheet Sync settings.'],
    ['authModel', 'Login → session token (8h) stored client-side. SHA-256+salt passwords.'],
    ['warning', 'Do not publish API tokens or passwords in GitHub.']
  ]);
  sheet.autoResizeColumns(1, 2);
}

// ─── DATA UTILITIES ──────────────────────────────────────────

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getSheetData_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const ncol = Math.max(sheet.getLastColumn(), USER_HEADERS.length);
  return sheet.getRange(2, 1, last - 1, ncol).getValues();
}

function readObjects_(sheet, headers) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  return values.filter(row => row.some(v => v !== '')).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function getIdColumn_(sheet, colIndex) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, colIndex + 1, last - 1, 1).getValues().flat().map(String);
}

function leadToRow_(lead) {
  return LEAD_HEADERS.map(h => {
    let value = lead[h];
    if (h === 'labels') value = JSON.stringify(Array.isArray(value) ? value : parseLabels_(value));
    if (value === undefined || value === null) return '';
    return value;
  });
}

function rowToLead_(obj) {
  obj.labels = parseLabels_(obj.labels);
  obj.score  = Number(obj.score || 0);
  return obj;
}

function parseLabels_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try { const p = JSON.parse(value); if (Array.isArray(p)) return p; } catch (e) {}
  return String(value).split('|').map(s => s.trim()).filter(Boolean);
}

function unique_(arr) { return [...new Set(arr)]; }

function output_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(String(callback) + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
