const assert = require('node:assert/strict'),
  express = require('express');
process.env.STOCK_UPLOAD_PASSWORD = 'test-employee-secret';
const { register } = require('../lib/employees');
const employees = new Map(),
  reports = new Map(),
  limits = new Map();
const pool = {
  async query(sql, a = []) {
    if (sql.startsWith('CREATE TABLE')) return [{}];
    if (sql.startsWith('INSERT INTO employees')) {
      if ([...employees.values()].some((e) => e.username === a[1]))
        throw Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      employees.set(a[0], {
        id: a[0],
        username: a[1],
        name: a[2],
        salt: a[3],
        password_hash: a[4],
        active: 1,
        session_version: 1,
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT id,username,name,active,created_at'))
      return [[...employees.values()]];
    if (sql.startsWith('INSERT INTO employee_login_limits')) {
      limits.set(a[0], (limits.get(a[0]) || 0) + 1);
      return [{}];
    }
    if (sql.startsWith('SELECT attempts FROM employee_login_limits'))
      return [[{ attempts: limits.get(a[0]) }]];
    if (sql.startsWith('DELETE FROM employee_login_limits')) {
      limits.delete(a[0]);
      return [{}];
    }
    if (sql.startsWith('SELECT * FROM employees WHERE username'))
      return [[...[...employees.values()].filter((e) => e.username === a[0])]];
    if (sql.startsWith('SELECT id,username,name,active,session_version'))
      return [employees.has(a[0]) ? [employees.get(a[0])] : []];
    if (sql.startsWith('INSERT INTO employee_reports')) {
      reports.set(a[0] + '|' + a[1], a[2]);
      return [{}];
    }
    if (sql.startsWith('SELECT entries,updated_at FROM employee_reports')) {
      const v = reports.get(a[0] + '|' + a[1]);
      return [v ? [{ entries: v }] : []];
    }
    if (sql.includes('DATE_FORMAT(r.report_date'))
      return [
        [...reports.entries()]
          .filter(([key]) => {
            const date = key.split('|')[1];
            return date >= a[0] && date <= a[1];
          })
          .map(([key, entries]) => {
            const [id, reportDate] = key.split('|');
            const e = employees.get(id);
            return { name: e.name, username: e.username, reportDate, entries };
          }),
      ];
    if (sql.startsWith('SELECT e.name,e.username'))
      return [
        [...reports.entries()]
          .filter(([key]) => key.endsWith('|' + a[0]))
          .map(([key, entries]) => {
            const e = employees.get(key.split('|')[0]);
            return { name: e.name, username: e.username, entries };
          }),
      ];
    if (sql.startsWith('UPDATE employees SET')) {
      const e = employees.get(a.at(-1));
      if (!e) return [{ affectedRows: 0 }];
      if (sql.includes('active=?')) e.active = a[0];
      e.session_version++;
      return [{ affectedRows: 1 }];
    }
    throw Error('Unexpected test query: ' + sql);
  },
};
(async () => {
  const app = express();
  app.use(express.json());
  register(app, {
    db: { getPool: async () => pool },
    stockAuth: (req, res, next) =>
      req.headers.authorization === 'Bearer admin' ? next() : res.status(401).json({ ok: false }),
  });
  const server = app.listen(0),
    base = 'http://127.0.0.1:' + server.address().port;
  async function req(path, body, token) {
    let r = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  }
  try {
    let create = { name: 'Test Employee', username: 'employee1', password: 'testpassword' };
    assert.equal((await req('/api/admin/employees', create)).status, 401);
    assert.equal((await req('/api/admin/employees', create, 'admin')).status, 200);
    assert.notEqual([...employees.values()][0].password_hash, create.password);
    assert.equal(
      (await req('/api/employee/login', { username: create.username, password: 'wrong' })).status,
      401
    );
    let login = await req('/api/employee/login', {
      username: create.username,
      password: create.password,
    });
    assert.equal(login.status, 200);
    let date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    let rows = [{ storeCode: '02533', challan: 2, packing: 3, invoice: 1 }];
    assert.equal((await req('/api/employee/report', { date, entries: rows }, 'admin')).status, 400);
    assert.equal(
      (await req('/api/employee/report', { date, entries: rows }, login.token)).status,
      200
    );
    assert.deepEqual(
      (await req('/api/employee/report?date=' + date, null, login.token)).entries,
      rows
    );
    assert.equal(
      (await req('/api/admin/employee-reports?date=' + date, null, login.token)).status,
      401
    );
    assert.deepEqual(
      (await req('/api/admin/employee-reports?date=' + date, null, 'admin')).reports[0].entries,
      rows
    );
    assert.equal(
      (await req('/api/admin/employee-progress?date=' + date, null, login.token)).status,
      401
    );
    const progress = await req('/api/admin/employee-progress?date=' + date, null, 'admin');
    assert.deepEqual(progress.reports[0].counts, { challan: 2, packing: 3, invoice: 1 });
    assert.equal(progress.reports[0].date, date);
    const boundary = await req('/api/admin/employee-progress?date=2026-03-01', null, 'admin');
    assert.equal(boundary.weekStart, '2026-02-23');
    assert.equal(boundary.monthStart, '2026-03-01');
    assert.equal(
      (
        await req(
          '/api/employee/report',
          { date, entries: [{ ...rows[0], packing: -1 }] },
          login.token
        )
      ).status,
      400
    );
    await req('/api/admin/employees/' + [...employees.keys()][0], { active: false }, 'admin');
    assert.equal((await req('/api/employee/report?date=' + date, null, login.token)).status, 400);
    console.log('Employee account security, report storage, admin access and revocation passed.');
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
