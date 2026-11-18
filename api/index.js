const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const db = require('./db');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const CONFIG = {
  notifyEmail: process.env.NOTIFY_EMAIL || 'info@radhikaagencies.com,radhikaagencies@ymail.com',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || 'admin',
  adminSecret: process.env.ADMIN_SECRET || 'dev-secret-change-me',
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
};

const VALID_TYPES = ['enquiry', 'order', 'contact'];

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ user, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', CONFIG.adminSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', CONFIG.adminSecret).update(payload).digest('base64url');
  if (sig !== expected) return false;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return data.user; }
  catch { return false; }
}
function auth(req, res, next) {
  const token = req.headers['authorization'] || req.query.token || '';
  const clean = token.replace(/^Bearer\s+/i, '');
  if (verifyToken(clean) !== CONFIG.adminUser) return res.status(401).json({ ok: false, message: 'Unauthorized' });
  next();
}

const DEFAULT_COURIER_ACCOUNTS = [
  { user: 'courier1', pass: 'roZBhIeStc' },
  { user: 'courier2', pass: 'Xvc0wT5pq18' },
  { user: 'courier3', pass: 'VYGh4wew' },
  { user: 'courier4', pass: 'nYTKJ5Vdej4' },
  { user: 'courier5', pass: 'hZKZCyG0vc8' }
];
function parseCourierAccounts() {
  const raw = process.env.COURIER_ACCOUNTS;
  if (raw && raw.trim()) {
    const parsed = raw.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
      const idx = pair.indexOf(':');
      return { user: pair.slice(0, idx).trim(), pass: pair.slice(idx + 1).trim() };
    }).filter(a => a.user && a.pass);
    if (parsed.length) return parsed;
  }
  return DEFAULT_COURIER_ACCOUNTS;
}
CONFIG.courierAccounts = parseCourierAccounts();

function isCourier(user) {
  return Array.isArray(CONFIG.courierAccounts) && CONFIG.courierAccounts.some(a => a.user === user);
}
function authCourier(req, res, next) {
  const token = req.headers['authorization'] || req.query.token || '';
  const clean = token.replace(/^Bearer\s+/i, '');
  const user = verifyToken(clean);
  if (!user || !isCourier(user)) return res.status(401).json({ ok: false, message: 'Unauthorized' });
  next();
}

const DOCKET_FIELD_ALIASES = {
  mobile: ['mobile', 'mobile number', 'phone', 'contact', 'contact number', 'whatsapp', 'mob'],
  docket_no: ['docket no', 'docket', 'docket no.', 'invoice', 'invoice no', 'invoice no.', 'lr', 'lr no', 'lr no.', 'consignment', 'challan', 'challan no'],
  courier: ['courier', 'courier name', 'courier service', 'transporter', 'transport', 'carrier'],
  tracking: ['tracking', 'tracking no', 'tracking number', 'tracking id', 'awb', 'awb no', 'awb number'],
  status: ['status', 'dispatch status', 'current status', 'delivery status'],
  dispatch_date: ['date', 'dispatch date', 'dispatched on', 'ship date', 'dispatch dt'],
  organization: ['organization', 'org', 'storecode', 'store code', 'kendra', 'kendra name', 'customer', 'customer name', 'party', 'party name'],
  items: ['items', 'item details', 'description', 'contents', 'product', 'products', 'details', 'remarks'],
  boxes: ['boxes', 'no of box', 'no of boxes', 'no. of box', 'no. of boxes', 'box count', 'boxes count', 'packets', 'packet count', 'cartons'],
  store_owner: ['store owner', 'store owner name', 'owner', 'owner name', 'kendra owner', 'shop owner', 'proprietor', 'receiver', 'receiver name']
};

function fmtDate(v) {
  if (v instanceof Date) {
    const d = v.getDate().toString().padStart(2, '0');
    const m = (v.getMonth() + 1).toString().padStart(2, '0');
    const y = v.getFullYear();
    return d + '/' + m + '/' + y;
  }
  return String(v == null ? '' : v).trim();
}

function mapDocketRow(headers, row) {
  const norm = headers.map(h => String(h == null ? '' : h).replace(/[_\s]+/g, ' ').trim().toLowerCase());
  const used = new Set();
  const get = (field) => {
    for (const alias of DOCKET_FIELD_ALIASES[field]) {
      for (let i = 0; i < norm.length; i++) {
        if (used.has(i)) continue;
        const h = norm[i];
        if (!h) continue;
        if (h === alias || h.includes(alias) || (alias.length >= 3 && alias.includes(h))) {
          used.add(i);
          const v = row[i];
          return v == null ? '' : v;
        }
      }
    }
    return '';
  };
  return {
    mobile: get('mobile'), docket_no: get('docket_no'), courier: get('courier'),
    tracking: get('tracking'), status: get('status'), dispatch_date: fmtDate(get('dispatch_date')),
    organization: get('organization'), items: get('items'), boxes: get('boxes'), store_owner: get('store_owner')
  };
}

const COURIER_TRACKING = [
  { keys: ['delhivery'], url: 'https://www.delhivery.com/tracking' },
  { keys: ['blue dart', 'bluedart', 'blue-dart'], url: 'https://www.bluedart.com/tracking' },
  { keys: ['dtdc', 'desk to desk'], url: 'https://www.dtdc.com/track-your-shipment/' },
  { keys: ['india post', 'speed post', 'speedpost', 'postal', 'ems'], url: 'https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx' },
  { keys: ['ekart', 'e-kart', 'flipkart'], url: 'https://www.ekartlogistics.in/track-order' },
  { keys: ['xpressbees', 'xpress bees'], url: 'https://www.xpressbees.com/shipment/tracking' },
  { keys: ['trackon'], url: 'https://www.trackontrack.com/TrackParcel' },
  { keys: ['safexpress', 'safe express'], url: 'https://www.safexpress.com/Track-Your-Shipment' },
  { keys: ['gati'], url: 'https://www.gati.com/tracking' },
  { keys: ['shadowfax'], url: 'https://www.shadowfax.in/tracking' },
  { keys: ['ols'], url: 'https://www.olslogistics.in/tracking' },
  { keys: ['baluni'], url: 'https://trk.ecount.in/lr/baluni' },
  { keys: ['xp india', 'xpindia'], url: 'https://tracking.xpindia.in/track-order' }
];
function courierTrackUrl(courier, tracking) {
  const trackingNo = String(tracking || '').trim();
  if (!trackingNo) return '';
  const name = String(courier || '').toLowerCase().trim();
  if (!name) return '';
  for (const c of COURIER_TRACKING) {
    if (c.keys.some(k => name.includes(k))) return c.url;
  }
  return '';
}

const COLUMNS = [
  { header: 'ID', key: 'id', width: 8 },
  { header: 'Date', key: 'date', width: 22 },
  { header: 'Type', key: 'type', width: 12 },
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Organization', key: 'organization', width: 26 },
  { header: 'City', key: 'city', width: 16 },
  { header: 'State', key: 'state', width: 16 },
  { header: 'Kendra Code', key: 'kendraCode', width: 14 },
  { header: 'Order Type', key: 'orderType', width: 18 },
  { header: 'Subject', key: 'subject', width: 24 },
  { header: 'Details', key: 'details', width: 60 }
];

async function sendEmail(data) {
  if (!CONFIG.smtp.user || !CONFIG.smtp.pass) return false;
  const transporter = nodemailer.createTransport({
    host: CONFIG.smtp.host, port: CONFIG.smtp.port, secure: CONFIG.smtp.secure,
    auth: { user: CONFIG.smtp.user, pass: CONFIG.smtp.pass }
  });
  const fields = [
    ['Type', data.type], ['Name', data.name], ['Email', data.email], ['Phone', data.phone],
    ['Organization', data.organization], ['City', data.city], ['State', data.state],
    ['Kendra Code', data.kendraCode], ['Order Type', data.orderType], ['Subject', data.subject],
    ['Details', data.details]
  ].filter(([, v]) => v);
  const rows = fields.map(([k, v]) => `<b>${k}:</b> ${String(v).replace(/</g, '&lt;')}`).join('<br>');
  await transporter.sendMail({
    from: CONFIG.smtp.user, to: CONFIG.notifyEmail,
    subject: `New ${data.type} submission from ${data.name}`,
    html: `<h3>New Radhika Agencies Submission (${data.type})</h3>${rows}<hr><small>Received ${new Date().toLocaleString('en-IN')}</small>`
  });
  return true;
}

app.get('/api/health', async (req, res) => {
  try { await db.ping(); res.json({ ok: true }); }
  catch (err) { res.status(503).json({ ok: false }); }
});

async function handleSubmit(req, res) {
  try {
    const b = req.body || {};
    const type = String(b.type || '').trim().toLowerCase();
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ ok: false, message: 'Invalid submission type.' });
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone) return res.status(400).json({ ok: false, message: 'Name and phone are required.' });
    if (!/^[0-9+\-\s]{7,15}$/.test(phone)) return res.status(400).json({ ok: false, message: 'Invalid contact number.' });
    const clean = {
      type, name, email: b.email ? String(b.email).trim() : '', phone,
      organization: b.organization ? String(b.organization).trim() : '',
      city: b.city ? String(b.city).trim() : '', state: b.state ? String(b.state).trim() : '',
      kendraCode: b.kendraCode ? String(b.kendraCode).trim() : '',
      orderType: b.orderType ? String(b.orderType).trim() : '',
      subject: b.subject ? String(b.subject).trim() : '',
      details: b.details ? String(b.details).trim() : ''
    };
    const id = await db.insertSubmission(clean);
    const emailed = await sendEmail(clean).catch(() => false);
    res.json({ ok: true, id, emailed, message: 'Submission received. Our team will respond shortly.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error. Please try again.' });
  }
}

app.post('/api/submit', handleSubmit);
app.post('/api/enquiry', (req, res) => {
  const b = req.body || {};
  req.body = { type: 'enquiry', name: b.name, phone: b.contact, organization: b.location, kendraCode: b.storeCode, details: b.question };
  return handleSubmit(req, res);
});
app.post('/api/admin/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === CONFIG.adminUser && pass === CONFIG.adminPass) return res.json({ ok: true, token: makeToken(user) });
  res.status(401).json({ ok: false, message: 'Invalid credentials' });
});
app.post('/api/courier/login', (req, res) => {
  const { user, pass } = req.body || {};
  const account = (CONFIG.courierAccounts || []).find(a => a.user === user && a.pass === pass);
  if (account) return res.json({ ok: true, token: makeToken(account.user) });
  res.status(401).json({ ok: false, message: 'Invalid credentials' });
});

app.post('/api/courier/dockets/upload', authCourier, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, message: 'No file data provided.' });
    const buf = req.file.buffer;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ ok: false, message: 'Excel sheet is empty.' });
    const KNOWN_HEADERS = Object.values(DOCKET_FIELD_ALIASES).flat();
    const normHeader = (c) => String(c == null ? '' : c).replace(/[_\s]+/g, ' ').trim().toLowerCase();
    let headerRowNum = 0, headerRow = [], bestScore = 0;
    const scanLimit = Math.min(10, sheet.rowCount);
    for (let r = 1; r <= scanLimit; r++) {
      const norm = sheet.getRow(r).values.slice(1).map(normHeader);
      let score = 0;
      for (const h of norm) {
        if (h && KNOWN_HEADERS.some(a => h === a || h.includes(a) || (a.length >= 3 && a.includes(h)))) score++;
      }
      if (score > bestScore) { bestScore = score; headerRowNum = r; headerRow = norm; }
    }
    if (bestScore === 0) {
      headerRowNum = 0;
      headerRow = ['date', 'storecode', 'docket no.', 'store owner', 'no of box', 'mobile number', 'courier name'];
    }
    let inserted = 0, skipped = 0, errors = 0;
    for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
      const cells = sheet.getRow(r).values.slice(1);
      if (!cells || cells.length === 0 || cells.every(v => v === null || v === undefined || String(v).trim() === '')) continue;
      try {
        const mapped = mapDocketRow(headerRow, cells);
        const mobile = db.normalizePhone(mapped.mobile);
        const docketNo = String(mapped.docket_no || '').trim();
        if (!mobile && !docketNo) { skipped++; continue; }
        await db.upsertDocket(mapped, r);
        inserted++;
      } catch (rowErr) { errors++; }
    }
    res.json({ ok: true, inserted, skipped, errors, message: `Imported ${inserted} docket(s), skipped ${skipped} row(s)${errors ? ', ' + errors + ' row(s) with errors' : ''}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Failed to parse file. Ensure it is a valid .xlsx workbook.' });
  }
});

const docketRateLimit = new Map();
const DOCKET_RL_MAX = 5;
const DOCKET_RL_WINDOW = 60 * 60 * 1000;
function checkDocketRateLimit(mobile) {
  const now = Date.now();
  const hits = (docketRateLimit.get(mobile) || []).filter(t => now - t < DOCKET_RL_WINDOW);
  if (hits.length >= DOCKET_RL_MAX) { docketRateLimit.set(mobile, hits); return false; }
  hits.push(now);
  docketRateLimit.set(mobile, hits);
  return true;
}

app.get('/api/docket', async (req, res) => {
  try {
    const phone = String(req.query.phone || '').trim();
    const store = String(req.query.store || '').trim();
    if (!phone && !store) return res.status(400).json({ ok: false, message: 'Please enter a mobile number or store code.' });
    let dockets;
    if (phone) {
      const mobile = db.normalizePhone(phone);
      if (!mobile) return res.status(400).json({ ok: false, message: 'Please enter a valid mobile number.' });
      if (!checkDocketRateLimit('p:' + mobile)) return res.status(429).json({ ok: false, message: 'Too many lookups. Please try again after an hour.' });
      dockets = await db.getDocketsByPhone(mobile);
    } else {
      if (!checkDocketRateLimit('s:' + store.toLowerCase())) return res.status(429).json({ ok: false, message: 'Too many lookups. Please try again after an hour.' });
      dockets = await db.getDocketsByStore(store);
    }
    res.json({ ok: true, found: dockets.length > 0, dockets: dockets.map(d => ({ ...d, trackUrl: courierTrackUrl(d.courier, d.tracking) })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error. Please try again.' });
  }
});

app.get('/api/admin/enquiries', auth, async (req, res) => {
  try { res.json({ ok: true, enquiries: await db.getSubmissions() }); }
  catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

app.get('/api/admin/download', auth, async (req, res) => {
  try {
    const rows = await db.getSubmissions();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Submissions');
    worksheet.columns = COLUMNS;
    worksheet.getRow(1).font = { bold: true };
    rows.slice().reverse().forEach(r => worksheet.addRow(r));
    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="submissions.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

module.exports = app;
