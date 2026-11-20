const { createHash } = require('crypto');
const { schema } = require('./order-admin');
function decodeOrder(payload) {
  const raw = JSON.parse(payload);
  return Array.isArray(raw)
    ? { items: raw }
    : { ...raw, items: Array.isArray(raw.items) ? raw.items : [] };
}
function dateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}
function expiryDate(value) {
  const s = String(value || '').trim(),
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  const key = m
    ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    : s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const time = Date.parse(key + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key ? key : null;
}
function stockAlerts(items, { days = 90, low = 50, today = dateKey(new Date()) } = {}) {
  const groups = new Map(),
    expiring = [],
    expired = [];
  for (const row of items) {
    const code = String(row.code);
    const group = groups.get(code) || { code, name: row.name || code, quantity: 0 };
    group.quantity += Number(row.available) || 0;
    groups.set(code, group);
    if (row.available <= 0) continue;
    const expiry = expiryDate(row.expiry);
    if (!expiry) continue;
    const remaining = Math.round((Date.parse(expiry) - Date.parse(today)) / 86400000);
    const value = {
      code,
      name: row.name,
      batch: row.batch,
      uom: row.uom,
      expiry,
      quantity: row.available,
      days: remaining,
    };
    if (remaining < 0) expired.push(value);
    else if (remaining <= days) expiring.push(value);
  }
  return {
    lowStock: [...groups.values()]
      .filter((r) => r.quantity <= low)
      .sort((a, b) => a.quantity - b.quantity),
    expiring: expiring.sort((a, b) => a.days - b.days),
    expired: expired.sort((a, b) => a.days - b.days),
  };
}
function orderView(row, stock) {
  const order = decodeOrder(row.payload),
    receipt = row.receipt ? JSON.parse(row.receipt) : [];
  const products = new Map(stock.map((r) => [String(r.code), r]));
  return {
    id: row.id,
    status: row.status || 'New',
    createdAt: row.created_at,
    docket: row.docket || '',
    courier: row.courier || '',
    items: order.items.map((item) => ({
      code: item.code,
      quantity: item.quantity,
      name:
        receipt.find((r) => r.code === item.code)?.name ||
        products.get(String(item.code))?.name ||
        'Medicine ' + item.code,
    })),
    storeCode: order.storeCode,
  };
}
function dashboard(orders, stock, now = new Date()) {
  const today = dateKey(now),
    products = new Map(stock.map((row) => [String(row.code), row])),
    top = new Map();
  const weekDate = new Date(today + 'T00:00:00Z');
  weekDate.setUTCDate(weekDate.getUTCDate() - ((weekDate.getUTCDay() + 6) % 7));
  const periodStarts = {
    today,
    weekly: weekDate.toISOString().slice(0, 10),
    monthly: today.slice(0, 7) + '-01',
    yearly: today.slice(0, 4) + '-01-01',
  };
  const orderStatuses = [
    'New',
    'Accepted',
    'Challan Ready',
    'Packed',
    'Dispatched',
    'Delivered',
    'Cancelled',
  ];
  const orderCounts = Object.fromEntries(
    Object.keys(periodStarts).map((key) => [
      key,
      { total: 0, ...Object.fromEntries(orderStatuses.map((status) => [status, 0])) },
    ])
  );
  const estimatedValues = { today: 0, weekly: 0, monthly: 0, yearly: 0 };
  let todayOrders = 0,
    pending = 0,
    value = 0,
    unpriced = 0,
    legacy = 0;
  for (const row of orders) {
    const order = decodeOrder(row.payload);
    const createdDate = dateKey(row.created_at);
    for (const key of Object.keys(orderCounts)) {
      if (createdDate >= periodStarts[key] && createdDate <= today) {
        orderCounts[key].total++;
        const status = row.status || 'New';
        if (orderStatuses.includes(status)) orderCounts[key][status]++;
      }
    }
    if (dateKey(row.created_at) === today) todayOrders++;
    if (['New', 'Accepted', 'Challan Ready', 'Packed'].includes(row.status || 'New')) pending++;
    if (row.status === 'Cancelled') continue;
    const receipt = row.receipt ? JSON.parse(row.receipt) : [];
    let total = 0,
      missing = false;
    if (receipt.length && receipt.every((r) => r.salesRate != null)) {
      for (const r of receipt) total += r.quantity * r.salesRate;
    } else {
      legacy++;
      for (const item of order.items) {
        const product = products.get(String(item.code));
        if (product?.salesRate == null) missing = true;
        else total += item.quantity * product.salesRate;
      }
    }
    if (missing) unpriced++;
    else {
      value += total;
      const created = dateKey(row.created_at);
      for (const key of Object.keys(estimatedValues))
        if (created >= periodStarts[key] && created <= today) estimatedValues[key] += total;
    }
    for (const item of order.items) {
      const code = String(item.code),
        existing = top.get(code) || {
          code,
          name: products.get(code)?.name || receipt.find((r) => r.code === code)?.name || code,
          quantity: 0,
          orders: 0,
        };
      existing.quantity += item.quantity;
      existing.orders++;
      top.set(code, existing);
    }
  }
  return {
    todayOrders,
    pendingDispatch: pending,
    estimatedValue: Math.round(value * 100) / 100,
    estimatedValues: Object.fromEntries(
      Object.entries(estimatedValues).map(([key, amount]) => [key, Math.round(amount * 100) / 100])
    ),
    periodStarts,
    orderCounts,
    unpricedOrders: unpriced,
    legacyEstimates: legacy,
    topMedicines: [...top.values()].sort(
      (a, b) =>
        b.quantity - a.quantity ||
        String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
    ),
    today,
  };
}
function register(app, { db, stockAuth }) {
  const valid = (body) => {
    const store = String(body?.storeCode || '').trim(),
      mobile = String(body?.mobile || '').trim();
    return (
      !!(store || mobile) &&
      (!store || /^[A-Za-z0-9-]{1,40}$/.test(store)) &&
      (!mobile || /^\d{10}$/.test(mobile))
    );
  };
  async function ownOrders(body, id) {
    const pool = await db.getPool();
    await schema(pool);
    const args = [],
      conditions = [];
    if (String(body.storeCode || '').trim()) {
      conditions.push(
        db.optimizedOrders
          ? '(r.store_code=? AND BINARY r.store_code=BINARY ?)'
          : "JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.storeCode'))=?"
      );
      args.push(String(body.storeCode).trim());
      if (db.optimizedOrders) args.push(String(body.storeCode).trim());
    }
    if (String(body.mobile || '').trim()) {
      conditions.push(
        db.optimizedOrders
          ? 'r.order_mobile=?'
          : "JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.mobile'))=?"
      );
      args.push(String(body.mobile).trim());
    }
    let where = ' WHERE ' + conditions.join(' AND ');
    if (id) {
      where += ' AND r.id=?';
      args.push(id);
    }
    const page = Math.max(1, Math.min(100000, Math.floor(Number(body.page) || 1)));
    const [rows] = await pool.query(
      "SELECT r.id,r.payload,r.created_at,COALESCE(m.status,'New') AS status,m.receipt,m.docket,m.courier FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id" +
        where +
        ' ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET ?',
      [...args, id ? 0 : (page - 1) * 20]
    );
    return { rows, pool, page };
  }
  app.post('/api/orders/history', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!valid(req.body))
      return res.status(400).json({
        ok: false,
        message: 'Enter either Store Code or the 10-digit mobile number used for your order.',
      });
    try {
      const { rows, page } = await ownOrders(req.body),
        stock = await db.getStock();
      res.json({
        ok: true,
        page,
        hasMore: rows.length > 20,
        orders: rows.slice(0, 20).map((row) => orderView(row, stock.items)),
      });
    } catch (e) {
      console.error('[history]', e.message);
      res
        .status(503)
        .json({ ok: false, message: 'Order history could not be loaded. Please try again.' });
    }
  });
  app.post('/api/orders/repeat', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!valid(req.body) || !/^[a-f0-9-]{36}$/i.test(String(req.body?.id || '')))
      return res
        .status(400)
        .json({ ok: false, message: 'Enter your Store Code or order mobile number.' });
    try {
      const { rows } = await ownOrders(req.body, req.body.id);
      if (!rows.length)
        return res.status(404).json({ ok: false, message: 'No matching order found.' });
      const order = decodeOrder(rows[0].payload);
      res.json({
        ok: true,
        items: order.items,
        storeCode: order.storeCode || '',
        mobile: String(req.body.mobile || '').trim(),
      });
    } catch (e) {
      res.status(503).json({ ok: false, message: 'Order could not be prepared. Try again.' });
    }
  });
  app.get('/api/admin/dashboard', stockAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const pool = await db.getPool();
      await schema(pool);
      const compute = async () => {
        const [[orders], stock] = await Promise.all([
          pool.query(
            "SELECT r.payload,r.created_at,COALESCE(m.status,'New') AS status,m.receipt FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id"
          ),
          db.getStock(),
        ]);
        return dashboard(orders, stock.items);
      };
      const data = db.dashboardCached ? await db.dashboardCached(compute) : await compute();
      res.json({ ok: true, ...data });
    } catch (e) {
      console.error('[dashboard]', e.message);
      res.status(503).json({ ok: false, message: 'Dashboard could not be loaded.' });
    }
  });
  app.get('/api/admin/stock-alerts', stockAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const days = Math.min(365, Math.max(0, Number(req.query.days) || 90)),
        low = Math.min(1000000, Math.max(0, Number(req.query.low) || 50));
      if (db.getStockAlerts) return res.json(await db.getStockAlerts(req.query));
      const stock = await db.getStock();
      const snapshot = createHash('sha256').update(JSON.stringify(stock)).digest('hex');
      if (req.query.snapshot && req.query.snapshot !== snapshot)
        return res
          .status(409)
          .json({ ok: false, message: 'Stock changed. Please download again.' });
      const lists = stockAlerts(stock.items, { days, low });
      for (const key of ['lowStock', 'expiring', 'expired']) {
        const query = String(req.query[key + 'Search'] || '')
          .trim()
          .toLowerCase()
          .slice(0, 200);
        if (query)
          lists[key] = lists[key].filter((row) =>
            [row.code, row.name, row.batch].some((value) =>
              String(value || '')
                .toLowerCase()
                .includes(query)
            )
          );
      }
      for (const key of ['lowStock', 'expiring', 'expired'])
        require('./alert-sorting').sort(key, lists[key], req.query);
      const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page) || 1))),
        size = 30;
      const pages = {};
      for (const key of ['lowStock', 'expiring', 'expired'])
        pages[key] = Math.max(
          1,
          Math.min(
            Math.max(1, Math.ceil(lists[key].length / size)),
            Math.floor(Number(req.query[key + 'Page']) || page)
          )
        );
      res.json({
        ok: true,
        pages,
        days,
        low,
        page,
        snapshot,
        counts: {
          lowStock: lists.lowStock.length,
          expiring: lists.expiring.length,
          expired: lists.expired.length,
        },
        lowStock: lists.lowStock.slice((pages.lowStock - 1) * size, pages.lowStock * size),
        expiring: lists.expiring.slice((pages.expiring - 1) * size, pages.expiring * size),
        expired: lists.expired.slice((pages.expired - 1) * size, pages.expired * size),
      });
    } catch (e) {
      res.status(e.status || 503).json({
        ok: false,
        message: e.status === 409 ? e.message : 'Stock alerts could not be loaded.',
      });
    }
  });
}
module.exports = { register, stockAlerts, dashboard, dateKey, expiryDate, orderView };
