const assert = require('assert/strict'),
  express = require('express');
const { register, remove } = require('../lib/stock-management');
const { restoreStock } = require('../lib/stock-allocation');
const original = {
  version: 'v1',
  items: [
    { id: 'a', code: '1', name: 'A', batch: 'A', expiry: '2028', uom: '10', available: 5 },
    { id: 'b', code: '2', name: 'B', batch: 'B', available: 8 },
  ],
};
const result = remove(original, ['a'], 'v1');
assert.equal(original.items.length, 2);
assert.equal(result.snapshot.items.length, 1);
assert.throws(() => remove(original, ['a'], 'old'), /changed/);
assert.throws(() => remove(original, ['missing'], 'v1'));
assert.throws(() => remove(original, ['a', 'a'], 'v1'));
const restored = restoreStock(
  result.snapshot,
  [{ stockId: 'a', code: '1', batch: 'A', expiry: '2028', uom: '10', quantity: 2 }],
  'v1'
);
assert.equal(restored.snapshot.items.length, 1);
assert(restored.note.includes('not restored'));
(async () => {
  let snapshot = structuredClone(original),
    saved,
    audits = 0,
    syncs = 0;
  const c = {
    beginTransaction: async () => {
      saved = structuredClone(snapshot);
    },
    commit: async () => {},
    rollback: async () => {
      snapshot = saved;
    },
    release() {},
    query: async (sql, args) => {
      if (sql.startsWith('SELECT payload')) return [[{ payload: JSON.stringify(snapshot) }]];
      if (sql.startsWith('UPDATE stock_snapshot')) snapshot = JSON.parse(args[0]);
      if (sql.startsWith('INSERT INTO stock_removals')) audits++;
      return [{}];
    },
  };
  const app = express();
  app.use(express.json());
  register(app, {
    stockAuth: (req, res, next) =>
      req.headers.authorization === 'test' ? next() : res.status(401).json({ ok: false }),
    db: {
      getStock: async () => snapshot,
      getPool: async () => ({ query: async () => [{}], getConnection: async () => c }),
      syncStockRows: async () => {
        syncs++;
      },
    },
  });
  const server = app.listen(0),
    base = 'http://localhost:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/api/admin/stock-records')).status, 401);
    const post = (revision) =>
      fetch(base + '/api/admin/stock-records/remove', {
        method: 'POST',
        headers: { authorization: 'test', 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ['a'], revision }),
      });
    assert.equal((await post('old')).status, 409);
    assert.equal(snapshot.items.length, 2);
    assert.equal((await post('v1')).status, 200);
    assert.equal(audits, 1);
    assert.equal(syncs, 1);
    assert.equal(snapshot.items[0].id, 'b');
    assert.equal((await post('v1')).status, 409);
    const pricePost = (prices, auth = 'test') =>
      fetch(base + '/api/admin/stock/update-prices', {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify({ prices }),
      });
    assert.equal((await pricePost({ '2': { mrp: 1, salesRate: 1 } }, 'wrong')).status, 401);
    assert.equal((await pricePost(null)).status, 400);
    assert.equal((await pricePost({})).status, 400);
    assert.equal((await pricePost({ '2': { mrp: -1, salesRate: 5 } })).status, 400);
    assert.equal((await pricePost({ '2': { mrp: 'x', salesRate: 5 } })).status, 400);
    const priceRevision = snapshot.revision;
    let priced = await (await pricePost({ '2': { mrp: 12.5, salesRate: 10 } })).json();
    assert.equal(priced.changed, 1);
    assert.equal(snapshot.items[0].mrp, 12.5);
    assert.equal(snapshot.items[0].salesRate, 10);
    assert.notEqual(snapshot.revision, priceRevision);
    assert.equal(syncs, 2);
    priced = await (await pricePost({ '2': { mrp: 12.5, salesRate: 10 } })).json();
    assert.equal(priced.changed, 0);
    priced = await (await pricePost({ '999': { mrp: 5, salesRate: 4 } })).json();
    assert.equal(priced.changed, 0);
    assert.equal(syncs, 2);
    console.log(
      'Admin auth, stale revision, exact batch removal, audit, sync, duplicate rejection, cancellation tombstone and DPOS price update tests passed. No live stock changed.'
    );
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
