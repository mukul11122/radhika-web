const assert = require('assert/strict'),
  crypto = require('crypto');
process.env.SMTP_USER = 'test@example.com';
process.env.SMTP_PASS = 'test-only';
const { deductStock } = require('../lib/stock-allocation');
const initial = {
  version: 'upload-1',
  items: [
    { id: '0', code: '1', expiry: '31/01/2028', available: 30 },
    { id: '1', code: '1', expiry: '31/05/2028', available: 75 },
  ],
};
assert.equal(
  deductStock(initial, [{ code: '1', quantity: 10, stockIds: ['1'] }], 'upload-1').items[1]
    .available,
  65
);
assert.equal(initial.items[1].available, 75);
assert.throws(() =>
  deductStock(initial, [{ code: '1', quantity: 31, stockIds: ['0'] }], 'upload-1')
);
assert.throws(() =>
  deductStock(initial, [{ code: '1', quantity: 1, stockIds: ['0'] }], 'old-upload')
);
const db = require('../api/db'),
  mailer = require('../node_modules/nodemailer');
let state = { snapshot: initial, requests: {}, allocations: [] },
  backup,
  sends = 0,
  fail = false;
const connection = {
  async beginTransaction() {
    backup = structuredClone(state);
  },
  async commit() {
    backup = null;
  },
  async rollback() {
    if (backup) state = backup;
    backup = null;
  },
  release() {},
  async query(sql, args) {
    if (sql.startsWith('INSERT IGNORE')) {
      state.requests[args[0]] ??= { payload: args[1], sent: args[2] };
      return [{}];
    }
    if (sql.startsWith('SELECT payload,sent')) return [[state.requests[args[0]]]];
    if (sql.startsWith('SELECT request_id'))
      return [state.allocations.includes(args[0]) ? [{ request_id: args[0] }] : []];
    if (sql.startsWith('SELECT payload FROM stock_snapshot'))
      return [[{ payload: JSON.stringify(state.snapshot) }]];
    if (sql.startsWith('UPDATE stock_snapshot')) state.snapshot = JSON.parse(args[0]);
    if (sql.startsWith('INSERT INTO stock_allocations')) state.allocations.push(args[0]);
    if (sql.startsWith('UPDATE stock_requests')) state.requests[args[1]].sent = args[0];
    return [{}];
  },
};
db.getPool = async () => ({ query: async () => [{}], getConnection: async () => connection });
mailer.createTransport = () => ({
  async sendMail(m) {
    if (fail) throw Error('mock failure');
    sends++;
    return { accepted: [m.to] };
  },
});
(async () => {
  const server = require('../api/index').listen(0);
  const url = 'http://127.0.0.1:' + server.address().port + '/api/stock/submit';
  const submit = (id, quantity = 10) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: id,
        storeCode: '2551',
        mobile: '9000000000',
        stockVersion: 'upload-1',
        items: [{ code: '1', quantity, stockIds: ['0'] }],
        unavailableItems: [
          { code: '99', quantity: 20, requestedQuantity: 20, availableQuantity: 0 },
        ],
      }),
    });
  try {
    const id = crypto.randomUUID();
    assert.equal((await submit(id)).status, 200);
    assert.deepEqual(JSON.parse(state.requests[id].payload).unavailableItems, [
      { code: '99', quantity: 20, requestedQuantity: 20, availableQuantity: 0 },
    ]);
    assert.equal(state.snapshot.items[0].available, 20);
    assert.equal((await submit(id)).status, 200);
    assert.equal(state.snapshot.items[0].available, 20);
    assert.equal(sends, 3);
    assert.equal((await submit(crypto.randomUUID(), 21)).status, 409);
    assert.equal(state.snapshot.items[0].available, 20);
    const pending = crypto.randomUUID();
    fail = true;
    assert.equal((await submit(pending)).status, 503);
    assert.equal(state.snapshot.items[0].available, 10);
    fail = false;
    assert.equal((await submit(pending)).status, 200);
    assert.equal(state.snapshot.items[0].available, 10);
    console.log(
      'Selected batch deduction, insufficient stock, upload version, duplicate and email retry checks passed. No real emails sent.'
    );
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
