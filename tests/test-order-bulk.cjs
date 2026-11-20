const assert = require('node:assert/strict');
const { update } = require('../js/order-bulk');
(async () => {
  const calls = [],
    progress = [];
  const results = await update(
    [
      { id: 'a', label: 'Store A' },
      { id: 'b', label: 'Store B' },
      { id: 'a', label: 'Store A' },
      { id: 'c', label: 'Store C' },
    ],
    async (entry) => {
      calls.push(entry.id);
      if (entry.id === 'b') throw Error('Status transition not allowed');
      return { message: 'Updated' };
    },
    (done, total) => progress.push([done, total])
  );
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, false, true]
  );
  assert.equal(results[1].message, 'Status transition not allowed');
  assert.deepEqual(progress, [
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
  await assert.rejects(update([], async () => {}));
  await assert.rejects(
    update(
      Array.from({ length: 31 }, (_, id) => ({ id: String(id) })),
      async () => {}
    )
  );
  console.log(
    'Bulk updates: deduplication, continued processing after failure, progress and selection limits passed.'
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
