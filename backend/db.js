const path = require('path');

const TABLE = 'submissions';
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
    mysqlPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'radhika',
      waitForConnections: true,
      connectionLimit: 5
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

module.exports = { initDB, insertSubmission, getSubmissions };
