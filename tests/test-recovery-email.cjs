const assert = require('assert/strict'),
  express = require('express');
process.env.STOCK_UPLOAD_PASSWORD = 'test-only';
const k = require('../lib/kendra'),
  recovery = require('../lib/pin-recovery'),
  delivery = require('../lib/email-delivery'),
  { RECIPIENTS } = require('../lib/stock-order');
(async () => {
  const profiles = new Map([
      [
        '123',
        {
          store_key: '123',
          store_code: '123',
          mobile: '9999999999',
          profile: JSON.stringify({ email: 'saved@example.test' }),
          pin_salt: 'old',
          pin_hash: await k.pinHash('111111', 'old'),
        },
      ],
    ]),
    resets = new Map(),
    rates = new Map(),
    attempts = [];
  let sent = [RECIPIENTS[0]],
    cancelled = false,
    fail = false;
  const mail = [];
  const pool = {
    getConnection: async () => ({
      query: pool.query,
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release() {},
    }),
    query: async (sql, a = []) => {
      if (sql.startsWith('CREATE TABLE')) return [{}];
      if (sql.startsWith('INSERT INTO kendra_login_limits')) {
        if (!rates.has(a[0])) rates.set(a[0], 0);
        return [{}];
      }
      if (sql.startsWith('UPDATE kendra_login_limits')) {
        rates.set(a[0], rates.get(a[0]) + 1);
        return [{}];
      }
      if (sql.startsWith('SELECT attempts')) return [[{ attempts: rates.get(a[0]) }]];
      if (sql.startsWith('SELECT * FROM kendra_profiles'))
        return [profiles.has(a[0]) ? [profiles.get(a[0])] : []];
      if (
        sql.startsWith('SELECT * FROM kendra_pin_recovery') ||
        sql.startsWith('SELECT revoked_before')
      )
        return [resets.has(a[0]) ? [resets.get(a[0])] : []];
      if (sql.startsWith('INSERT INTO kendra_pin_recovery')) {
        resets.set(a[0], {
          code_hash: a[1],
          expires_at: new Date(Date.now() + 600000),
          requested_at: new Date(),
          attempts: 0,
          revoked_before: 0,
        });
        return [{}];
      }
      if (sql.startsWith('UPDATE kendra_pin_recovery SET attempts')) {
        resets.get(a[0]).attempts++;
        return [{}];
      }
      if (sql.startsWith('UPDATE kendra_pin_recovery SET code_hash')) {
        Object.assign(resets.get(a[1]), { code_hash: null, revoked_before: a[0] });
        return [{}];
      }
      if (sql.startsWith('UPDATE kendra_profiles SET pin_salt')) {
        Object.assign(profiles.get(a[2]), { pin_salt: a[0], pin_hash: a[1] });
        return [{}];
      }
      if (sql.startsWith('SELECT payload,sent'))
        return [
          [
            {
              payload: JSON.stringify({
                items: [{ code: '1', quantity: 2 }],
                storeCode: '123',
                mobile: '9999999999',
              }),
              sent: JSON.stringify(sent),
            },
          ],
        ];
      if (sql.startsWith('SELECT status')) return [[{ status: cancelled ? 'Cancelled' : 'New' }]];
      if (sql.startsWith('UPDATE stock_requests SET sent')) {
        sent = JSON.parse(a[0]);
        return [{}];
      }
      if (sql.startsWith('INSERT INTO order_email_attempts')) {
        attempts.push(a);
        return [{}];
      }
      throw Error('Unexpected SQL ' + sql);
    },
  };
  const app = express();
  app.use(express.json());
  const transport = () => ({
    sendMail: async (m) => {
      if (fail)
        throw Object.assign(Error('SMTP unavailable'), { code: 'EAUTH', responseCode: 535 });
      mail.push(m);
      return { accepted: [m.to] };
    },
  });
  recovery.register(app, {
    db: { getPool: async () => pool },
    transport,
    from: 'test@example.test',
  });
  delivery.register(app, {
    db: { getPool: async () => pool },
    transport,
    from: 'test@example.test',
    stockAuth: (req, res, next) =>
      req.headers.authorization === 'Bearer admin' ? next() : res.status(401).json({ ok: false }),
  });
  const server = app.listen(0),
    base = 'http://localhost:' + server.address().port;
  async function request(path, body, admin = false) {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(admin ? { Authorization: 'Bearer admin' } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  }
  try {
    const oldToken = k.signToken('123', 'test-only', Date.now() - 1000);
    assert.equal((await request('/api/kendra/forgot-pin', { storeCode: '123' })).status, 200);
    assert.equal(mail[0].to, 'saved@example.test');
    const code = mail[0].text.match(/\b\d{6}\b/)[0];
    assert(!resets.get('123').code_hash.includes(code));
    assert.equal((await request('/api/kendra/forgot-pin', { storeCode: '123' })).status, 400);
    assert.equal(
      (await request('/api/kendra/reset-pin', { storeCode: '123', code: '000000', pin: '222222' }))
        .status,
      400
    );
    assert.equal(resets.get('123').attempts, 1);
    assert.equal(
      (await request('/api/kendra/reset-pin', { storeCode: '123', code, pin: '222222' })).status,
      200
    );
    assert.equal(
      profiles.get('123').pin_hash,
      await k.pinHash('222222', profiles.get('123').pin_salt)
    );
    await assert.rejects(recovery.checkSession(pool, '123', oldToken), /PIN changed/);
    assert.equal(
      (await request('/api/kendra/reset-pin', { storeCode: '123', code, pin: '333333' })).status,
      400
    );
    mail.length = 0;
    assert.equal((await request('/api/admin/orders/test/retry-email', {})).status, 401);
    fail = true;
    await request('/api/admin/orders/test/retry-email', {}, true);
    assert(attempts.at(-1)[1].includes('535'));
    assert.equal(sent.length, 1);
    fail = false;
    await request('/api/admin/orders/test/retry-email', {}, true);
    assert.equal(mail.length, 2);
    assert(!mail.some((m) => m.to === RECIPIENTS[0]));
    await request('/api/admin/orders/test/retry-email', {}, true);
    assert.equal(mail.length, 2);
    cancelled = true;
    assert.equal((await request('/api/admin/orders/test/retry-email', {}, true)).status, 400);
    console.log(
      'Recovery email destination, hashed one-time code, cooldown, wrong code, PIN reset, session revocation; admin-only retry, partial delivery and cancellation passed. No real emails sent.'
    );
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
