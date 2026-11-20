const catalogue = require('./medicine-catalogue.json');
function search(stock, query) {
  const map = new Map(catalogue.map((row) => [row.code, { ...row, quantity: 0 }]));
  for (const row of stock) {
    const code = String(row.code);
    const entry = map.get(code) || { code, name: row.name, uom: '' };
    entry.quantity = Number(row.quantity) || 0;
    map.set(code, entry);
  }
  const q = String(query || '')
    .trim()
    .toLowerCase();
  return [...map.values()]
    .filter((row) => row.quantity <= 0)
    .filter((row) => [row.code, row.name, row.uom].some((v) => String(v).toLowerCase().includes(q)))
    .sort(
      (a, b) =>
        (a.code.toLowerCase() === q ? 0 : 1) - (b.code.toLowerCase() === q ? 0 : 1) ||
        a.code.localeCompare(b.code, undefined, { numeric: true })
    )
    .slice(0, 30);
}
module.exports = { search };
