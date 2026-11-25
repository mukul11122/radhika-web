const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const ready = new WeakMap();
function setup(pool) {
  if (!ready.has(pool))
    ready.set(
      pool,
      (async () => {
        await pool.query(
          'CREATE TABLE IF NOT EXISTS employees (id VARCHAR(36) PRIMARY KEY, username VARCHAR(40) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL, salt VARCHAR(64) NOT NULL, password_hash VARCHAR(128) NOT NULL, active TINYINT NOT NULL DEFAULT 1, session_version INT NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
        );
        await pool.query(
          'CREATE TABLE IF NOT EXISTS employee_reports (employee_id VARCHAR(36) NOT NULL, report_date DATE NOT NULL, entries LONGTEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY(employee_id,report_date), INDEX(report_date))'
        );
        await pool.query(
          'CREATE TABLE IF NOT EXISTS employee_login_limits (attempt_key VARCHAR(64) PRIMARY KEY, attempts INT NOT NULL DEFAULT 0, started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
        );
      })().catch((e) => {
        ready.delete(pool);
        throw e;
      })
    );
  return ready.get(pool);
}
const secret = () => process.env.STOCK_UPLOAD_PASSWORD;
function sign(data) {
  const p = Buffer.from(JSON.stringify(data)).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', secret()).update(p).digest('base64url');
}
function verify(raw) {
  if (!secret()) throw Error('Employee login is unavailable.');
  const parts = String(raw || '')
    .replace(/^Bearer\s+/i, '')
    .split('.');
  if (parts.length !== 2) throw Error('Please sign in again.');
  const sig = crypto.createHmac('sha256', secret()).update(parts[0]).digest('base64url');
  if (
    sig.length !== parts[1].length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(parts[1]))
  )
    throw Error('Please sign in again.');
  const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (p.scope !== 'employee-report' || !p.id || !Number.isFinite(p.exp) || p.exp < Date.now())
    throw Error('Please sign in again.');
  return p;
}
function dateValue(value) {
  const s = String(value || '');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    Number.isNaN(Date.parse(s + 'T00:00:00Z')) ||
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s ||
    s > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  )
    throw Error('Enter a valid report date, not in the future.');
  return s;
}
function entriesValue(value) {
  if (!Array.isArray(value) || !value.length || value.length > 200)
    throw Error('Add between 1 and 200 store rows.');
  return value.map((r) => {
    const storeCode = String(r.storeCode || '').trim();
    if (!/^\d{1,20}$/.test(storeCode)) throw Error('Enter a valid Store Code in every row.');
    const out = { storeCode };
    for (const k of ['challan', 'packing', 'invoice']) {
      const n = Number(r[k]);
      if (!Number.isSafeInteger(n) || n < 0 || n > 10000)
        throw Error('Counts must be whole numbers between 0 and 10000.');
      out[k] = n;
    }
    if (!(out.challan + out.packing + out.invoice))
      throw Error('Enter at least one count for each Store Code.');
    return out;
  });
}
function register(app, { db, stockAuth }) {
  const wrap = (fn) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await fn(req, res);
    } catch (e) {
      res.status(e.code ? 503 : e.status || 400).json({
        ok: false,
        message: e.code
          ? 'Employee service is temporarily unavailable.'
          : e.publicMessage || e.message || 'Please try again.',
      });
    }
  };
  async function pool() {
    const p = await db.getPool();
    await setup(p);
    return p;
  }
  async function employee(req) {
    const data = verify(req.headers.authorization);
    const p = await pool();
    const [rows] = await p.query(
      'SELECT id,username,name,active,session_version FROM employees WHERE id=?',
      [data.id]
    );
    if (!rows.length || !rows[0].active || rows[0].session_version !== data.ver)
      throw Error('Your session has expired. Please sign in again.');
    return rows[0];
  }
  app.post(
    '/api/employee/login',
    wrap(async (req, res) => {
      if (!secret()) throw Error('Employee login is unavailable.');
      const p = await pool();
      const username = String(req.body?.username || '')
        .trim()
        .toLowerCase();
      const password = String(req.body?.password || '');
      if (username.length > 40 || password.length > 128)
        return res.status(401).json({ ok: false, message: 'Incorrect username or password.' });
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
        .split(',')[0]
        .trim();
      const key = crypto
        .createHash('sha256')
        .update(ip + '|' + username)
        .digest('hex');
      await p.query(
        'INSERT INTO employee_login_limits (attempt_key,attempts,started_at) VALUES (?,1,NOW()) ON DUPLICATE KEY UPDATE attempts=IF(started_at < NOW() - INTERVAL 15 MINUTE,1,attempts+1), started_at=IF(started_at < NOW() - INTERVAL 15 MINUTE,NOW(),started_at)',
        [key]
      );
      const [limits] = await p.query(
        'SELECT attempts FROM employee_login_limits WHERE attempt_key=?',
        [key]
      );
      if (limits[0].attempts > 10)
        return res
          .status(429)
          .json({ ok: false, message: 'Too many attempts. Try again after 15 minutes.' });
      const [rows] = await p.query('SELECT * FROM employees WHERE username=?', [username]);
      const row = rows[0];
      const hash = await scrypt(password, row?.salt || '00000000000000000000000000000000', 64);
      const expected = Buffer.from(row?.password_hash || '0'.repeat(128), 'hex');
      if (
        !row ||
        !row.active ||
        hash.length !== expected.length ||
        !crypto.timingSafeEqual(hash, expected)
      )
        return res.status(401).json({ ok: false, message: 'Incorrect username or password.' });
      await p.query('DELETE FROM employee_login_limits WHERE attempt_key=?', [key]);
      res.json({
        ok: true,
        token: sign({
          scope: 'employee-report',
          id: row.id,
          ver: row.session_version,
          exp: Date.now() + 12 * 3600000,
        }),
        name: row.name,
      });
    })
  );
  app.get(
    '/api/employee/report',
    wrap(async (req, res) => {
      const e = await employee(req);
      const date = dateValue(req.query.date);
      const p = await pool();
      const [rows] = await p.query(
        'SELECT entries,updated_at FROM employee_reports WHERE employee_id=? AND report_date=?',
        [e.id, date]
      );
      res.json({
        ok: true,
        name: e.name,
        entries: rows.length ? JSON.parse(rows[0].entries) : [],
        updatedAt: rows[0]?.updated_at || null,
      });
    })
  );
  app.post(
    '/api/employee/report',
    wrap(async (req, res) => {
      const e = await employee(req),
        date = dateValue(req.body?.date),
        entries = entriesValue(req.body?.entries),
        p = await pool();
      await p.query(
        'INSERT INTO employee_reports (employee_id,report_date,entries) VALUES (?,?,?) ON DUPLICATE KEY UPDATE entries=VALUES(entries)',
        [e.id, date, JSON.stringify(entries)]
      );
      res.json({ ok: true, message: 'Daily report saved.' });
    })
  );
  app.get(
    '/api/admin/employees',
    stockAuth,
    wrap(async (req, res) => {
      const p = await pool();
      const [rows] = await p.query(
        'SELECT id,username,name,active,created_at FROM employees ORDER BY name,username'
      );
      res.json({ ok: true, employees: rows });
    })
  );
  app.post(
    '/api/admin/employees',
    stockAuth,
    wrap(async (req, res) => {
      const name = String(req.body?.name || '').trim(),
        username = String(req.body?.username || '')
          .trim()
          .toLowerCase(),
        password = String(req.body?.password || '');
      if (
        !name ||
        name.length > 120 ||
        !/^[a-z0-9._-]{3,40}$/.test(username) ||
        password.length < 8 ||
        password.length > 128
      )
        throw Error(
          'Enter a name, username (3–40 letters/numbers) and password (at least 8 characters).'
        );
      const p = await pool(),
        salt = crypto.randomBytes(16).toString('hex'),
        hash = (await scrypt(password, salt, 64)).toString('hex');
      try {
        await p.query(
          'INSERT INTO employees (id,username,name,salt,password_hash) VALUES (?,?,?,?,?)',
          [crypto.randomUUID(), username, name, salt, hash]
        );
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') throw Error('This username is already in use.');
        throw e;
      }
      res.json({ ok: true, message: 'Employee account created.' });
    })
  );
  app.post(
    '/api/admin/employees/:id',
    stockAuth,
    wrap(async (req, res) => {
      const p = await pool(),
        active = req.body?.active,
        password = String(req.body?.password || '');
      if (typeof active !== 'boolean' && !password) throw Error('Choose an action.');
      if (password && (password.length < 8 || password.length > 128))
        throw Error('Password must contain at least 8 characters.');
      const params = [],
        updates = ['session_version=session_version+1'];
      if (typeof active === 'boolean') {
        updates.push('active=?');
        params.push(active ? 1 : 0);
      }
      if (password) {
        const salt = crypto.randomBytes(16).toString('hex');
        updates.push('salt=?', 'password_hash=?');
        params.push(salt, (await scrypt(password, salt, 64)).toString('hex'));
      }
      params.push(req.params.id);
      const [r] = await p.query(
        'UPDATE employees SET ' + updates.join(',') + ' WHERE id=?',
        params
      );
      if (!r.affectedRows) throw Error('Employee not found.');
      res.json({ ok: true, message: 'Employee account updated.' });
    })
  );
  app.get(
    '/api/admin/employee-progress',
    stockAuth,
    wrap(async (req, res) => {
      const date = dateValue(req.query.date);
      const end = new Date(date + 'T00:00:00Z');
      const week = new Date(end);
      week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
      const weekStart = week.toISOString().slice(0, 10);
      const monthStart = date.slice(0, 8) + '01';
      const from = weekStart < monthStart ? weekStart : monthStart;
      const p = await pool();
      const [rows] = await p.query(
        "SELECT e.name,e.username,DATE_FORMAT(r.report_date,'%Y-%m-%d') AS reportDate,r.entries FROM employee_reports r JOIN employees e ON e.id=r.employee_id WHERE r.report_date BETWEEN ? AND ? ORDER BY r.report_date,e.name,e.username",
        [from, date]
      );
      const reports = rows.map((row) => {
        const counts = { challan: 0, packing: 0, invoice: 0 };
        for (const entry of JSON.parse(row.entries))
          for (const key of Object.keys(counts)) counts[key] += Number(entry[key]) || 0;
        return { date: row.reportDate, name: row.name, username: row.username, counts };
      });
      res.json({ ok: true, date, weekStart, monthStart, reports });
    })
  );
  app.get(
    '/api/admin/employee-reports',
    stockAuth,
    wrap(async (req, res) => {
      const p = await pool(),
        date = dateValue(req.query.date);
      const [rows] = await p.query(
        'SELECT e.name,e.username,r.report_date,r.entries,r.updated_at FROM employee_reports r JOIN employees e ON e.id=r.employee_id WHERE r.report_date=? ORDER BY e.name,e.username',
        [date]
      );
      res.json({ ok: true, reports: rows.map((r) => ({ ...r, entries: JSON.parse(r.entries) })) });
    })
  );
}
module.exports = { register, setup, entriesValue, dateValue, verify };
