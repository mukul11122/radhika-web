const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const db = require('./db');

// Load .env if present
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  notifyEmail: process.env.NOTIFY_EMAIL || 'radhikaagenciesddun@gmail.com',
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

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Block access to backend internals (source, .env, data) over HTTP
app.use((req, res, next) => {
  if (req.path.toLowerCase().startsWith('/backend')) return res.status(404).end();
  next();
});

// Serve the website statically (deny dotfiles like .env)
app.use(express.static(path.join(__dirname, '..'), { dotfiles: 'deny' }));
// Serve backend assets (e.g. admin.html)
app.use(express.static(__dirname, { dotfiles: 'deny' }));

// ---------- Auth helpers ----------
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
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return data.user === CONFIG.adminUser; }
  catch { return false; }
}
function auth(req, res, next) {
  const token = req.headers['authorization'] || req.query.token || '';
  const clean = token.replace(/^Bearer\s+/i, '');
  if (!verifyToken(clean)) return res.status(401).json({ ok: false, message: 'Unauthorized' });
  next();
}

// ---------- Excel columns (used for download) ----------
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

// ---------- Email notification ----------
async function sendEmail(data) {
  if (!CONFIG.smtp.user || !CONFIG.smtp.pass) {
    console.log('[email] SMTP not configured — skipping email notification.');
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: CONFIG.smtp.host,
    port: CONFIG.smtp.port,
    secure: CONFIG.smtp.secure,
    auth: { user: CONFIG.smtp.user, pass: CONFIG.smtp.pass }
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
    ['Details', data.details]
  ].filter(([, v]) => v);
  const rows = fields
    .map(([k, v]) => `<b>${k}:</b> ${String(v).replace(/</g, '&lt;')}`)
    .join('<br>');
  await transporter.sendMail({
    from: CONFIG.smtp.user,
    to: CONFIG.notifyEmail,
    subject: `New ${data.type} submission from ${data.name}`,
    html: `<h3>New Radhika Agencies Submission (${data.type})</h3>${rows}<hr><small>Received ${new Date().toLocaleString('en-IN')}</small>`
  });
  return true;
}

// ---------- Endpoints ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Shared submission handler
async function handleSubmit(req, res) {
  try {
    const b = req.body || {};
    const type = String(b.type || '').trim().toLowerCase();
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ ok: false, message: 'Invalid submission type.' });
    }
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone) {
      return res.status(400).json({ ok: false, message: 'Name and phone are required.' });
    }
    if (!/^[0-9+\-\s]{7,15}$/.test(phone)) {
      return res.status(400).json({ ok: false, message: 'Invalid contact number.' });
    }
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
      details: b.details ? String(b.details).trim() : ''
    };
    const id = await db.insertSubmission(clean);
    const emailed = await sendEmail(clean).catch(e => { console.error('[email] failed', e.message); return false; });
    res.json({ ok: true, id, emailed, message: 'Submission received. Our team will respond shortly.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error. Please try again.' });
  }
}

// Unified submission endpoint for enquiry / order / contact forms
app.post('/api/submit', handleSubmit);

// Back-compat alias for the old enquiry schema (location -> organization, contact -> phone)
app.post('/api/enquiry', (req, res) => {
  const b = req.body || {};
  req.body = {
    type: 'enquiry',
    name: b.name,
    phone: b.contact,
    organization: b.location,
    kendraCode: b.storeCode,
    details: b.question
  };
  return handleSubmit(req, res);
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === CONFIG.adminUser && pass === CONFIG.adminPass) {
    return res.json({ ok: true, token: makeToken(user) });
  }
  res.status(401).json({ ok: false, message: 'Invalid credentials' });
});

// List submissions (protected)
app.get('/api/admin/enquiries', auth, async (req, res) => {
  try { res.json({ ok: true, enquiries: await db.getSubmissions() }); }
  catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

// Download Excel (generated from DB rows, protected)
app.get('/api/admin/download', auth, async (req, res) => {
  try {
    const rows = await db.getSubmissions();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Submissions');
    worksheet.columns = COLUMNS;
    worksheet.getRow(1).font = { bold: true };
    rows.slice().reverse().forEach(r => worksheet.addRow(r)); // oldest first
    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="submissions.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// Keep-alive: ping self every 5 minutes to prevent Render free-tier sleep
if (process.env.RENDER) {
  const KEEPALIVE_MS = 5 * 60 * 1000;
  setInterval(() => {
    const host = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    fetch(`${host}/api/health`).catch(() => {});
  }, KEEPALIVE_MS);
}

// Find a free port starting from PORT (avoids clobbering an already-running server)
function listenOn(port) {
  const srv = app.listen(port, () => {
    console.log(`Radhika Agencies site+backend running on http://localhost:${port}`);
    if (!CONFIG.smtp.user) console.log('Note: set SMTP_USER/SMTP_PASS env vars to enable email notifications.');
  });
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < PORT + 10) {
      console.log(`Port ${port} in use — trying ${port + 1}…`);
      listenOn(port + 1);
    } else {
      console.error('Server failed to start:', err.message);
      process.exit(1);
    }
  });
}

db.initDB()
  .then(() => listenOn(Number(PORT)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
