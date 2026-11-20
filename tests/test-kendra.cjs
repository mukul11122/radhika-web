const assert = require('node:assert/strict'),
  express = require('express'),
  crypto = require('crypto');
process.env.STOCK_UPLOAD_PASSWORD = 'test-only-secret';
const {
  register,
  fields,
  pinHash,
  verifyToken,
  signToken,
  forOrder,
  publicProfile,
  profileVersion,
} = require('../lib/kendra');
const { payloadHash } = require('../lib/stock-order');
const profiles = new Map(),
  demands = new Map(),
  limits = new Map(),
  events = [];
const fixture = {
  storeCode: '00123',
  mobile: '9999999999',
  dlForm20: 'DL20/TEST/123',
  dlForm21: 'DL21/TEST/123',
  contactName: 'Test User',
  address: 'Test delivery address',
  city: 'Dehradun',
  state: 'Uttarakhand',
  pincode: '248001',
  gst: '05AAWFR4857N1Z7',
  email: 'test@example.test',
};
const pool = {
  getConnection: async () => ({
    query: pool.query,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release() {},
  }),
  query: async (sql, args = []) => {
    if (sql.startsWith('CREATE TABLE')) return [{}];
    if (sql.startsWith('SELECT revoked_before FROM kendra_pin_recovery')) return [[]];
    if (sql.startsWith('INSERT INTO kendra_login_limits')) {
      if (!limits.has(args[0])) limits.set(args[0], 0);
      return [{}];
    }
    if (sql.startsWith('UPDATE kendra_login_limits')) {
      limits.set(args[0], limits.get(args[0]) + 1);
      return [{}];
    }
    if (sql.startsWith('SELECT attempts')) return [[{ attempts: limits.get(args[0]) }]];
    if (sql.startsWith('DELETE FROM kendra_login_limits')) {
      limits.delete(args[0]);
      return [{}];
    }
    if (sql.startsWith('INSERT INTO kendra_profiles')) {
      if (profiles.has(args[0])) {
        const e = Error('duplicate');
        e.code = 'ER_DUP_ENTRY';
        throw e;
      }
      profiles.set(args[0], {
        store_key: args[0],
        store_code: args[1],
        mobile: args[2],
        pin_salt: args[3],
        pin_hash: args[4],
        profile: args[5],
        updated_at: new Date('2026-11-15'),
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO kendra_profile_events')) {
      events.push(args);
      return [{}];
    }
    if (sql.startsWith('SELECT store_code FROM kendra_profiles WHERE store_key='))
      return [profiles.has(args[0]) ? [{ store_code: profiles.get(args[0]).store_code }] : []];
    if (sql.startsWith('SELECT COUNT(*) AS total FROM kendra_profiles'))
      return [[{ total: profiles.size }]];
    if (sql.startsWith('SELECT store_code,mobile,profile,updated_at FROM kendra_profiles'))
      return [[...profiles.values()]];
    if (sql.startsWith('SELECT * FROM kendra_profiles WHERE mobile='))
      return [[...profiles.values()].filter((row) => row.mobile === args[0]).slice(0, 2)];
    if (sql.startsWith('SELECT * FROM kendra_profiles'))
      return [[...profiles.values()].filter((row) => row.store_key === args[0])];
    if (sql.startsWith('UPDATE kendra_profiles SET store_key=')) {
      const row = profiles.get(args[3]);
      profiles.delete(args[3]);
      Object.assign(row, { store_key: args[0], store_code: args[1], profile: args[2] });
      profiles.set(args[0], row);
      return [{ affectedRows: 1 }];
    }
    if (
      sql.startsWith('UPDATE medicine_demands SET store_key=') ||
      sql.startsWith('UPDATE kendra_profile_events SET store_key=') ||
      sql.startsWith('DELETE FROM kendra_pin_recovery') ||
      sql.startsWith('INSERT INTO kendra_pin_recovery')
    )
      return [{}];
    if (sql.startsWith('UPDATE kendra_profiles')) {
      const row = profiles.get(args[2]);
      if (row) {
        row.mobile = args[0];
        row.profile = args[1];
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (sql.startsWith('SELECT payload FROM stock_snapshot'))
      return [
        [
          {
            payload: JSON.stringify({
              items: [
                { code: 'IN', available: 5 },
                { code: 'OUT', available: 0 },
              ],
            }),
          },
        ],
      ];
    if (sql.startsWith('SELECT store_key,request_hash'))
      return [demands.has(args[0]) ? [demands.get(args[0])] : []];
    if (sql.startsWith('SELECT COUNT(*) AS total FROM medicine_demands WHERE store_key='))
      return [[{ total: [...demands.values()].filter((d) => d.store_key === args[0]).length }]];
    if (sql.startsWith('INSERT INTO medicine_demands')) {
      demands.set(args[0], {
        id: args[0],
        store_key: args[1],
        code: args[2],
        medicine: args[3],
        quantity: args[4],
        note: args[5],
        request_hash: args[6],
        status: 'New',
        created_at: new Date(),
      });
      return [{}];
    }
    if (sql.startsWith('INSERT INTO demand_events')) {
      events.push(args);
      return [{}];
    }
    if (sql.startsWith('SELECT id,code,medicine,quantity'))
      return [[...demands.values()].filter((d) => d.store_key === args[0])];
    if (sql.startsWith('SELECT status,admin_note FROM medicine_demands'))
      return [demands.has(args[0]) ? [{ status: demands.get(args[0]).status }] : []];
    if (sql.startsWith('UPDATE medicine_demands')) {
      demands.get(args[2]).status = args[0];
      demands.get(args[2]).admin_note = args[1];
      return [{}];
    }
    throw Error('Unexpected SQL: ' + sql);
  },
};
(async () => {
  assert.throws(() => fields({ ...fixture, gst: 'bad' }), /GSTIN/);
  assert.throws(() => fields({ ...fixture, email: '' }), /Email is required/);
  assert.equal(
    fields({ ...fixture, address: '', state: '', dlForm20: '', dlForm21: '', gst: '' }).email,
    fixture.email
  );
  for (const field of ['storeCode', 'mobile', 'contactName', 'city', 'pincode'])
    assert.throws(() => fields({ ...fixture, [field]: '' }));
  const salt = 'abc',
    hash = await pinHash('123456', salt);
  assert.notEqual(hash, '123456');
  assert.equal(hash, await pinHash('123456', salt));
  assert.throws(() => verifyToken(signToken('123', 'other'), 'test-only-secret'));
  assert.throws(
    () => verifyToken(signToken('123', 'test-only-secret', 0), 'test-only-secret', 8 * 86400000),
    /expired/
  );
  const app = express();
  app.use(express.json());
  register(app, {
    db: { getPool: async () => pool },
    stockAuth: (req, res, next) =>
      req.headers.authorization === 'Bearer admin' ? next() : res.status(401).json({ ok: false }),
  });
  const server = app.listen(0),
    base = 'http://localhost:' + server.address().port;
  const request = async (path, body, token, method) => {
    const response = await fetch(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await request('/api/kendra/profile?storeCode=123')).status, 401);
    assert.equal(
      (await request('/api/kendra/register', { ...fixture, storeCode: 'ABC123', pin: '123456' }))
        .status,
      400
    );
    const first = await request('/api/kendra/register', { ...fixture, pin: '123456' });
    assert.equal(first.status, 200);
    assert(!('pin_hash' in first.data.profile));
    const token = first.data.token;
    for (const code of ['123', '00123']) {
      assert.equal(
        (await request('/api/kendra/store-code-check?storeCode=' + code)).data.available,
        false
      );
      assert.equal(
        (await request('/api/kendra/register', { ...fixture, storeCode: code, pin: '123456' }))
          .status,
        409
      );
    }
    assert.equal(
      (await request('/api/kendra/store-code-check?storeCode=789')).data.available,
      true
    );
    assert.equal(
      (await request('/api/kendra/login', { storeCode: '123', pin: '123456' })).status,
      200
    );
    const mobileOnly = await request('/api/kendra/login', {
      mobile: fixture.mobile,
      pin: '123456',
    });
    assert.equal(mobileOnly.status, 200);
    assert.equal(verifyToken(mobileOnly.data.token, 'test-only-secret'), '123');
    assert.equal((await request('/api/kendra/login', { pin: '123456' })).status, 400);
    assert.equal(
      (
        await request('/api/kendra/login', {
          storeCode: '123',
          mobile: '1111111111',
          pin: '123456',
        })
      ).status,
      401
    );
    assert.equal(
      (await request('/api/kendra/register', { ...fixture, pin: '654321' })).status,
      409
    );
    assert.equal(
      (
        await request('/api/kendra/login', {
          storeCode: '123',
          mobile: fixture.mobile,
          pin: '654321',
        })
      ).status,
      401
    );
    assert.equal(
      (
        await request('/api/kendra/login', {
          storeCode: '123',
          mobile: fixture.mobile,
          pin: '123456',
        })
      ).status,
      200
    );
    assert.equal(
      (await request('/api/kendra/profile', null, token)).data.profile.address,
      fixture.address
    );
    assert.equal(
      (await request('/api/kendra/profile', { ...fixture, storeCode: 'other' }, token, 'PUT'))
        .status,
      400
    );
    const second = await request('/api/kendra/register', {
      ...fixture,
      storeCode: '456',
      pin: '456789',
    });
    assert.equal(
      (await request('/api/kendra/login', { mobile: fixture.mobile, pin: '123456' })).status,
      400
    );
    const demand = {
      requestId: crypto.randomUUID(),
      code: 'OUT',
      medicine: 'Unavailable test medicine',
      quantity: 3,
    };
    assert.equal((await request('/api/kendra/demands', demand)).status, 401);
    assert.equal((await request('/api/kendra/demands', demand, token)).status, 200);
    assert.equal((await request('/api/kendra/demands', demand, token)).status, 200);
    assert.equal(demands.size, 1);
    assert.equal(
      (await request('/api/kendra/demands', { ...demand, quantity: 4 }, token)).status,
      400
    );
    assert.equal(
      (
        await request(
          '/api/kendra/demands',
          { ...demand, requestId: crypto.randomUUID(), code: 'IN' },
          token
        )
      ).status,
      400
    );
    assert.equal((await request('/api/kendra/demands', null, second.data.token)).data.total, 0);
    assert.equal((await request('/api/kendra/demands', null, token)).data.demands.length, 1);
    assert.equal(
      (
        await request(
          '/api/admin/demands/' + demand.requestId + '/status',
          { status: 'Reviewing', note: 'Checking availability' },
          'admin'
        )
      ).status,
      200
    );
    assert.equal(events.at(-1)[1], 'Reviewing');
    const delivery = await forOrder({ getPool: async () => pool }, token, '123', fixture.mobile);
    assert.equal(delivery.gst, fixture.gst);
    assert.equal(delivery.dlForm20, fixture.dlForm20);
    assert.equal(delivery.dlForm21, fixture.dlForm21);
    assert(!Object.hasOwn(fields(fixture), 'kendraName'));
    const ExcelJS = require('exceljs'),
      { workbook } = require('../js/order-excel');
    const exported = workbook(ExcelJS, {
      items: [{ code: 'OUT', quantity: 1 }],
      contactProfile: delivery,
    });
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await exported.xlsx.writeBuffer());
    assert.equal(reopened.getWorksheet('Kendra delivery').getCell('B4').value, fixture.address);
    await assert.rejects(forOrder({ getPool: async () => pool }, token, 'other', fixture.mobile));
    const item = {
      items: [{ code: 'x', quantity: 1 }],
      storeCode: '123',
      mobile: fixture.mobile,
      contactProfile: delivery,
    };
    assert.equal(
      payloadHash(item),
      payloadHash({ ...item, contactProfile: { ...delivery, address: 'Changed' } })
    );
    assert(!JSON.stringify(publicProfile(profiles.get('123'))).includes(hash));
    const original = { ...profiles.get('123') };
    const edit = {
      ...fixture,
      mobile: '8888888888',
      address: 'Updated delivery address',
      editVersion: profileVersion(original),
    };
    assert.equal((await request('/api/admin/kendras/123', edit, null, 'PUT')).status, 401);
    assert.equal((await request('/api/admin/kendras/123', edit, token, 'PUT')).status, 401);
    const list = await request('/api/admin/kendras', null, 'admin');
    assert.equal(list.data.profiles[0].editVersion, edit.editVersion);
    assert(!JSON.stringify(list.data).includes(original.pin_hash));
    assert.equal(
      (await request('/api/admin/kendras/123', { ...edit, mobile: 'bad' }, 'admin', 'PUT')).status,
      400
    );
    assert.equal(
      (await request('/api/admin/kendras/123', { ...edit, storeCode: '456' }, 'admin', 'PUT'))
        .status,
      400
    );
    assert.equal((await request('/api/admin/kendras/123', edit, 'admin', 'PUT')).status, 200);
    assert.equal((await request('/api/admin/kendras/123', edit, 'admin', 'PUT')).status, 409);
    assert.equal(profiles.get('123').pin_hash, original.pin_hash);
    assert.equal(profiles.get('123').pin_salt, original.pin_salt);
    assert.equal(
      (await request('/api/kendra/profile', null, token)).data.profile.address,
      edit.address
    );
    assert.equal(events.at(-1)[1], 'Admin');
    const correction = {
      ...edit,
      storeCode: '789',
      address: 'Updated with Store Code',
      editVersion: profileVersion(profiles.get('123')),
    };
    assert.equal((await request('/api/admin/kendras/123/store-code', correction)).status, 401);
    assert.equal(
      (
        await request(
          '/api/admin/kendras/123/store-code',
          { ...correction, storeCode: '456' },
          'admin'
        )
      ).status,
      400
    );
    assert.equal(
      (
        await request(
          '/api/admin/kendras/123/store-code',
          { ...correction, editVersion: 'old' },
          'admin'
        )
      ).status,
      400
    );
    assert.equal(
      (await request('/api/admin/kendras/123/store-code', correction, 'admin')).status,
      200
    );
    assert(!profiles.has('123'));
    assert.equal(profiles.get('789').pin_hash, original.pin_hash);
    assert.equal(JSON.parse(profiles.get('789').profile).address, 'Updated with Store Code');
    assert.equal(
      (await request('/api/kendra/login', { storeCode: '789', pin: '123456' })).status,
      200
    );
    console.log(
      'Profile PIN/auth/ownership, private fields, GST, demand idempotency, in-stock rejection, status and delivery snapshot checks passed.'
    );
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
