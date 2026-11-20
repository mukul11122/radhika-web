const assert = require('node:assert/strict'),
  express = require('express');
const { stockAlerts, dashboard, register, expiryDate } = require('../lib/order-insights');
const { repeat } = require('../js/stock-order-import'),
  { compare } = require('../js/stock-grouping');
const stock = [
  {
    id: 'a',
    code: '1',
    name: 'Medicine A',
    batch: 'A',
    available: 5,
    expiry: '15/11/2026',
    salesRate: 10,
  },
  {
    id: 'b',
    code: '1',
    name: 'Medicine A',
    batch: 'B',
    available: 10,
    expiry: '13/02/2027',
    salesRate: 12,
  },
  { id: 'c', code: '2', name: 'Medicine B', available: 0, expiry: '2026-11-01' },
  { id: 'd', code: '3', name: 'Medicine C', available: 2, expiry: '14/11/2026', salesRate: 5 },
];
const alerts = stockAlerts(stock, { today: '2026-11-15', days: 90, low: 10 });
assert.equal(alerts.lowStock.length, 2);
assert.deepEqual(
  alerts.expiring.map((r) => r.days),
  [0, 90]
);
assert.equal(alerts.expired.length, 1);
assert.equal(expiryDate('31/02/2027'), null);
assert.equal(expiryDate('29/02/2028'), '2028-02-29');
const order = { storeCode: '2551', mobile: '9000000000', items: [{ code: '1', quantity: 4 }] },
  id = '11111111-1111-4111-8111-111111111111';
const rows = [
  {
    id,
    payload: JSON.stringify(order),
    created_at: '2026-11-14T19:00:00Z',
    status: 'New',
    receipt: JSON.stringify([{ code: '1', name: 'Saved name', quantity: 4, salesRate: 8 }]),
    note: 'PRIVATE ADMIN NOTE',
  },
];
const summary = dashboard(
  [...rows, { ...rows[0], status: 'Cancelled' }],
  stock,
  new Date('2026-11-15T10:00:00Z')
);
assert.equal(summary.todayOrders, 2);
assert.equal(summary.pendingDispatch, 1);
assert.equal(summary.estimatedValue, 32);
assert.equal(summary.topMedicines[0].quantity, 4);
const legacySummary = dashboard(
  [
    {
      payload: JSON.stringify([{ code: '1', quantity: 2 }]),
      created_at: '2026-11-15T01:00:00Z',
      status: 'New',
    },
  ],
  stock,
  new Date('2026-11-15T10:00:00Z')
);
assert.equal(legacySummary.estimatedValue, 24);
assert.equal(legacySummary.topMedicines[0].quantity, 2);
const repeated = repeat(
  [
    { code: '1', quantity: 30 },
    { code: '9', quantity: 2 },
  ],
  stock,
  compare
);
assert.deepEqual(repeated.quantities, { a: 5, b: 10 });
assert.equal(repeated.warnings.length, 2);
const pool = {
  async query(sql, args) {
    if (sql.startsWith('SELECT r.id')) {
      let i = 0;
      const matchStore = !sql.includes('$.storeCode') || args[i++] === order.storeCode;
      const matchMobile = !sql.includes('$.mobile') || args[i++] === order.mobile;
      const matchId = !sql.includes('AND r.id=?') || args[i++] === id;
      return [matchStore && matchMobile && matchId ? rows : []];
    }
    return [{}];
  },
};
(async () => {
  const app = express();
  app.use(express.json());
  register(app, {
    db: { getPool: async () => pool, getStock: async () => ({ items: stock }) },
    stockAuth: (req, res, next) => res.status(401).json({ ok: false }),
  });
  const server = app.listen(0),
    base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    const own = await (
      await post('/api/orders/history', { storeCode: order.storeCode, mobile: order.mobile })
    ).json();
    assert.equal(own.orders.length, 1);
    assert.equal(own.orders[0].items[0].name, 'Saved name');
    assert(!JSON.stringify(own).includes('PRIVATE ADMIN NOTE'));
    assert(!JSON.stringify(own).includes(order.mobile));
    for (const lookup of [{ storeCode: order.storeCode }, { mobile: order.mobile }]) {
      const out = await (await post('/api/orders/history', lookup)).json();
      assert.equal(out.orders.length, 1);
      const repeated = await (await post('/api/orders/repeat', { ...lookup, id })).json();
      assert(repeated.ok);
      assert.equal(repeated.storeCode, order.storeCode);
    }
    assert.equal((await post('/api/orders/history', {})).status, 400);
    assert.equal((await post('/api/orders/history', { mobile: '123' })).status, 400);
    const wrong = await (
      await post('/api/orders/history', { storeCode: order.storeCode, mobile: '9000000001' })
    ).json();
    assert.equal(wrong.orders.length, 0);
    assert.equal(
      (await post('/api/orders/repeat', { storeCode: order.storeCode, mobile: '9000000001', id }))
        .status,
      404
    );
    assert.equal((await fetch(base + '/api/admin/dashboard')).status, 401);
    assert.equal((await fetch(base + '/api/admin/stock-alerts')).status, 401);
    console.log(
      'History contact matching, private-field exclusion, repeat stock limits, IST dashboard totals and expiry boundaries passed.'
    );
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
