const assert = require('assert/strict'),
  crypto = require('crypto');
process.env.SMTP_USER = 'mock@example.com';
process.env.SMTP_PASS = 'mock';
const db = require('../api/db'),
  mailer = require('../node_modules/nodemailer');
const requests = new Map(),
  allocations = new Set(),
  locks = new Map();
let stock = { version: 'v1', items: [{ id: '0', code: '1', available: 100 }] },
  sends = 0;
async function lock(key) {
  const before = locks.get(key) || Promise.resolve();
  let release;
  const after = new Promise((r) => (release = r));
  locks.set(
    key,
    before.then(() => after)
  );
  await before;
  return release;
}
db.getPool = async () => ({
  query: async () => [{}],
  async getConnection() {
    let releases = [],
      undo = [];
    return {
      async beginTransaction() {},
      async commit() {
        undo = [];
        releases
          .splice(0)
          .reverse()
          .forEach((r) => r());
      },
      async rollback() {
        undo.reverse().forEach((f) => f());
        undo = [];
        releases
          .splice(0)
          .reverse()
          .forEach((r) => r());
      },
      release() {
        assert.equal(releases.length, 0);
      },
      async query(sql, args) {
        if (sql.startsWith('INSERT IGNORE')) {
          releases.push(await lock('request:' + args[0]));
          if (!requests.has(args[0])) {
            requests.set(args[0], { payload: args[1], sent: args[2] });
            undo.push(() => requests.delete(args[0]));
          }
          return [{}];
        }
        if (sql.startsWith('SELECT payload,sent')) {
          if (!releases.length) releases.push(await lock('request:' + args[0]));
          return [[structuredClone(requests.get(args[0]))]];
        }
        if (sql.startsWith('SELECT request_id')) return [allocations.has(args[0]) ? [{}] : []];
        if (sql.startsWith('SELECT payload FROM stock_snapshot')) {
          releases.push(await lock('stock'));
          return [[{ payload: JSON.stringify(stock) }]];
        }
        if (sql.startsWith('UPDATE stock_snapshot')) {
          const old = stock;
          undo.push(() => (stock = old));
          stock = JSON.parse(args[0]);
        }
        if (sql.startsWith('INSERT INTO stock_allocations')) {
          allocations.add(args[0]);
          undo.push(() => allocations.delete(args[0]));
        }
        if (sql.startsWith('UPDATE stock_requests')) {
          const row = requests.get(args[1]),
            old = row.sent;
          undo.push(() => (row.sent = old));
          row.sent = args[0];
        }
        return [{}];
      },
    };
  },
});
mailer.createTransport = () => ({
  async sendMail(m) {
    await new Promise((r) => setTimeout(r, 10));
    sends++;
    return { accepted: [m.to] };
  },
});
(async () => {
  const server = require('../api/index').listen(0);
  const submit = (id) =>
    fetch('http://127.0.0.1:' + server.address().port + '/api/stock/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: id,
        storeCode: 'TEST',
        mobile: '9000000000',
        stockVersion: 'v1',
        items: [{ code: '1', quantity: 10, stockIds: ['0'] }],
      }),
    });
  try {
    const r = await Promise.all(Array.from({ length: 20 }, () => submit(crypto.randomUUID())));
    assert.equal(r.filter((x) => x.status === 200).length, 10);
    assert.equal(r.filter((x) => x.status === 409).length, 10);
    assert.equal(stock.items[0].available, 0);
    assert.equal(sends, 30);
    stock.items[0].available = 100;
    sends = 0;
    const id = crypto.randomUUID();
    const duplicates = await Promise.all(Array.from({ length: 10 }, () => submit(id)));
    assert(duplicates.every((x) => x.status === 200));
    assert.equal(stock.items[0].available, 90);
    assert.equal(sends, 3);
    console.log(
      'Concurrent route tests passed with simulated database row locks: 20 competing orders and 10 duplicate submissions. No real emails or stock changes.'
    );
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
