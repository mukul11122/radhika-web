(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StockGrouping = api;
})(typeof window === 'undefined' ? this : window, function () {
  function expiryKey(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
    return m
      ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
      : s;
  }
  function merge(items) {
    const groups = new Map();
    for (const [index, row] of items.entries()) {
      const expiry = expiryKey(row.expiry);
      const key = JSON.stringify([
        String(row.code).trim(),
        expiry || 'missing-' + index,
        String(row.uom || '')
          .trim()
          .toLowerCase(),
      ]);
      let g = groups.get(key);
      if (!g) {
        g = {
          ...row,
          id: 'merged-' + encodeURIComponent(key),
          available: 0,
          lots: [],
          batches: [],
        };
        groups.set(key, g);
      }
      g.available += Number(row.available) || 0;
      g.lots.push(row);
      if (row.batch && !g.batches.includes(row.batch)) g.batches.push(row.batch);
    }
    return [...groups.values()].map((g) => ({
      ...g,
      batch: g.batches.join(', '),
      mrpValues: [...new Set(g.lots.map((r) => r.mrp))],
      salesRateValues: [...new Set(g.lots.map((r) => r.salesRate))],
    }));
  }
  function total(row, quantity) {
    let left = quantity,
      sum = 0;
    for (const lot of row.lots || [row]) {
      const qty = Math.min(left, lot.available);
      if (qty > 0 && lot.salesRate == null) return null;
      sum += qty * (lot.salesRate || 0);
      left -= qty;
      if (left <= 0) break;
    }
    return sum;
  }
  function compareExpiry(a, b) {
    const date = (v) => {
      const key = expiryKey(v);
      if (!/^\d{4}-\d{2}-\d{2}/.test(key)) return Infinity;
      const time = Date.parse(key);
      return Number.isFinite(time) ? time : Infinity;
    };
    const x = date(a.expiry),
      y = date(b.expiry);
    return x === y ? 0 : x < y ? -1 : 1;
  }
  function compare(a, b, sortKey = 'code', direction = 1) {
    let primary;
    if (sortKey === 'expiry') primary = compareExpiry(a, b);
    else if (typeof a[sortKey] === 'number') primary = a[sortKey] - b[sortKey];
    else
      primary = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), undefined, {
        numeric: true,
      });
    return (
      direction * primary ||
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true }) ||
      compareExpiry(a, b) ||
      String(a.batch || '').localeCompare(String(b.batch || ''))
    );
  }
  function searchRank(row, query) {
    const q = String(query || '')
      .trim()
      .toLowerCase();
    if (!q) return 0;
    const code = String(row.code || '')
        .trim()
        .toLowerCase(),
      name = String(row.name || '')
        .trim()
        .toLowerCase();
    if (code === q) return 0;
    if (name === q) return 1;
    if (code.startsWith(q)) return 2;
    if (name.startsWith(q)) return 3;
    if (code.includes(q)) return 4;
    if (name.includes(q)) return 5;
    return 6;
  }
  return { merge, total, compare, searchRank };
});
