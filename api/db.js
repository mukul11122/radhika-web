const TABLE = 'submissions';
const DOCKET_TABLE = 'dockets';
const DOCKET_COLS = ['mobile', 'docket_no', 'courier', 'tracking', 'status', 'dispatch_date', 'organization', 'items', 'boxes', 'store_owner'];
const COLS = ['date', 'type', 'name', 'email', 'phone', 'organization', 'city', 'state', 'kendraCode', 'orderType', 'subject', 'details'];

let mysqlPool = null;

function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.slice(-10);
}

async function getPool() {
  if (mysqlPool) return mysqlPool;
  const mysql = require('mysql2/promise');
  mysqlPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || 'defaultdb',
    waitForConnections: true,
    connectionLimit: 5,
    ssl: { rejectUnauthorized: false }
  });
  await mysqlPool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id INT PRIMARY KEY AUTO_INCREMENT,
    date TEXT, type TEXT, name TEXT, email TEXT, phone TEXT,
    organization TEXT, city TEXT, state TEXT, kendraCode TEXT,
    orderType TEXT, subject TEXT, details TEXT
  )`);
  await mysqlPool.query(`CREATE TABLE IF NOT EXISTS ${DOCKET_TABLE} (
    id INT PRIMARY KEY AUTO_INCREMENT,
    mobile TEXT, docket_no TEXT, courier TEXT, tracking TEXT,
    status TEXT, dispatch_date TEXT, organization TEXT, items TEXT, boxes TEXT, store_owner TEXT
  )`);
  for (const col of ['boxes', 'store_owner']) {
    try { await mysqlPool.query(`ALTER TABLE ${DOCKET_TABLE} ADD COLUMN ${col} TEXT`); }
    catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
  }
  return mysqlPool;
}

async function ping() {
  const pool = await getPool();
  await pool.query('SELECT 1');
  return true;
}

async function insertSubmission(data) {
  const pool = await getPool();
  const values = COLS.map(c => (data[c] !== undefined ? data[c] : ''));
  const [res] = await pool.query(
    `INSERT INTO ${TABLE} (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`,
    values
  );
  return res.insertId;
}

async function getSubmissions() {
  const pool = await getPool();
  const [rows] = await pool.query(`SELECT * FROM ${TABLE} ORDER BY id DESC`);
  return rows.map(r => ({
    id: r.id, date: r.date, type: r.type, name: r.name, email: r.email,
    phone: r.phone, organization: r.organization, city: r.city, state: r.state,
    kendraCode: r.kendraCode, orderType: r.orderType, subject: r.subject, details: r.details
  }));
}

async function upsertDocket(data, rowKey) {
  const pool = await getPool();
  const mobile = normalizePhone(data.mobile);
  const docketNo = String(data.docket_no || '').trim();
  const storeCode = String(data.organization || '').trim();
  const key = docketNo || (mobile ? ('MOB-' + mobile) : (storeCode ? ('STORE-' + storeCode.toLowerCase() + (rowKey ? '-' + rowKey : '')) : ''));
  if (!mobile && !docketNo && !storeCode) return null;
  const values = {
    mobile, docket_no: key,
    courier: String(data.courier || '').trim(),
    tracking: String(data.tracking || '').trim(),
    status: String(data.status || '').trim(),
    dispatch_date: String(data.dispatch_date || '').trim(),
    organization: String(data.organization || '').trim(),
    items: String(data.items || '').trim(),
    boxes: String(data.boxes || '').trim(),
    store_owner: String(data.store_owner || '').trim()
  };
  const [rows] = await pool.query(`SELECT id FROM ${DOCKET_TABLE} WHERE mobile=? AND docket_no=?`, [mobile, key]);
  if (rows.length) {
    await pool.query(
      `UPDATE ${DOCKET_TABLE} SET courier=?, tracking=?, status=?, dispatch_date=?, organization=?, items=?, boxes=?, store_owner=? WHERE id=?`,
      [values.courier, values.tracking, values.status, values.dispatch_date, values.organization, values.items, values.boxes, values.store_owner, rows[0].id]
    );
    return rows[0].id;
  }
  const [res] = await pool.query(
    `INSERT INTO ${DOCKET_TABLE} (${DOCKET_COLS.join(',')}) VALUES (${DOCKET_COLS.map(() => '?').join(',')})`,
    DOCKET_COLS.map(c => values[c])
  );
  return res.insertId;
}

function toDocket(r) {
  return {
    mobile: r.mobile, docketNo: r.docket_no, courier: r.courier, tracking: r.tracking,
    status: r.status, dispatchDate: r.dispatch_date, organization: r.organization, items: r.items,
    boxes: r.boxes, storeOwner: r.store_owner
  };
}

async function getDocketsByPhone(rawPhone) {
  const pool = await getPool();
  const mobile = normalizePhone(rawPhone);
  if (!mobile) return [];
  const [rows] = await pool.query(
    `SELECT ${DOCKET_COLS.join(',')} FROM ${DOCKET_TABLE} WHERE mobile=? ORDER BY id DESC`,
    [mobile]
  );
  return rows.map(toDocket);
}

async function getDocketsByStore(rawStore) {
  const pool = await getPool();
  const store = String(rawStore || '').trim().toLowerCase();
  if (!store) return [];
  const [rows] = await pool.query(
    `SELECT ${DOCKET_COLS.join(',')} FROM ${DOCKET_TABLE} WHERE LOWER(organization)=? ORDER BY id DESC`,
    [store]
  );
  return rows.map(toDocket);
}

module.exports = { getPool, ping, insertSubmission, getSubmissions, normalizePhone, upsertDocket, getDocketsByPhone, getDocketsByStore };
