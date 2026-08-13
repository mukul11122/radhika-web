const path = require('path');

const TABLE = 'submissions';
const DOCKET_TABLE = 'dockets';
const DOCKET_COLS = ['mobile', 'docket_no', 'courier', 'tracking', 'status', 'dispatch_date', 'organization', 'items', 'boxes', 'store_owner'];

// Normalize a phone number to its last 10 digits (handles +91, 0 prefix, spaces, dashes)
function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.slice(-10);
}
const COLS = ['date', 'type', 'name', 'email', 'phone', 'organization', 'city', 'state', 'kendraCode', 'orderType', 'subject', 'details'];

let mode = null;        // 'mysql' | 'sqlite'
let mysqlPool = null;
let sqliteDb = null;

function getMode() {
  if (mode) return mode;
  mode = (process.env.DB_TYPE === 'mysql' || process.env.DB_HOST) ? 'mysql' : 'sqlite';
  return mode;
}

async function initDB() {
  const m = getMode();
  if (m === 'mysql') {
    const mysql = require('mysql2/promise');
    const ssl = process.env.DB_SSL === 'true'
      ? { ssl: { rejectUnauthorized: false } }
      : {};
    mysqlPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'radhika',
      waitForConnections: true,
      connectionLimit: 5,
      ...ssl
    });
    await mysqlPool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INT PRIMARY KEY AUTO_INCREMENT,
      date TEXT, type TEXT, name TEXT, email TEXT, phone TEXT,
      organization TEXT, city TEXT, state TEXT, kendraCode TEXT,
      orderType TEXT, subject TEXT, details TEXT
    )`);
    console.log('[db] MySQL connected');
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = process.env.DB_FILE || path.join(__dirname, 'submissions.db');
    sqliteDb = new DatabaseSync(dbPath);
    sqliteDb.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT, type TEXT, name TEXT, email TEXT, phone TEXT,
      organization TEXT, city TEXT, state TEXT, kendraCode TEXT,
      orderType TEXT, subject TEXT, details TEXT
    )`);
    console.log('[db] SQLite connected at', dbPath);
  }
  await initDockets();
}

async function initDockets() {
  if (mode === 'mysql') {
    await mysqlPool.query(`CREATE TABLE IF NOT EXISTS ${DOCKET_TABLE} (
      id INT PRIMARY KEY AUTO_INCREMENT,
      mobile TEXT, docket_no TEXT, courier TEXT, tracking TEXT,
      status TEXT, dispatch_date TEXT, organization TEXT, items TEXT, boxes TEXT, store_owner TEXT
    )`);
  } else {
    sqliteDb.exec(`CREATE TABLE IF NOT EXISTS ${DOCKET_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mobile TEXT, docket_no TEXT, courier TEXT, tracking TEXT,
      status TEXT, dispatch_date TEXT, organization TEXT, items TEXT, boxes TEXT, store_owner TEXT
    )`);
  }
  // Migrate pre-existing tables that lack newer columns
  for (const col of ['boxes', 'store_owner']) {
    try {
      if (mode === 'mysql') {
        await mysqlPool.query(`ALTER TABLE ${DOCKET_TABLE} ADD COLUMN ${col} TEXT`);
      } else {
        sqliteDb.exec(`ALTER TABLE ${DOCKET_TABLE} ADD COLUMN ${col} TEXT`);
      }
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  }
}

async function insertSubmission(data) {
  const values = COLS.map(c => (data[c] !== undefined ? data[c] : ''));
  if (mode === 'mysql') {
    const [res] = await mysqlPool.query(
      `INSERT INTO ${TABLE} (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`,
      values
    );
    return res.insertId;
  }
  const stmt = sqliteDb.prepare(`INSERT INTO ${TABLE} (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`);
  const info = stmt.run(...values);
  return Number(info.lastInsertRowid);
}

async function getSubmissions() {
  let rows;
  if (mode === 'mysql') {
    const [r] = await mysqlPool.query(`SELECT * FROM ${TABLE} ORDER BY id DESC`);
    rows = r;
  } else {
    const stmt = sqliteDb.prepare(`SELECT * FROM ${TABLE} ORDER BY id DESC`);
    rows = stmt.all();
  }
  return rows.map(r => ({
    id: r.id, date: r.date, type: r.type, name: r.name, email: r.email,
    phone: r.phone, organization: r.organization, city: r.city, state: r.state,
    kendraCode: r.kendraCode, orderType: r.orderType, subject: r.subject, details: r.details
  }));
}

// Lightweight health check against the active database
async function ping() {
  if (mode === 'mysql') {
    await mysqlPool.query('SELECT 1');
  } else {
    sqliteDb.prepare('SELECT 1').get();
  }
  return true;
}

module.exports = { initDB, insertSubmission, getSubmissions, normalizePhone, upsertDocket, getDocketsByPhone, ping };

// Insert or update a docket keyed by (mobile, docket_no).
// When no docket number is supplied (e.g. courier sheets with just a tracking number),
// fall back to the tracking number, then to the mobile, so each row stays unique per customer.
async function upsertDocket(data) {
  const mobile = normalizePhone(data.mobile);
  if (!mobile) return null;
  const docketNo = String(data.docket_no || '').trim();
  const key = docketNo || String(data.tracking || '').trim() || ('MOB-' + mobile);
  const values = {
    mobile,
    docket_no: key,
    courier: String(data.courier || '').trim(),
    tracking: String(data.tracking || '').trim(),
    status: String(data.status || '').trim(),
    dispatch_date: String(data.dispatch_date || '').trim(),
    organization: String(data.organization || '').trim(),
    items: String(data.items || '').trim(),
    boxes: String(data.boxes || '').trim(),
    store_owner: String(data.store_owner || '').trim()
  };
  if (mode === 'mysql') {
    const [rows] = await mysqlPool.query(
      `SELECT id FROM ${DOCKET_TABLE} WHERE mobile=? AND docket_no=?`,
      [mobile, key]
    );
    if (rows.length) {
      await mysqlPool.query(
        `UPDATE ${DOCKET_TABLE} SET courier=?, tracking=?, status=?, dispatch_date=?, organization=?, items=?, boxes=?, store_owner=? WHERE id=?`,
        [values.courier, values.tracking, values.status, values.dispatch_date, values.organization, values.items, values.boxes, values.store_owner, rows[0].id]
      );
      return rows[0].id;
    }
    const [res] = await mysqlPool.query(
      `INSERT INTO ${DOCKET_TABLE} (${DOCKET_COLS.join(',')}) VALUES (${DOCKET_COLS.map(() => '?').join(',')})`,
      DOCKET_COLS.map(c => values[c])
    );
    return res.insertId;
  }
  const find = sqliteDb.prepare(`SELECT id FROM ${DOCKET_TABLE} WHERE mobile=? AND docket_no=?`);
  const existing = find.get(mobile, key);
  if (existing) {
    const stmt = sqliteDb.prepare(
      `UPDATE ${DOCKET_TABLE} SET courier=?, tracking=?, status=?, dispatch_date=?, organization=?, items=?, boxes=?, store_owner=? WHERE id=?`
    );
    stmt.run(values.courier, values.tracking, values.status, values.dispatch_date, values.organization, values.items, values.boxes, values.store_owner, existing.id);
    return existing.id;
  }
  const stmt = sqliteDb.prepare(`INSERT INTO ${DOCKET_TABLE} (${DOCKET_COLS.join(',')}) VALUES (${DOCKET_COLS.map(() => '?').join(',')})`);
  const info = stmt.run(...DOCKET_COLS.map(c => values[c]));
  return Number(info.lastInsertRowid);
}

// Return all dockets for a (normalized) mobile number
async function getDocketsByPhone(rawPhone) {
  const mobile = normalizePhone(rawPhone);
  if (!mobile) return [];
  let rows;
  if (mode === 'mysql') {
    const [r] = await mysqlPool.query(
      `SELECT ${DOCKET_COLS.join(',')} FROM ${DOCKET_TABLE} WHERE mobile=? ORDER BY id DESC`,
      [mobile]
    );
    rows = r;
  } else {
    const stmt = sqliteDb.prepare(`SELECT ${DOCKET_COLS.join(',')} FROM ${DOCKET_TABLE} WHERE mobile=? ORDER BY id DESC`);
    rows = stmt.all(mobile);
  }
  return rows.map(r => ({
    mobile: r.mobile, docketNo: r.docket_no, courier: r.courier, tracking: r.tracking,
    status: r.status, dispatchDate: r.dispatch_date, organization: r.organization, items: r.items,
    boxes: r.boxes, storeOwner: r.store_owner
  }));
}
