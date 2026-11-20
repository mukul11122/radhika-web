const { compare } = require('../js/stock-grouping');
function deductStock(snapshot, selections, version, receipt = []) {
  if (version !== snapshot.version)
    throw new Error('Stock list has changed. Refresh the page and select your medicines again.');
  const items = snapshot.items.map((row) => ({ ...row }));
  for (const selection of selections) {
    if (!Array.isArray(selection.stockIds) || !selection.stockIds.length)
      throw new Error('Refresh the page and select your medicines again.');
    const ids = new Set(selection.stockIds.map(String));
    const lots = items
      .filter((row) => String(row.code) === String(selection.code) && ids.has(String(row.id)))
      .sort((a, b) => compare(a, b, 'expiry', 1));
    let left = Number(selection.quantity);
    if (
      !Number.isSafeInteger(left) ||
      left <= 0 ||
      lots.reduce((sum, row) => sum + Number(row.available), 0) < left
    )
      throw new Error(
        'Stock changed for drug code ' +
          selection.code +
          '. Refresh the stock page and check the quantity.'
      );
    for (const row of lots) {
      const take = Math.min(left, row.available);
      if (take > 0)
        receipt.push({
          stockId: String(row.id),
          code: String(row.code),
          name: row.name || '',
          salesRate: row.salesRate ?? null,
          batch: row.batch || '',
          expiry: row.expiry || '',
          uom: row.uom || '',
          quantity: take,
        });
      row.available -= take;
      left -= take;
      if (!left) break;
    }
  }
  return { ...snapshot, items, revision: require('crypto').randomUUID() };
}
function restoreStock(snapshot, receipt, version) {
  if (snapshot.version !== version)
    return {
      snapshot,
      returned: false,
      note: 'A newer stock file has been uploaded. Check this order against the new file before adjusting stock manually.',
    };
  if (!Array.isArray(receipt) || !receipt.length)
    return {
      snapshot,
      returned: false,
      note: 'This older order has no batch reservation receipt. Check stock manually.',
    };
  const items = snapshot.items.map((row) => ({ ...row }));
  let skipped = 0;
  for (const allocation of receipt) {
    if ((snapshot.removedStockIds || []).includes(String(allocation.stockId))) {
      skipped++;
      continue;
    }
    const row = items.find(
      (row) =>
        String(row.id) === allocation.stockId &&
        String(row.code) === allocation.code &&
        (row.batch || '') === allocation.batch &&
        (row.expiry || '') === allocation.expiry &&
        (row.uom || '') === allocation.uom
    );
    if (!row || !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0)
      throw new Error('Batch receipt does not match current stock. No stock was changed.');
    row.available += allocation.quantity;
  }
  return {
    snapshot: { ...snapshot, items, revision: require('crypto').randomUUID() },
    returned: true,
    note: skipped
      ? 'Remaining reserved quantities returned. ' +
        skipped +
        ' admin-removed batches were not restored.'
      : 'Reserved quantity returned to the original batches.',
  };
}
module.exports = { deductStock, restoreStock };
