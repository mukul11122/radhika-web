const assert = require('node:assert/strict');
const { encode, decode, duplicateGroups, canonical } = require('../lib/operations');
const data = {
  format: 'radhika-backup-v1',
  tables: { stock_requests: [{ id: 'one', payload: '{"items":[]}' }] },
};
const archived = encode(data);
assert.deepEqual(decode(archived.payload, archived.checksum), data);
assert.throws(() => decode(archived.payload, 'incorrect'), /checksum/);
assert.equal(canonical([{ b: 2, a: 1 }]), canonical([{ a: 1, b: 2 }]));
const now = Date.parse('2026-11-15T06:00:00Z');
const order = (id, store, items, status = 'New', created_at = '2026-11-15T05:00:00Z') => ({
  id,
  status,
  created_at,
  payload: JSON.stringify({ storeCode: store, items }),
});
const rows = [
  order('1', 'PMBJK014228', [
    { code: '2', quantity: 5 },
    { code: '1', quantity: 3 },
  ]),
  order('2', '14228', [
    { code: '1', quantity: 3 },
    { code: '2', quantity: 5 },
  ]),
  order(
    '3',
    '14228',
    [
      { code: '1', quantity: 3 },
      { code: '2', quantity: 5 },
    ],
    'Cancelled'
  ),
  order('4', 'OTHER', [
    { code: '1', quantity: 3 },
    { code: '2', quantity: 5 },
  ]),
  order('5', '14228', [{ code: '1', quantity: 99 }]),
];
assert.equal(duplicateGroups(rows, now).length, 1);
assert.equal(duplicateGroups(rows, now)[0].length, 2);
assert.equal(duplicateGroups(rows, now + 2 * 86400000).length, 0);
console.log(
  'Backup compression/checksum, canonical restore comparison and duplicate matching/age/cancellation checks passed.'
);
