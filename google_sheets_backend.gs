/**
 * Real Estate Landing Page → Google Sheets CRM Backend
 *
 * What this does:
 * 1. Receives the customer inquiry from index.html.
 * 2. Validates the customer form data.
 * 3. Auto-populates 02_Leads in your Google Sheet CRM.
 * 4. Calculates Lead Score and Temperature.
 * 5. Creates a Next Follow-up Date.
 * 6. Logs the first website inquiry in 04_Activities.
 * 7. Optionally emails you a new lead alert.
 *
 * Required CRM tabs:
 * - 02_Leads
 * - 04_Activities
 */

const SHEET_ID = 'PASTE_GOOGLE_SHEET_ID_HERE'; // Leave as-is if this script is bound to your CRM Google Sheet.
const NOTIFY_EMAIL = 'PASTE_YOUR_EMAIL_HERE'; // Optional. Example: you@business.com
const DEFAULT_ASSIGNED_AGENT = '';
const LEADS_SHEET = '02_Leads';
const ACTIVITIES_SHEET = '04_Activities';

const LEAD_HEADERS = [
  'Lead ID', 'Date Created', 'Lead Source', 'Campaign Name', 'Full Name', 'Phone', 'Email',
  'Facebook / Social Link', 'Client Type', 'Preferred Location', 'Property Type', 'Budget Min',
  'Budget Max', 'Timeline', 'Purpose', 'Stage', 'Lead Score', 'Temperature', 'Assigned Agent',
  'Last Contact Date', 'Next Follow-up Date', 'Follow-up Count', 'Matched Property ID',
  'Matched Property Name', 'Days Since Contact', 'Overdue?', 'Notes'
];

const ACTIVITY_HEADERS = [
  'Activity ID', 'Date', 'Lead ID', 'Lead Name', 'Agent', 'Channel', 'Action', 'Outcome',
  'Next Action', 'Next Follow-up Date', 'Notes'
];

function doGet() {
  return json_({ ok: true, message: 'Real Estate CRM lead endpoint is live.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const data = normalizeIncoming_(readIncoming_(e));

    // Honeypot spam protection. Real customers will never fill this hidden field.
    if (data.companyWebsite) {
      return json_({ ok: true, ignored: true, reason: 'spam-filter' });
    }

    validateLead_(data);

    const ss = getWorkbook_();
    const leadsSheet = ensureSheet_(ss, LEADS_SHEET, LEAD_HEADERS);
    const activitiesSheet = ensureSheet_(ss, ACTIVITIES_SHEET, ACTIVITY_HEADERS);

    setupColumnFormats_(leadsSheet, activitiesSheet);

    const budget = parseBudgetRange_(data.budgetRange, data.budgetMin, data.budgetMax);
    const score = calculateLeadScore_(data, budget);
    const temperature = temperatureFromScore_(score);
    const now = new Date();
    const nextFollowUp = nextFollowUpDate_(data.timeline, score);
    const leadId = nextSequentialId_(leadsSheet, 'L');
    const notes = buildNotes_(data);

    const leadRecord = {
      'Lead ID': leadId,
      'Date Created': now,
      'Lead Source': data.leadSource || 'Website Landing Page',
      'Campaign Name': data.campaignName || data.utm_campaign || 'Website Organic',
      'Full Name': data.fullName,
      'Phone': data.phone,
      'Email': data.email,
      'Facebook / Social Link': data.socialLink || data.referrer || '',
      'Client Type': data.clientType,
      'Preferred Location': data.location,
      'Property Type': data.propertyType,
      'Budget Min': budget.min,
      'Budget Max': budget.max,
      'Timeline': data.timeline,
      'Purpose': data.message || data.purpose || 'Website property inquiry',
      'Stage': 'New',
      'Lead Score': score,
      'Temperature': temperature,
      'Assigned Agent': data.assignedAgent || DEFAULT_ASSIGNED_AGENT,
      'Last Contact Date': '',
      'Next Follow-up Date': nextFollowUp,
      'Follow-up Count': 0,
      'Matched Property ID': data.propertyId || '',
      'Matched Property Name': data.propertyName || '',
      'Notes': notes
    };

    const leadRow = writeRecordToFirstBlankRow_(leadsSheet, leadRecord);
    applyLeadFormulas_(leadsSheet, leadRow);

    const activityId = logFirstActivity_(activitiesSheet, leadId, data, nextFollowUp, notes);
    sendNotification_(leadId, leadRecord, activityId);

    return json_({ ok: true, leadId: leadId, activityId: activityId, score: score, temperature: temperature });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function readIncoming_(e) {
  if (e && e.parameter && Object.keys(e.parameter).length) return e.parameter;

  if (e && e.postData && e.postData.contents) {
    const type = String(e.postData.type || '').toLowerCase();
    if (type.indexOf('application/json') >= 0) {
      return JSON.parse(e.postData.contents);
    }
  }

  return {};
}

function normalizeIncoming_(data) {
  return {
    fullName: clean_(data.fullName),
    phone: clean_(data.phone),
    email: clean_(data.email),
    contactMethod: clean_(data.contactMethod),
    clientType: clean_(data.clientType),
    propertyType: clean_(data.propertyType),
    location: clean_(data.location),
    budgetRange: clean_(data.budgetRange),
    budgetMin: clean_(data.budgetMin),
    budgetMax: clean_(data.budgetMax),
    timeline: clean_(data.timeline),
    message: clean_(data.message),
    purpose: clean_(data.purpose),
    propertyId: clean_(data.propertyId),
    propertyName: clean_(data.propertyName),
    socialLink: clean_(data.socialLink),
    leadSource: clean_(data.leadSource),
    campaignName: clean_(data.campaignName),
    assignedAgent: clean_(data.assignedAgent),
    formName: clean_(data.formName),
    companyWebsite: clean_(data.companyWebsite),
    submittedAt: clean_(data.submittedAt),
    pageUrl: clean_(data.pageUrl),
    referrer: clean_(data.referrer),
    utm_source: clean_(data.utm_source),
    utm_medium: clean_(data.utm_medium),
    utm_campaign: clean_(data.utm_campaign),
    utm_content: clean_(data.utm_content)
  };
}

function validateLead_(data) {
  const missing = [];
  if (!data.fullName) missing.push('Full Name');
  if (!data.phone && !data.email) missing.push('Phone or Email');
  if (!data.clientType) missing.push('Client Type');
  if (!data.propertyType) missing.push('Property Type');
  if (!data.location) missing.push('Preferred Location');
  if (!data.budgetRange && !data.budgetMin && !data.budgetMax) missing.push('Budget Range');
  if (!data.timeline) missing.push('Timeline');

  if (missing.length) {
    throw new Error('Missing required field(s): ' + missing.join(', '));
  }
}

function getWorkbook_() {
  const sheetIdIsSet = SHEET_ID && SHEET_ID !== 'PASTE_GOOGLE_SHEET_ID_HERE';
  if (sheetIdIsSet) return SpreadsheetApp.openById(SHEET_ID);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('No active spreadsheet found. Set SHEET_ID or bind this script to the CRM Google Sheet.');
  return active;
}

function ensureSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  const existingFirstCell = clean_(sheet.getRange(1, 1).getValue());
  if (!existingFirstCell) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  const existingHeaders = getHeaders_(sheet);
  headers.forEach(function(header) {
    if (existingHeaders.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existingHeaders.push(header);
    }
  });

  return sheet;
}

function setupColumnFormats_(leadsSheet, activitiesSheet) {
  const leadMap = getHeaderMap_(leadsSheet);
  setColumnFormat_(leadsSheet, leadMap, 'Date Created', 'yyyy-mm-dd hh:mm');
  setColumnFormat_(leadsSheet, leadMap, 'Budget Min', '₱#,##0');
  setColumnFormat_(leadsSheet, leadMap, 'Budget Max', '₱#,##0');
  setColumnFormat_(leadsSheet, leadMap, 'Lead Score', '0');
  setColumnFormat_(leadsSheet, leadMap, 'Last Contact Date', 'yyyy-mm-dd');
  setColumnFormat_(leadsSheet, leadMap, 'Next Follow-up Date', 'yyyy-mm-dd hh:mm');
  setColumnFormat_(leadsSheet, leadMap, 'Follow-up Count', '0');
  setColumnFormat_(leadsSheet, leadMap, 'Days Since Contact', '0');

  const activityMap = getHeaderMap_(activitiesSheet);
  setColumnFormat_(activitiesSheet, activityMap, 'Date', 'yyyy-mm-dd hh:mm');
  setColumnFormat_(activitiesSheet, activityMap, 'Next Follow-up Date', 'yyyy-mm-dd hh:mm');
}

function setColumnFormat_(sheet, headerMap, header, numberFormat) {
  const col = headerMap[header];
  if (!col) return;
  sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat(numberFormat);
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(header) {
    return clean_(header);
  });
}

function getHeaderMap_(sheet) {
  const headers = getHeaders_(sheet);
  const map = {};
  headers.forEach(function(header, index) {
    if (header) map[header] = index + 1;
  });
  return map;
}

function writeRecordToFirstBlankRow_(sheet, record) {
  const headerMap = getHeaderMap_(sheet);
  const targetRow = firstBlankRowByColumnA_(sheet);

  Object.keys(record).forEach(function(header) {
    const col = headerMap[header];
    if (col) sheet.getRange(targetRow, col).setValue(record[header]);
  });

  return targetRow;
}

function firstBlankRowByColumnA_(sheet) {
  const maxRows = Math.max(sheet.getMaxRows(), 2);
  const values = sheet.getRange(2, 1, maxRows - 1, 1).getValues();

  for (let i = 0; i < values.length; i++) {
    if (!values[i][0]) return i + 2;
  }

  sheet.insertRowAfter(maxRows);
  return maxRows + 1;
}

function nextSequentialId_(sheet, prefix) {
  const values = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  let maxNum = 0;
  const pattern = new RegExp('^' + prefix + '-(\\d+)$');

  values.forEach(function(row) {
    const id = clean_(row[0]);
    const match = id.match(pattern);
    if (match) maxNum = Math.max(maxNum, Number(match[1]) || 0);
  });

  return prefix + '-' + Utilities.formatString('%05d', maxNum + 1);
}

function applyLeadFormulas_(sheet, row) {
  const map = getHeaderMap_(sheet);

  if (map['Days Since Contact']) {
    const lastContactCol = columnToLetter_(map['Last Contact Date']);
    const createdCol = columnToLetter_(map['Date Created']);
    sheet.getRange(row, map['Days Since Contact']).setFormula('=IF(' + lastContactCol + row + '="",TODAY()-INT(' + createdCol + row + '),TODAY()-INT(' + lastContactCol + row + '))');
  }

  if (map['Overdue?']) {
    const nextCol = columnToLetter_(map['Next Follow-up Date']);
    sheet.getRange(row, map['Overdue?']).setFormula('=IF(' + nextCol + row + '="","",IF(INT(' + nextCol + row + ')<TODAY(),"OVERDUE",IF(INT(' + nextCol + row + ')=TODAY(),"DUE TODAY","OK")))');
  }
}

function parseBudgetRange_(range, budgetMin, budgetMax) {
  if (budgetMin || budgetMax) {
    return {
      min: numberOnly_(budgetMin),
      max: numberOnly_(budgetMax)
    };
  }

  const pieces = String(range || '').split('-');
  return {
    min: numberOnly_(pieces[0]),
    max: numberOnly_(pieces[1] || pieces[0])
  };
}

function numberOnly_(value) {
  const n = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : '';
}

function calculateLeadScore_(data, budget) {
  let score = 0;

  if (data.fullName) score += 10;
  if (data.phone) score += 20;
  if (data.email) score += 5;
  if (data.contactMethod) score += 5;
  if (data.clientType) score += 10;
  if (data.location) score += 10;
  if (data.propertyType) score += 10;
  if (budget.min || budget.max) score += 15;
  if (data.propertyId || data.propertyName) score += 10;

  const timeline = String(data.timeline || '').toLowerCase();
  if (timeline.indexOf('asap') >= 0 || timeline.indexOf('0-30') >= 0) score += 25;
  else if (timeline.indexOf('30') >= 0) score += 20;
  else if (timeline.indexOf('1-3') >= 0 || timeline.indexOf('1–3') >= 0) score += 12;
  else if (timeline.indexOf('3-6') >= 0 || timeline.indexOf('3–6') >= 0) score += 6;
  else if (timeline.indexOf('research') >= 0) score -= 8;

  return Math.max(0, Math.min(100, score));
}

function temperatureFromScore_(score) {
  if (score >= 80) return 'Hot';
  if (score >= 50) return 'Warm';
  if (score >= 20) return 'Cold';
  return 'Low Priority';
}

function nextFollowUpDate_(timeline, score) {
  const d = new Date();
  const text = String(timeline || '').toLowerCase();

  if (score >= 80 || text.indexOf('asap') >= 0 || text.indexOf('0-30') >= 0) {
    d.setHours(d.getHours() + 2);
  } else if (score >= 50 || text.indexOf('30') >= 0) {
    d.setDate(d.getDate() + 1);
  } else if (score >= 20) {
    d.setDate(d.getDate() + 3);
  } else {
    d.setDate(d.getDate() + 7);
  }

  return d;
}

function buildNotes_(data) {
  const parts = [];
  if (data.formName) parts.push('Form: ' + data.formName);
  if (data.contactMethod) parts.push('Preferred contact: ' + data.contactMethod);
  if (data.propertyName) parts.push('Selected property: ' + data.propertyName + (data.propertyId ? ' (' + data.propertyId + ')' : ''));
  if (data.message) parts.push('Message: ' + data.message);
  if (data.submittedAt) parts.push('Submitted at browser time: ' + data.submittedAt);
  if (data.pageUrl) parts.push('Page: ' + data.pageUrl);
  if (data.referrer) parts.push('Referrer: ' + data.referrer);
  if (data.utm_source || data.utm_medium || data.utm_campaign || data.utm_content) {
    parts.push('UTM: ' + [data.utm_source, data.utm_medium, data.utm_campaign, data.utm_content].filter(Boolean).join(' / '));
  }
  return parts.join('\n');
}

function logFirstActivity_(sheet, leadId, data, nextFollowUp, notes) {
  const activityId = nextSequentialId_(sheet, 'A');
  const record = {
    'Activity ID': activityId,
    'Date': new Date(),
    'Lead ID': leadId,
    'Lead Name': data.fullName,
    'Agent': data.assignedAgent || DEFAULT_ASSIGNED_AGENT,
    'Channel': data.contactMethod || 'Website',
    'Action': 'Website Inquiry',
    'Outcome': 'New lead captured from landing page',
    'Next Action': 'Contact lead and qualify requirement',
    'Next Follow-up Date': nextFollowUp,
    'Notes': notes
  };

  writeRecordToFirstBlankRow_(sheet, record);
  return activityId;
}

function sendNotification_(leadId, leadRecord, activityId) {
  const emailIsSet = NOTIFY_EMAIL && NOTIFY_EMAIL !== 'PASTE_YOUR_EMAIL_HERE';
  if (!emailIsSet) return;

  const subject = 'New Real Estate Lead: ' + leadRecord['Full Name'] + ' / ' + leadRecord['Temperature'];
  const body = [
    'New lead captured from landing page.',
    '',
    'Lead ID: ' + leadId,
    'Activity ID: ' + activityId,
    'Name: ' + leadRecord['Full Name'],
    'Phone: ' + leadRecord['Phone'],
    'Email: ' + leadRecord['Email'],
    'Client Type: ' + leadRecord['Client Type'],
    'Property Type: ' + leadRecord['Property Type'],
    'Location: ' + leadRecord['Preferred Location'],
    'Budget: ' + leadRecord['Budget Min'] + ' - ' + leadRecord['Budget Max'],
    'Timeline: ' + leadRecord['Timeline'],
    'Lead Score: ' + leadRecord['Lead Score'],
    'Temperature: ' + leadRecord['Temperature'],
    'Next Follow-up: ' + leadRecord['Next Follow-up Date'],
    '',
    'Notes:',
    leadRecord['Notes']
  ].join('\n');

  MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}

function columnToLetter_(column) {
  let temp = '';
  let letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this once from Apps Script editor to check that the CRM connection works.
 * It should create one test lead inside 02_Leads and one activity inside 04_Activities.
 */
function testLeadSubmit() {
  const fakeEvent = {
    parameter: {
      fullName: 'Test Buyer From Landing Page',
      phone: '09171234567',
      email: 'test@example.com',
      contactMethod: 'WhatsApp',
      clientType: 'Buyer',
      propertyType: 'Condo',
      location: 'BGC / Makati',
      budgetRange: '3000000-8000000',
      timeline: 'ASAP / 0-30 days',
      message: 'Testing auto-populate from landing page to Google Sheet CRM.',
      propertyId: 'P-00001',
      propertyName: 'BGC 1BR Near High Street',
      leadSource: 'Website Landing Page',
      campaignName: 'Test Campaign',
      pageUrl: 'https://example.com'
    }
  };

  Logger.log(doPost(fakeEvent).getContent());
}
