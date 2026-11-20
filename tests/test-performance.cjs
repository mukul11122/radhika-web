const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { schema } = require('../lib/order-admin');
(async () => {
  let ddl = 0;
  const pool = {
    query: async () => {
      ddl++;
      await Promise.resolve();
      return [[]];
    },
  };
  await Promise.all([schema(pool), schema(pool), schema(pool)]);
  await schema(pool);
  assert.equal(ddl, 3, 'schema initialized once per pool');
  let fail = true;
  const retryPool = {
    query: async () => {
      if (fail) {
        fail = false;
        throw Error('temporary');
      }
      return [[]];
    },
  };
  await assert.rejects(schema(retryPool));
  await schema(retryPool);
  let created = 0,
    snapshotDDL = 0,
    reads = 0;
  const fake = {
    query: async (sql) => {
      await Promise.resolve();
      if (sql.includes('CREATE TABLE IF NOT EXISTS stock_snapshot')) snapshotDDL++;
      if (sql.includes('SELECT payload FROM stock_snapshot')) {
        reads++;
        return [[{ payload: JSON.stringify({ items: [], version: String(reads) }) }]];
      }
      return [[]];
    },
  };
  const context = {
    process: { env: {} },
    module: { exports: {} },
    require: (name) => {
      if (['../lib/performance-store', '../lib/operations', '../lib/kendra'].includes(name))
        return { setup: async () => {} };
      assert.equal(name, 'mysql2/promise');
      return {
        createPool: () => {
          created++;
          return fake;
        },
      };
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../api/db'), 'utf8'), context);
  const db = context.module.exports;
  await Promise.all([db.getStock(), db.getStock()]);
  const current = await db.getStock();
  assert.equal(created, 1);
  assert.equal(snapshotDDL, 1);
  assert.equal(reads, 3, 'stock stays fresh; data is not cached');
  assert.equal(current.version, '3');
  console.log(
    'Single initialization, concurrency, retry and fresh-stock performance checks passed.'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
