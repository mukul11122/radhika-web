const assert = require('node:assert/strict'),
  { selection, orderBy, sort } = require('../lib/alert-sorting');
const rows = [
  { code: '10', name: 'B', quantity: 5, expiry: '2026-12-31', days: 40 },
  { code: '2', name: 'A', quantity: 100, expiry: '2026-11-30', days: 9 },
  { code: '1', name: 'C', quantity: 20, expiry: '2027-01-31', days: 71 },
];
assert.deepEqual(
  sort('lowStock', [...rows], { lowStockSort: 'code' }).map((r) => r.code),
  ['1', '2', '10']
);
assert.equal(
  sort('lowStock', [...rows], { lowStockSort: 'quantity', lowStockDirection: 'desc' })[0].quantity,
  100
);
assert.equal(
  sort('expiring', [...rows], { expiringSort: 'days', expiringDirection: 'desc' })[0].days,
  71
);
assert.equal(sort('expired', [...rows], { expiredSort: 'name' })[0].name, 'A');
assert.equal(
  selection('lowStock', {
    lowStockSort: 'DROP TABLE stock_records',
    lowStockDirection: 'desc;DROP',
  }).key,
  'quantity'
);
assert(!orderBy('lowStock', { lowStockSort: 'DROP TABLE stock_records' }).includes('DROP'));
assert.match(
  orderBy('expiring', { expiringSort: 'days', expiringDirection: 'desc' }),
  /^expiry DESC/
);
console.log('Alert numeric/text/date sorting, default ordering and SQL allowlist passed.');
