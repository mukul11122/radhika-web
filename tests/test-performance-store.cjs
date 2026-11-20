const assert = require('node:assert/strict');
const { sync, cachedDashboard } = require('../lib/performance-store');
(async () => {
  let revision = null,
    calls = [];
  const c = {
    query: async (sql, args) => {
      calls.push([sql, args]);
      if (sql.startsWith('SELECT revision')) return [revision ? [{ revision }] : []];
      if (sql.startsWith('INSERT INTO stock_read_version')) revision = args[0];
      return [[]];
    },
  };
  const first = {
    version: 'v1',
    items: Array.from({ length: 205 }, (_, i) => ({
      id: String(i),
      code: String(i),
      name: 'Medicine',
      available: 20,
      expiry: '31/12/2026',
    })),
  };
  await sync(c, first);
  assert.equal(calls.filter(([s]) => s.startsWith('INSERT INTO stock_records')).length, 2);
  calls = [];
  const deducted = {
    ...first,
    revision: 'r2',
    items: first.items.map((r, i) => (i === 4 ? { ...r, available: 12 } : r)),
  };
  await sync(c, deducted, first);
  assert.equal(calls.filter(([s]) => s.startsWith('UPDATE stock_records')).length, 1);
  assert(!calls.some(([s]) => s.startsWith('DELETE')));
  calls = [];
  await sync(c, deducted, first);
  assert.equal(calls.length, 1, 'same revision does no writes');
  let events = 1,
    stockRevision = 'r2',
    computed = 0,
    cached;
  const connection = {
    query: async (sql) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.startsWith('SELECT id FROM performance_migrations')) return [[{ id: 1 }]];
      return [[]];
    },
    release() {},
  };
  const pool = {
    getConnection: async () => connection,
    query: async (sql, args) => {
      if (sql.includes('orders_count'))
        return [[{ orders_count: 1, event_id: events, stock_revision: stockRevision }]];
      if (sql.startsWith('SELECT payload FROM dashboard_cache'))
        return [cached && cached.key === args[0] ? [{ payload: cached.value }] : []];
      if (sql.startsWith('INSERT INTO dashboard_cache')) cached = { key: args[0], value: args[1] };
      return [[]];
    },
  };
  const compute = async () => ({ computed: ++computed });
  assert.equal((await cachedDashboard(pool, compute)).computed, 1);
  assert.equal((await cachedDashboard(pool, compute)).computed, 1);
  events++;
  assert.equal(
    (await cachedDashboard(pool, compute)).computed,
    2,
    'status update refreshes totals'
  );
  stockRevision = 'new-file';
  assert.equal(
    (await cachedDashboard(pool, compute)).computed,
    3,
    'new stock rates refresh totals'
  );
  console.log(
    'Stock row batch backfill, changed-lot updates, duplicate revision and dashboard cache invalidation passed.'
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
