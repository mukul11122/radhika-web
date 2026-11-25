const crypto = require('crypto');
const revision = (s) => String(s.revision || s.version || 'empty');
function grouped(items) {
  const groups = new Map();
  const normalize = (v) =>
    String(v || '')
      .trim()
      .toLowerCase();
  for (const row of items) {
    const key = JSON.stringify([
      normalize(row.code),
      normalize(row.batch),
      normalize(row.expiry),
      normalize(row.uom),
      !normalize(row.batch) ? String(row.id) : '',
    ]);
    if (!groups.has(key))
      groups.set(key, {
        ...row,
        id: 'batch-' + crypto.createHash('sha256').update(key).digest('hex'),
        available: 0,
        stockIds: [],
        sourceCount: 0,
      });
    const group = groups.get(key);
    group.available += Number(row.available) || 0;
    group.stockIds.push(String(row.id));
    group.sourceCount++;
  }
  return [...groups.values()];
}
function remove(snapshot, ids, expected) {
  if (revision(snapshot) !== expected)
    throw Object.assign(Error('Stock changed. Refresh and select again.'), { status: 409 });
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 200 ||
    new Set(ids.map(String)).size !== ids.length
  )
    throw Error('Select 1 to 200 batch records.');
  const groups = new Map(grouped(snapshot.items).map((row) => [row.id, row.stockIds]));
  const selected = new Set(ids.flatMap((id) => groups.get(String(id)) || [String(id)]));
  const removed = snapshot.items.filter((r) => selected.has(String(r.id)));
  if (removed.length !== selected.size)
    throw Object.assign(Error('Selected stock no longer exists. Refresh the list.'), {
      status: 409,
    });
  return {
    removed,
    snapshot: {
      ...snapshot,
      items: snapshot.items.filter((r) => !selected.has(String(r.id))),
      removedStockIds: [...new Set([...(snapshot.removedStockIds || []), ...selected])],
      revision: crypto.randomUUID(),
    },
  };
}
function register(app, { db, stockAuth }) {
  app.get('/api/admin/stock-records', stockAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const snapshot = await db.getStock();
      const q = String(req.query.q || '')
        .trim()
        .toLowerCase()
        .slice(0, 100);
      const size = [10, 20, 50, 100, 200].includes(Number(req.query.size))
        ? Number(req.query.size)
        : 10;
      const key = ['code', 'name', 'batch', 'expiry', 'available'].includes(req.query.sort)
        ? req.query.sort
        : 'code';
      const direction = req.query.direction === 'desc' ? -1 : 1;
      const { compare, searchRank } = require('../js/stock-grouping');
      let page = Math.max(1, Math.floor(Number(req.query.page) || 1));
      const rows = grouped(snapshot.items).filter((r) =>
        [r.code, r.name, r.batch].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(q)
        )
      );
      rows.sort(
        (a, b) =>
          searchRank(a, q) - searchRank(b, q) ||
          compare(a, b, key, direction) ||
          String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
      );
      page = Math.min(page, Math.max(1, Math.ceil(rows.length / size)));
      res.json({
        ok: true,
        revision: revision(snapshot),
        total: rows.length,
        page,
        size,
        items: rows.slice((page - 1) * size, page * size),
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: 'Stock could not be loaded.' });
    }
  });
  app.post('/api/admin/stock-records/remove', stockAuth, async (req, res) => {
    let c;
    try {
      const pool = await db.getPool();
      await pool.query(
        'CREATE TABLE IF NOT EXISTS stock_removals (id VARCHAR(36) PRIMARY KEY, actor VARCHAR(100) NOT NULL, removed LONGTEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
      );
      c = await pool.getConnection();
      await c.beginTransaction();
      const [rows] = await c.query('SELECT payload FROM stock_snapshot WHERE id=1 FOR UPDATE');
      if (!rows.length) throw Error('No uploaded stock found.');
      const previous = JSON.parse(rows[0].payload),
        result = remove(previous, req.body?.ids, req.body?.revision);
      await c.query('UPDATE stock_snapshot SET payload=? WHERE id=1', [
        JSON.stringify(result.snapshot),
      ]);
      await db.syncStockRows(c, result.snapshot, previous);
      await c.query('INSERT INTO stock_removals (id,actor,removed) VALUES (?,?,?)', [
        crypto.randomUUID(),
        String(req.adminUser || 'stock-admin'),
        JSON.stringify(result.removed),
      ]);
      await c.commit();
      res.json({
        ok: true,
        count: result.removed.length,
        message:
          req.body.ids.length +
          ' selected batches removed from live stock (' +
          result.removed.length +
          ' source records).',
      });
    } catch (e) {
      if (c) await c.rollback();
      res.status(e.status || 400).json({ ok: false, message: e.message });
    } finally {
      if (c) c.release();
    }
  });
  app.post('/api/admin/stock/update-prices', stockAuth, async (req, res) => {
    let c;
    try {
      const prices = req.body?.prices;
      if (!prices || typeof prices !== 'object' || Array.isArray(prices))
        throw Object.assign(Error('prices object is required.'), { status: 400 });
      const entries = Object.entries(prices);
      if (!entries.length || entries.length > 10000)
        throw Object.assign(Error('Send 1 to 10000 price entries.'), { status: 400 });
      const map = new Map();
      for (const [code, value] of entries) {
        const key = String(code).trim();
        const mrp = Number(value?.mrp),
          salesRate = Number(value?.salesRate);
        if (
          !key ||
          !Number.isFinite(mrp) ||
          !Number.isFinite(salesRate) ||
          mrp < 0 ||
          salesRate < 0
        )
          throw Object.assign(
            Error('Each price needs a code with non-negative mrp and salesRate.'),
            { status: 400 }
          );
        map.set(key, {
          mrp: Math.round(mrp * 1000) / 1000,
          salesRate: Math.round(salesRate * 1000) / 1000,
        });
      }
      const pool = await db.getPool();
      c = await pool.getConnection();
      await c.query(
        'CREATE TABLE IF NOT EXISTS stock_price_updates (id VARCHAR(36) PRIMARY KEY, actor VARCHAR(100) NOT NULL, changed_rows INT NOT NULL, matched_codes INT NOT NULL, sent_codes INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
      );
      await c.beginTransaction();
      const [rows] = await c.query('SELECT payload FROM stock_snapshot WHERE id=1 FOR UPDATE');
      if (!rows.length)
        throw Object.assign(Error('No uploaded stock found.'), { status: 404 });
      const previous = JSON.parse(rows[0].payload);
      if (!Array.isArray(previous.items) || !previous.items.length)
        throw Object.assign(Error('No uploaded stock found.'), { status: 404 });
      const matchedCodes = new Set();
      let updatedRows = 0;
      const items = previous.items.map((row) => {
        const price = map.get(String(row.code ?? '').trim());
        if (!price) return row;
        matchedCodes.add(String(row.code).trim());
        const mrp = Number(row.mrp),
          salesRate = Number(row.salesRate);
        if (Math.abs(mrp - price.mrp) < 0.001 && Math.abs(salesRate - price.salesRate) < 0.001)
          return row;
        updatedRows++;
        return { ...row, mrp: price.mrp, salesRate: price.salesRate };
      });
      if (!updatedRows) {
        await c.rollback();
        return res.json({
          ok: true,
          changed: 0,
          matchedCodes: matchedCodes.size,
          message: 'Prices already match the supplied rates.',
        });
      }
      const snapshot = {
        ...previous,
        items,
        updatedAt: new Date().toISOString(),
        version: crypto.randomUUID(),
        revision: crypto.randomUUID(),
      };
      await c.query('UPDATE stock_snapshot SET payload=? WHERE id=1', [JSON.stringify(snapshot)]);
      await db.syncStockRows(c, snapshot, previous);
      await c.query('INSERT INTO stock_price_updates (id,actor,changed_rows,matched_codes,sent_codes) VALUES (?,?,?,?,?)', [
        crypto.randomUUID(),
        String(req.adminUser || 'stock-admin'),
        updatedRows,
        matchedCodes.size,
        map.size,
      ]);
      await c.commit();
      res.json({
        ok: true,
        changed: updatedRows,
        matchedCodes: matchedCodes.size,
        codesSent: map.size,
        message:
          updatedRows +
          ' stock rows updated to new prices across ' +
          matchedCodes.size +
          ' medicines.',
      });
    } catch (e) {
      if (c) await c.rollback();
      res.status(e.status || 400).json({ ok: false, message: e.message });
    } finally {
      if (c) c.release();
    }
  });
}
module.exports = { register, remove, grouped };
