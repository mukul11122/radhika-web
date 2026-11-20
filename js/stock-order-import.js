(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockOrderImport = factory();
})(typeof window === 'undefined' ? this : window, function () {
  function csv(text) {
    const rows = [];
    let row = [],
      cell = '',
      quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((c === '\n' || c === '\r') && !quoted) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    if (quoted) throw Error('CSV has an unclosed quote.');
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }
  function parse(rows) {
    const key = (v) =>
      String(v ?? '')
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    let header = -1,
      code = -1,
      qty = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const cells = rows[i].map(key),
        c = cells.findIndex((v) => ['dc', 'drugcode'].includes(v)),
        q =
          ['orderqty', 'orderquantity', 'qrderqty', 'requiredqty']
            .map((alias) => cells.indexOf(alias))
            .find((index) => index >= 0) ?? -1;
      if (c >= 0 && q >= 0) {
        header = i;
        code = c;
        qty = q;
        break;
      }
    }
    if (header < 0)
      throw Error(
        'Required columns: DC and Order QTY. Fill Order QTY in the downloaded stock Excel.'
      );
    const totals = new Map();
    for (let i = header + 1; i < rows.length; i++) {
      const raw = String(rows[i][qty] ?? '').trim();
      if (!raw) continue;
      const quantity = Number(raw.replace(/,/g, ''));
      if (quantity === 0) continue;
      const dc = String(rows[i][code] ?? '').trim();
      if (!dc || !Number.isSafeInteger(quantity) || quantity < 0)
        throw Error('Invalid DC or Order QTY at row ' + (i + 1) + '. Use positive whole numbers.');
      const sum = (totals.get(dc) || 0) + quantity;
      if (!Number.isSafeInteger(sum)) throw Error('Quantity is too large at row ' + (i + 1));
      totals.set(dc, sum);
    }
    if (!totals.size) throw Error('No order quantities found. Fill the Order QTY column first.');
    return [...totals].map(([code, quantity]) => ({ code, quantity }));
  }
  function allocate(items, records, compare) {
    const result = {};
    for (const item of items) {
      let left = item.quantity;
      const rows = records
        .filter((r) => String(r.code) === item.code)
        .sort((a, b) => compare(a, b, 'expiry', 1));
      if (rows.reduce((sum, r) => sum + r.available, 0) < left)
        throw Error(
          'DC ' +
            item.code +
            ': requested ' +
            left +
            ' exceeds current available stock. Update the Excel and try again.'
        );
      for (const row of rows) {
        const take = Math.min(left, row.available);
        if (take > 0) result[row.id] = take;
        left -= take;
        if (!left) break;
      }
    }
    return result;
  }
  function repeat(items, records, compare) {
    const quantities = {},
      warnings = [],
      unavailableItems = [];
    const totals = new Map();
    for (const item of items)
      totals.set(String(item.code), (totals.get(String(item.code)) || 0) + Number(item.quantity));
    for (const [code, wanted] of totals) {
      if (!Number.isSafeInteger(wanted) || wanted <= 0)
        throw Error('Invalid quantity in previous order.');
      const available = records
        .filter((r) => String(r.code) === code)
        .reduce((sum, r) => sum + r.available, 0);
      const qty = Math.min(wanted, Math.floor(available));
      if (qty < wanted)
        unavailableItems.push({
          code,
          quantity: wanted - qty,
          requestedQuantity: wanted,
          availableQuantity: qty,
        });
      if (qty < wanted)
        warnings.push(
          'DC ' + code + ': ' + (qty ? 'reduced from ' + wanted + ' to ' + qty : 'unavailable')
        );
      if (qty) Object.assign(quantities, allocate([{ code, quantity: qty }], records, compare));
    }
    return { quantities, warnings, unavailableItems };
  }
  return { csv, parse, allocate, repeat };
});
