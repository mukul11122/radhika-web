const assert = require('node:assert/strict'),
  express = require('express');
const { deductStock, restoreStock } = require('../lib/stock-allocation');
const { register } = require('../lib/order-admin');
const original = {
  version: 'v1',
  items: [
    { id: '0', code: '1', batch: 'A', expiry: '2028-01-31', uom: '10', available: 10 },
    { id: '1', code: '1', batch: 'B', expiry: '2028-01-31', uom: '10', available: 20 },
  ],
};
const receipt = [];
const reduced = deductStock(
  original,
  [{ code: '1', quantity: 15, stockIds: ['0', '1'] }],
  'v1',
  receipt
);
assert.equal(
  receipt.reduce((s, r) => s + r.quantity, 0),
  15
);
assert.deepEqual(restoreStock(reduced, receipt, 'v1').snapshot.items, original.items);
assert.equal(restoreStock({ ...reduced, version: 'v2' }, receipt, 'v1').returned, false);
let state = {
    snapshot: reduced,
    managed: {
      request_id: 'test',
      status: 'New',
      receipt: JSON.stringify(receipt),
      stock_version: 'v1',
    },
    events: [],
  },
  backup,
  tail = Promise.resolve();
const pool = {
  query: async () => [{}],
  async getConnection() {
    let unlock;
    return {
      async beginTransaction() {
        const prior = tail;
        tail = new Promise((r) => (unlock = r));
        await prior;
        backup = structuredClone(state);
      },
      async commit() {
        backup = null;
        unlock();
      },
      async rollback() {
        if (backup) state = backup;
        backup = null;
        unlock();
      },
      release() {},
      async query(sql, args) {
        if (sql.startsWith('SELECT payload,sent')) return [[{ payload: '{}', sent: '[]' }]];
        if (sql.startsWith('SELECT * FROM order_management'))
          return [[structuredClone(state.managed)]];
        if (sql.startsWith('SELECT payload FROM stock_snapshot'))
          return [[{ payload: JSON.stringify(state.snapshot) }]];
        if (sql.startsWith('UPDATE stock_snapshot')) state.snapshot = JSON.parse(args[0]);
        if (sql.startsWith('UPDATE order_management'))
          Object.assign(state.managed, { status: args[0], returned: args[1], note: args[2] });
        if (sql.startsWith('INSERT INTO order_events')) state.events.push(args);
        return [{}];
      },
    };
  },
};
(async () => {
  const audits = [];
  const app = express();
  app.use(express.json());
  register(app, {
    db: {
      getPool: async () => pool,
      recordAudit: async (connection, actor, details) => audits.push({ actor, details }),
    },
    stockAuth: (req, res, next) =>
      req.headers.authorization === 'Bearer test' ? next() : res.status(401).json({ ok: false }),
  });
  const server = app.listen(0),
    url = 'http://127.0.0.1:' + server.address().port + '/api/admin/orders/test/status';
  const post = (status, note = 'Test cancellation') =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note }),
    });
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal((await post('Cancelled', '')).status, 409);
    assert.equal(state.managed.status, 'New');
    const responses = await Promise.all([post('Cancelled'), post('Cancelled')]);
    assert(responses.every((r) => r.status === 200));
    assert.deepEqual(state.snapshot.items, original.items);
    assert.equal(state.events.length, 1);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].details.returnedQuantity, 15);
    assert.equal(audits[0].details.from, 'New');
    assert.equal(audits[0].details.to, 'Cancelled');
    assert.equal((await post('Accepted')).status, 409);
    state.managed = { ...state.managed, status: 'Dispatched' };
    assert.equal((await post('Cancelled')).status, 409);
    state.managed = { ...state.managed, status: 'New' };
    state.snapshot = { ...original, version: 'v2' };
    const out = await (await post('Cancelled')).json();
    assert.equal(out.returned, false);
    assert.equal(audits[1].details.returnedQuantity, 0);
    assert.deepEqual(state.snapshot.items, original.items);
    state.managed = { ...state.managed, status: 'Accepted' };
    assert.equal((await post('Packed')).status, 409);
    assert.equal((await post('Challan Ready')).status, 200);
    assert.equal(state.managed.status, 'Challan Ready');
    assert.equal((await post('Packed')).status, 200);
    assert.equal((await post('Dispatched')).status, 200);
    assert.equal(state.managed.status, 'Dispatched');
    console.log(
      'Admin authentication, double-cancel race, exact-batch return, new-upload guard and status transitions passed.'
    );
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
