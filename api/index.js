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
app.use(require('../lib/operations').monitor(db));
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
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
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
  const expected = crypto
    .createHmac('sha256', CONFIG.adminSecret)
    .update(payload)
    .digest('base64url');
  if (sig !== expected) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.user;
  } catch {
    return false;
  }
}
function auth(req, res, next) {
  const token = req.headers['authorization'] || req.query.token || '';
  const clean = token.replace(/^Bearer\s+/i, '');
  if (verifyToken(clean) !== CONFIG.adminUser)
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  next();
}

const DEFAULT_COURIER_ACCOUNTS = [
  { user: 'courier1', pass: 'roZBhIeStc' },
  { user: 'courier2', pass: 'Xvc0wT5pq18' },
  { user: 'courier3', pass: 'VYGh4wew' },
  { user: 'courier4', pass: 'nYTKJ5Vdej4' },
  { user: 'courier5', pass: 'hZKZCyG0vc8' },
];
function parseCourierAccounts() {
  const raw = process.env.COURIER_ACCOUNTS;
  if (raw && raw.trim()) {
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf(':');
        return { user: pair.slice(0, idx).trim(), pass: pair.slice(idx + 1).trim() };
      })
      .filter((a) => a.user && a.pass);
    if (parsed.length) return parsed;
  }
  return DEFAULT_COURIER_ACCOUNTS;
}
CONFIG.courierAccounts = parseCourierAccounts();

function isCourier(user) {
  return (
    Array.isArray(CONFIG.courierAccounts) && CONFIG.courierAccounts.some((a) => a.user === user)
  );
}
function authCourier(req, res, next) {
  const token = req.headers['authorization'] || req.query.token || '';
  const clean = token.replace(/^Bearer\s+/i, '');
  const user = verifyToken(clean);
  if (!user || !isCourier(user))
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  next();
}

const DOCKET_FIELD_ALIASES = {
  mobile: ['mobile', 'mobile number', 'phone', 'contact', 'contact number', 'whatsapp', 'mob'],
  docket_no: [
    'docket no',
    'docket',
    'docket no.',
    'invoice',
    'invoice no',
    'invoice no.',
    'lr',
    'lr no',
    'lr no.',
    'consignment',
    'challan',
    'challan no',
  ],
  courier: ['courier', 'courier name', 'courier service', 'transporter', 'transport', 'carrier'],
  tracking: [
    'tracking',
    'tracking no',
    'tracking number',
    'tracking id',
    'awb',
    'awb no',
    'awb number',
  ],
  status: ['status', 'dispatch status', 'current status', 'delivery status'],
  dispatch_date: ['date', 'dispatch date', 'dispatched on', 'ship date', 'dispatch dt'],
  organization: [
    'organization',
    'org',
    'storecode',
    'store code',
    'kendra',
    'kendra name',
    'customer',
    'customer name',
    'party',
    'party name',
  ],
  items: [
    'items',
    'item details',
    'description',
    'contents',
    'product',
    'products',
    'details',
    'remarks',
  ],
  boxes: [
    'boxes',
    'no of box',
    'no of boxes',
    'no. of box',
    'no. of boxes',
    'box count',
    'boxes count',
    'packets',
    'packet count',
    'cartons',
  ],
  store_owner: [
    'store owner',
    'store owner name',
    'owner',
    'owner name',
    'kendra owner',
    'shop owner',
    'proprietor',
    'receiver',
    'receiver name',
  ],
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
  const norm = headers.map((h) =>
    String(h == null ? '' : h)
      .replace(/[_\s]+/g, ' ')
      .trim()
      .toLowerCase()
  );
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
    mobile: get('mobile'),
    docket_no: get('docket_no'),
    courier: get('courier'),
    tracking: get('tracking'),
    status: get('status'),
    dispatch_date: fmtDate(get('dispatch_date')),
    organization: get('organization'),
    items: get('items'),
    boxes: get('boxes'),
    store_owner: get('store_owner'),
  };
}

const COURIER_TRACKING = [
  { keys: ['delhivery'], url: 'https://www.delhivery.com/tracking' },
  { keys: ['blue dart', 'bluedart', 'blue-dart'], url: 'https://www.bluedart.com/tracking' },
  { keys: ['dtdc', 'desk to desk'], url: 'https://www.dtdc.com/track-your-shipment/' },
  {
    keys: ['india post', 'speed post', 'speedpost', 'postal', 'ems'],
    url: 'https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx',
  },
  { keys: ['ekart', 'e-kart', 'flipkart'], url: 'https://www.ekartlogistics.in/track-order' },
  { keys: ['xpressbees', 'xpress bees'], url: 'https://www.xpressbees.com/shipment/tracking' },
  { keys: ['trackon'], url: 'https://www.trackontrack.com/TrackParcel' },
  { keys: ['safexpress', 'safe express'], url: 'https://www.safexpress.com/Track-Your-Shipment' },
  { keys: ['gati'], url: 'https://www.gati.com/tracking' },
  { keys: ['shadowfax'], url: 'https://www.shadowfax.in/tracking' },
  { keys: ['ols'], url: 'https://www.olslogistics.in/tracking' },
  { keys: ['baluni'], url: 'https://trk.ecount.in/lr/baluni' },
  { keys: ['xp india', 'xpindia'], url: 'https://tracking.xpindia.in/track-order' },
];
function courierTrackUrl(courier, tracking) {
  const trackingNo = String(tracking || '').trim();
  if (!trackingNo) return '';
  const name = String(courier || '')
    .toLowerCase()
    .trim();
  if (!name) return '';
  for (const c of COURIER_TRACKING) {
    if (c.keys.some((k) => name.includes(k))) return c.url;
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
  { header: 'Details', key: 'details', width: 60 },
];

async function sendEmail(data) {
  if (!CONFIG.smtp.user || !CONFIG.smtp.pass) return false;
  const transporter = nodemailer.createTransport({
    host: CONFIG.smtp.host,
    port: CONFIG.smtp.port,
    secure: CONFIG.smtp.secure,
    auth: { user: CONFIG.smtp.user, pass: CONFIG.smtp.pass },
  });
  const fields = [
    ['Type', data.type],
    ['Name', data.name],
    ['Email', data.email],
    ['Phone', data.phone],
    ['Organization', data.organization],
    ['City', data.city],
    ['State', data.state],
    ['Kendra Code', data.kendraCode],
    ['Order Type', data.orderType],
    ['Subject', data.subject],
    ['Details', data.details],
  ].filter(([, v]) => v);
  const rows = fields
    .map(([k, v]) => `<b>${k}:</b> ${String(v).replace(/</g, '&lt;')}`)
    .join('<br>');
  await transporter.sendMail({
    from: CONFIG.smtp.from,
    to: CONFIG.notifyEmail,
    subject: `New ${data.type} submission from ${data.name}`,
    html: `<h3>New Radhika Agencies Submission (${data.type})</h3>${rows}<hr><small>Received ${new Date().toLocaleString('en-IN')}</small>`,
  });
  return true;
}

app.get('/api/health', async (req, res) => {
  try {
    await db.ping();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
});

async function handleSubmit(req, res) {
  try {
    const b = req.body || {};
    const type = String(b.type || '')
      .trim()
      .toLowerCase();
    if (!VALID_TYPES.includes(type))
      return res.status(400).json({ ok: false, message: 'Invalid submission type.' });
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone)
      return res.status(400).json({ ok: false, message: 'Name and phone are required.' });
    if (!/^[0-9+\-\s]{7,15}$/.test(phone))
      return res.status(400).json({ ok: false, message: 'Invalid contact number.' });
    const clean = {
      type,
      name,
      email: b.email ? String(b.email).trim() : '',
      phone,
      organization: b.organization ? String(b.organization).trim() : '',
      city: b.city ? String(b.city).trim() : '',
      state: b.state ? String(b.state).trim() : '',
      kendraCode: b.kendraCode ? String(b.kendraCode).trim() : '',
      orderType: b.orderType ? String(b.orderType).trim() : '',
      subject: b.subject ? String(b.subject).trim() : '',
      details: b.details ? String(b.details).trim() : '',
    };
    const id = await db.insertSubmission(clean);
    const emailed = await sendEmail(clean).catch(() => false);
    res.json({
      ok: true,
      id,
      emailed,
      message: 'Submission received. Our team will respond shortly.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error. Please try again.' });
  }
}

app.post('/api/submit', handleSubmit);
app.post('/api/enquiry', (req, res) => {
  const b = req.body || {};
  req.body = {
    type: 'enquiry',
    name: b.name,
    phone: b.contact,
    organization: b.location,
    kendraCode: b.storeCode,
    details: b.question,
  };
  return handleSubmit(req, res);
});
app.post('/api/admin/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === CONFIG.adminUser && pass === CONFIG.adminPass)
    return res.json({ ok: true, token: makeToken(user) });
  res.status(401).json({ ok: false, message: 'Invalid credentials' });
});
app.post('/api/courier/login', (req, res) => {
  const { user, pass } = req.body || {};
  const account = (CONFIG.courierAccounts || []).find((a) => a.user === user && a.pass === pass);
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
    const normHeader = (c) =>
      String(c == null ? '' : c)
        .replace(/[_\s]+/g, ' ')
        .trim()
        .toLowerCase();
    let headerRowNum = 0,
      headerRow = [],
      bestScore = 0;
    const scanLimit = Math.min(10, sheet.rowCount);
    for (let r = 1; r <= scanLimit; r++) {
      const norm = sheet.getRow(r).values.slice(1).map(normHeader);
      let score = 0;
      for (const h of norm) {
        if (
          h &&
          KNOWN_HEADERS.some((a) => h === a || h.includes(a) || (a.length >= 3 && a.includes(h)))
        )
          score++;
      }
      if (score > bestScore) {
        bestScore = score;
        headerRowNum = r;
        headerRow = norm;
      }
    }
    if (bestScore === 0) {
      headerRowNum = 0;
      headerRow = [
        'date',
        'storecode',
        'docket no.',
        'store owner',
        'no of box',
        'mobile number',
        'courier name',
      ];
    }
    let inserted = 0,
      skipped = 0,
      errors = 0;
    for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
      const cells = sheet.getRow(r).values.slice(1);
      if (
        !cells ||
        cells.length === 0 ||
        cells.every((v) => v === null || v === undefined || String(v).trim() === '')
      )
        continue;
      try {
        const mapped = mapDocketRow(headerRow, cells);
        const mobile = db.normalizePhone(mapped.mobile);
        const docketNo = String(mapped.docket_no || '').trim();
        if (!mobile && !docketNo) {
          skipped++;
          continue;
        }
        await db.upsertDocket(mapped, r);
        inserted++;
      } catch (rowErr) {
        errors++;
      }
    }
    res.json({
      ok: true,
      inserted,
      skipped,
      errors,
      message: `Imported ${inserted} docket(s), skipped ${skipped} row(s)${errors ? ', ' + errors + ' row(s) with errors' : ''}.`,
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ ok: false, message: 'Failed to parse file. Ensure it is a valid .xlsx workbook.' });
  }
});

const docketRateLimit = new Map();
const DOCKET_RL_MAX = 5;
const DOCKET_RL_WINDOW = 60 * 60 * 1000;
function checkDocketRateLimit(mobile) {
  const now = Date.now();
  const hits = (docketRateLimit.get(mobile) || []).filter((t) => now - t < DOCKET_RL_WINDOW);
  if (hits.length >= DOCKET_RL_MAX) {
    docketRateLimit.set(mobile, hits);
    return false;
  }
  hits.push(now);
  docketRateLimit.set(mobile, hits);
  return true;
}

app.get('/api/docket', async (req, res) => {
  try {
    const phone = String(req.query.phone || '').trim();
    const store = String(req.query.store || '').trim();
    if (!phone && !store)
      return res
        .status(400)
        .json({ ok: false, message: 'Please enter a mobile number or store code.' });
    let dockets;
    if (phone) {
      const mobile = db.normalizePhone(phone);
      if (!mobile)
        return res.status(400).json({ ok: false, message: 'Please enter a valid mobile number.' });
      if (!checkDocketRateLimit('p:' + mobile))
        return res
          .status(429)
          .json({ ok: false, message: 'Too many lookups. Please try again after an hour.' });
      dockets = await db.getDocketsByPhone(mobile);
    } else {
      if (!checkDocketRateLimit('s:' + store.toLowerCase()))
        return res
          .status(429)
          .json({ ok: false, message: 'Too many lookups. Please try again after an hour.' });
      dockets = await db.getDocketsByStore(store);
    }
    res.json({
      ok: true,
      found: dockets.length > 0,
      dockets: dockets.map((d) => ({ ...d, trackUrl: courierTrackUrl(d.courier, d.tracking) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error. Please try again.' });
  }
});

app.get('/api/admin/enquiries', auth, async (req, res) => {
  try {
    res.json({ ok: true, enquiries: await db.getSubmissions() });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.get('/api/admin/download', auth, async (req, res) => {
  try {
    const rows = await db.getSubmissions();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Submissions');
    worksheet.columns = COLUMNS;
    worksheet.getRow(1).font = { bold: true };
    rows
      .slice()
      .reverse()
      .forEach((r) => worksheet.addRow(r));
    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="submissions.xlsx"');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buf);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.get('/api/stock', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const snapshot = await db.getStock();
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0)
      return res.status(400).json({ ok: false, message: 'Invalid stock page.' });
    const snapshotToken = snapshot.revision || snapshot.version;
    if (req.query.snapshot && req.query.snapshot !== snapshotToken)
      return res
        .status(409)
        .json({ ok: false, message: 'Stock changed while loading. Please refresh.' });
    const items = [];
    let bytes = 0;
    for (let i = offset; i < snapshot.items.length; i++) {
      const row = snapshot.items[i],
        size = Buffer.byteLength(JSON.stringify(row));
      if (items.length && (bytes + size > 1024 * 1024 || items.length >= 5000)) break;
      items.push(row);
      bytes += size;
    }
    const nextOffset = offset + items.length < snapshot.items.length ? offset + items.length : null;
    res.json({ ok: true, ...snapshot, items, snapshotToken, nextOffset });
  } catch (e) {
    console.error('[stock]', e.message);
    res
      .status(503)
      .json({ ok: false, message: 'Stock is temporarily unavailable. Please try again.' });
  }
});
function stockSecret() {
  return process.env.STOCK_UPLOAD_PASSWORD;
}
function stockSign(payload) {
  return crypto.createHmac('sha256', stockSecret()).update(payload).digest('base64url');
}
function stockAuth(req, res, next) {
  const secret = stockSecret();
  if (!secret)
    return res.status(503).json({ ok: false, message: 'Stock upload password is not configured.' });
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const parts = token.split('.');
    if (parts.length !== 2) throw new Error();
    const [payload, sig] = parts;
    const expected = stockSign(payload);
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    )
      throw new Error();
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.scope !== 'stock-upload-login' || !Number.isFinite(data.exp) || Date.now() > data.exp)
      throw new Error();
    req.adminUser = 'mukul';
    next();
  } catch {
    res.status(401).json({ ok: false, message: 'Enter the stock upload password to continue.' });
  }
}
app.post('/api/stock/login', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const secret = stockSecret();
  if (!secret)
    return res.status(503).json({ ok: false, message: 'Stock upload password is not configured.' });
  const actual = crypto
    .createHash('sha256')
    .update(String(req.body?.password || ''))
    .digest();
  const expected = crypto.createHash('sha256').update(secret).digest();
  if (
    String(req.body?.username || '').trim() !== 'mukul' ||
    !crypto.timingSafeEqual(actual, expected)
  )
    return res
      .status(401)
      .json({ ok: false, message: 'Incorrect username or password. Please try again.' });
  const payload = Buffer.from(
    JSON.stringify({ scope: 'stock-upload-login', exp: Date.now() + 30 * 60 * 1000 })
  ).toString('base64url');
  res.json({ ok: true, token: payload + '.' + stockSign(payload) });
});
require('../lib/stock-large-upload').register(app, { db, stockAuth });
require('../lib/order-admin').register(app, { db, stockAuth });
require('../lib/stock-management').register(app, { db, stockAuth });
require('../lib/order-insights').register(app, { db, stockAuth });
require('../lib/operations').register(app, { db, stockAuth });
require('../lib/admin-dockets').register(app, { db, stockAuth, courierTrackUrl });
require('../lib/kendra').register(app, { db, stockAuth });
const emailTransport = () =>
  nodemailer.createTransport({
    host: CONFIG.smtp.host,
    port: CONFIG.smtp.port,
    secure: CONFIG.smtp.secure,
    auth: { user: CONFIG.smtp.user, pass: CONFIG.smtp.pass },
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
app.get('/api/admin/email-health', stockAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const configured = CONFIG.smtp.host === 'smtp.resend.com' && CONFIG.smtp.user === 'resend' && CONFIG.smtp.pass.startsWith('re_') && !!CONFIG.smtp.from;
  if (!configured) return res.status(503).json({ok:false, message:'Resend configuration is incomplete.', resendConfigured:false});
  const transport = emailTransport();
  try { await transport.verify(); res.json({ok:true, resendConfigured:true, authenticated:true, message:'Resend SMTP authentication verified. No email sent.'}); }
  catch(error) {res.status(503).json({ok:false,resendConfigured:true,authenticated:false,code:error.code || 'CONNECTION_FAILED'});}
  finally {transport.close();}
});
require('../lib/email-delivery').register(app, {
  db,
  stockAuth,
  transport: emailTransport,
  from: CONFIG.smtp.from,
});
require('../lib/pin-recovery').register(app, {
  db,
  transport: emailTransport,
  from: CONFIG.smtp.from,
});
app.get('/api/admin/performance', stockAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const pool = await db.getPool();
    await require('../lib/performance-store').ensureRows(pool);
    const [version] = await pool.query('SELECT VERSION() AS version');
    const [counts] = await pool.query('SELECT COUNT(*) AS stockRows FROM stock_records');
    const [plan] = await pool.query(
      'EXPLAIN SELECT id FROM stock_requests WHERE store_code=? AND BINARY store_code=BINARY ? ORDER BY created_at DESC,id DESC LIMIT 21',
      ['22167', '22167']
    );
    const hint = (process.env.DB_HOST || '').match(
      /(?:ap|eu|us|sa|ca|me|af)-(?:south|southeast|northeast|north|central|west|east)-?\d|(?:mum|bom|sin|sgp|fra|lon|nyc|blr|ams|sfo)\d/gi
    );
    res.json({
      ok: true,
      databaseVersion: version[0].version,
      stockRows: counts[0].stockRows,
      orderHistoryIndex: plan[0]?.key || null,
      databaseRegionHint: hint,
      functionRegion: process.env.VERCEL_REGION || null,
    });
  } catch (e) {
    console.error('[performance]', e.message);
    res.status(503).json({ ok: false, message: 'Database optimization could not be verified.' });
  }
});
app.post('/api/admin/stock/upload', stockAuth, (req, res) => {
  const stockUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  }).single('file');
  stockUpload(req, res, async (err) => {
    if (err)
      return res
        .status(400)
        .json({ ok: false, message: 'Choose one .xlsx or CSV file up to 20 MB.' });
    if (!req.file) return res.status(400).json({ ok: false, message: 'Choose a stock file.' });
    let items;
    try {
      items = await require('../lib/stock').parseStock(req.file.buffer, req.file.originalname);
    } catch (e) {
      return res.status(400).json({ ok: false, message: e.message });
    }
    try {
      const result = await db.replaceStock(items);
      res.json({ ok: true, count: items.length, updatedAt: result.updatedAt });
    } catch (e) {
      console.error('[stock-upload]', e.message);
      res.status(503).json({ ok: false, message: 'Stock could not be saved. Please try again.' });
    }
  });
});

app.post('/api/stock/submit', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const {
    RECIPIENTS,
    orderItems,
    unavailableItems,
    mailContent,
    payloadHash,
  } = require('../lib/stock-order');
  const storeCode = String(req.body?.storeCode || '').trim(),
    mobile = String(req.body?.mobile || '').trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(storeCode) || !/^\d{10}$/.test(mobile))
    return res
      .status(400)
      .json({ ok: false, message: 'Store Code and a valid 10-digit Mobile No. are required.' });
  const id = String(req.body?.requestId || '');
  if (!/^[a-f0-9-]{36}$/i.test(id))
    return res
      .status(400)
      .json({ ok: false, message: 'Invalid request. Please reopen your list.' });
  if (!CONFIG.smtp.user || !CONFIG.smtp.pass)
    return res
      .status(503)
      .json({ ok: false, message: 'Email service is unavailable. Please try again later.' });
  let items, missingItems;
  try {
    missingItems = unavailableItems(req.body?.unavailableItems);
    items = orderItems(
      req.body?.items,
      req.body.items.map((r) => ({ code: r.code, available: Number.MAX_SAFE_INTEGER }))
    );
  } catch (e) {
    return res.status(400).json({ ok: false, message: e.message });
  }
  const allocations = req.body.items.map((r) => ({
    code: String(r.code),
    quantity: r.quantity,
    stockIds: r.stockIds,
  }));
  const order = {
    items,
    unavailableItems: missingItems,
    storeCode,
    mobile,
    allocations,
    stockVersion: req.body.stockVersion,
  };
  let pool, connection;
  try {
    pool = await db.getPool();
    if (req.body.profileToken) {
      try {
        order.contactProfile = await require('../lib/kendra').forOrder(
          db,
          req.body.profileToken,
          storeCode,
          mobile
        );
      } catch (error) {
        return res.status(400).json({ ok: false, message: error.message });
      }
    }
    await pool.query(
      'CREATE TABLE IF NOT EXISTS stock_requests (id VARCHAR(36) PRIMARY KEY, payload LONGTEXT NOT NULL, sent LONGTEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
    );
    await pool.query(
      'CREATE TABLE IF NOT EXISTS stock_allocations (request_id VARCHAR(36) PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
    );
    await require('../lib/order-admin').schema(pool);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.query('INSERT IGNORE INTO stock_requests (id,payload,sent) VALUES (?,?,?)', [
      id,
      JSON.stringify(order),
      '[]',
    ]);
    const [rows] = await connection.query(
      'SELECT payload,sent FROM stock_requests WHERE id=? FOR UPDATE',
      [id]
    );
    if (payloadHash(JSON.parse(rows[0].payload)) !== payloadHash(order)) {
      await connection.rollback();
      return res
        .status(409)
        .json({ ok: false, message: 'Your list changed. Please submit it again.' });
    }
    const sent = JSON.parse(rows[0].sent);
    const [reserved] = await connection.query(
      'SELECT request_id FROM stock_allocations WHERE request_id=?',
      [id]
    );
    if (!reserved.length && !sent.length) {
      const [snapshots] = await connection.query(
        'SELECT payload FROM stock_snapshot WHERE id=1 FOR UPDATE'
      );
      try {
        if (!snapshots.length) throw new Error('No stock is available.');
        const receipt = [];
        const next = require('../lib/stock-allocation').deductStock(
          JSON.parse(snapshots[0].payload),
          allocations,
          order.stockVersion,
          receipt
        );
        await connection.query('UPDATE stock_snapshot SET payload=? WHERE id=1', [
          JSON.stringify(next),
        ]);
        if (db.syncStockRows)
          await db.syncStockRows(connection, next, JSON.parse(snapshots[0].payload));
        await connection.query('INSERT INTO stock_allocations (request_id) VALUES (?)', [id]);
        await require('../lib/order-admin').recordReservation(
          connection,
          id,
          receipt,
          order.stockVersion
        );
        if (db.recordAudit)
          await db.recordAudit(connection, 'Customer', {
            from: null,
            to: 'New',
            storeCode,
            reservedQuantity: receipt.reduce((sum, row) => sum + row.quantity, 0),
          });
      } catch (e) {
        await connection.rollback();
        return res.status(409).json({ ok: false, message: e.message });
      }
    }
    await require('../lib/email-delivery').setup(pool);
    // Commit the reservation before email so unrelated orders never wait on SMTP.
    await connection.commit();
    await connection.beginTransaction();
    const [deliveryRows] = await connection.query(
      'SELECT payload,sent FROM stock_requests WHERE id=? FOR UPDATE',
      [id]
    );
    sent.splice(0, sent.length, ...JSON.parse(deliveryRows[0].sent));
    if (!(await require('../lib/order-admin').deliveryAllowed(connection, id))) {
      await connection.rollback();
      return res
        .status(409)
        .json({ ok: false, message: 'This order was cancelled. Please create a new order.' });
    }
    const transport = nodemailer.createTransport({
      host: CONFIG.smtp.host,
      port: CONFIG.smtp.port,
      secure: CONFIG.smtp.secure,
      auth: { user: CONFIG.smtp.user, pass: CONFIG.smtp.pass },
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
    for (const recipient of RECIPIENTS) {
      if (sent.includes(recipient)) continue;
      try {
        const out = await transport.sendMail({
          from: CONFIG.smtp.from,
          to: recipient,
          ...mailContent(id, items, { storeCode, mobile }),
        });
        if (!out.accepted?.length) throw new Error('Email was not accepted');
        sent.push(recipient);
        await connection.query('UPDATE stock_requests SET sent=? WHERE id=?', [
          JSON.stringify(sent),
          id,
        ]);
      } catch (e) {
        await require('../lib/email-delivery').record(connection, id, e);
        await connection.commit();
        console.error('[stock-email]', e.message);
        return res.status(503).json({
          ok: false,
          message:
            'Your order has been received and stock reserved. Email delivery is pending. Please do not place this order again.',
          orderReceived: true,
          emailPending: true,
          requestId: id,
        });
      }
    }
    await require('../lib/email-delivery').record(connection, id, null);
    await connection.commit();
    res.json({
      ok: true,
      requestId: id,
      message: 'Your list has been submitted and emailed to Radhika Agencies.',
    });
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[stock-submit]', e.message);
    res
      .status(503)
      .json({ ok: false, message: 'Submission could not be completed. Please try again.' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = app;
