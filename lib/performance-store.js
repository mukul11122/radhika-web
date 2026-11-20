const { schema } = require('./order-admin');
const ready = new WeakMap();
function setup(pool) {
  if (!ready.has(pool))
    ready.set(
      pool,
      initialize(pool).catch((e) => {
        ready.delete(pool);
        throw e;
      })
    );
  return ready.get(pool);
}
async function initialize(pool) {
  const c = await pool.getConnection();
  try {
    const [locks] = await c.query("SELECT GET_LOCK('radhika_performance_v1',30) AS acquired");
    if (!Number(locks[0].acquired)) throw Error('Database optimization is busy. Please retry.');
    await c.query('CREATE TABLE IF NOT EXISTS performance_migrations (id INT PRIMARY KEY)');
    const [done] = await c.query('SELECT id FROM performance_migrations WHERE id=1');
    if (!done.length) {
      await initializeTables(c);
      await c.query('INSERT INTO performance_migrations (id) VALUES (1)');
    }
  } finally {
    await c.query("SELECT RELEASE_LOCK('radhika_performance_v1')").catch(() => {});
    c.release();
  }
}
async function initializeTables(pool) {
  await schema(pool);
  await pool.query(
    'CREATE TABLE IF NOT EXISTS stock_records (ordinal INT PRIMARY KEY, code VARCHAR(100) NOT NULL, name TEXT NOT NULL, batch TEXT, expiry DATE NULL, available DECIMAL(20,4) NOT NULL, payload LONGTEXT NOT NULL, INDEX stock_code(code), INDEX stock_expiry(expiry), INDEX stock_available(available))'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS stock_read_version (id INT PRIMARY KEY, revision VARCHAR(100) NOT NULL)'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS dashboard_cache (id INT PRIMARY KEY, fingerprint VARCHAR(100) NOT NULL, payload LONGTEXT NOT NULL)'
  );
  const [columns] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='stock_requests'"
  );
  const names = new Set(columns.map((r) => r.COLUMN_NAME));
  for (const [column, path, length] of [
    ['store_code', 'storeCode', 40],
    ['order_mobile', 'mobile', 20],
  ]) {
    if (!names.has(column))
      await pool.query(
        `ALTER TABLE stock_requests ADD COLUMN ${column} VARCHAR(${length}) GENERATED ALWAYS AS (LEFT(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.${path}')),${length})) STORED`
      );
  }
  const [indexes] = await pool.query(
    "SELECT TABLE_NAME,INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('stock_requests','order_management','dockets')"
  );
  const existing = new Set(indexes.map((r) => r.TABLE_NAME + '.' + r.INDEX_NAME));
  for (const [table, name, keys] of [
    ['stock_requests', 'orders_store_date', 'store_code,created_at,id'],
    ['stock_requests', 'orders_mobile_date', 'order_mobile,created_at,id'],
    ['stock_requests', 'orders_created', 'created_at,id'],
    ['order_management', 'orders_status', 'status,request_id'],
    ['dockets', 'docket_mobile', 'mobile(20)'],
  ]) {
    if (!existing.has(table + '.' + name))
      await pool.query(`CREATE INDEX ${name} ON ${table} (${keys})`);
  }
}
function revision(snapshot) {
  return String(snapshot.revision || snapshot.version || 'empty');
}
function values(row, ordinal) {
  const { expiryDate } = require('./order-insights');
  return [
    ordinal,
    String(row.code),
    String(row.name || row.code),
    String(row.batch || ''),
    expiryDate(row.expiry),
    Number(row.available) || 0,
    JSON.stringify(row),
  ];
}
async function sync(connection, snapshot, previous) {
  const [versions] = await connection.query('SELECT revision FROM stock_read_version WHERE id=1');
  if (versions[0]?.revision === revision(snapshot)) return;
  const incremental =
    previous &&
    versions[0]?.revision === revision(previous) &&
    previous.items.length === snapshot.items.length &&
    previous.items.every((r, i) => String(r.id) === String(snapshot.items[i].id));
  if (incremental) {
    for (let i = 0; i < snapshot.items.length; i++)
      if (JSON.stringify(previous.items[i]) !== JSON.stringify(snapshot.items[i])) {
        const v = values(snapshot.items[i], i);
        await connection.query(
          'UPDATE stock_records SET code=?,name=?,batch=?,expiry=?,available=?,payload=? WHERE ordinal=?',
          [...v.slice(1), i]
        );
      }
  } else {
    await connection.query('DELETE FROM stock_records');
    for (let i = 0; i < snapshot.items.length; i += 200) {
      const rows = snapshot.items.slice(i, i + 200).map((row, j) => values(row, i + j));
      await connection.query(
        'INSERT INTO stock_records (ordinal,code,name,batch,expiry,available,payload) VALUES ?',
        [rows]
      );
    }
  }
  await connection.query(
    'INSERT INTO stock_read_version (id,revision) VALUES (1,?) ON DUPLICATE KEY UPDATE revision=VALUES(revision)',
    [revision(snapshot)]
  );
}
async function ensureRows(pool) {
  await setup(pool);
  const [rows] = await pool.query(
    "SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.payload,'$.revision')),JSON_UNQUOTE(JSON_EXTRACT(s.payload,'$.version')),'empty') AS current_revision,v.revision FROM stock_snapshot s LEFT JOIN stock_read_version v ON v.id=1 WHERE s.id=1"
  );
  if (!rows.length || rows[0].current_revision === rows[0].revision) return;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [stock] = await c.query('SELECT payload FROM stock_snapshot WHERE id=1 FOR UPDATE');
    if (stock.length) await sync(c, JSON.parse(stock[0].payload));
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
async function alerts(pool, query) {
  await ensureRows(pool);
  const { dateKey } = require('./order-insights');
  const days = Math.min(365, Math.max(0, Number(query.days) || 90)),
    low = Math.min(1000000, Math.max(0, Number(query.low) || 50));
  const today = dateKey(new Date()),
    c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [meta] = await c.query(
      "SELECT v.revision,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.payload,'$.revision')),JSON_UNQUOTE(JSON_EXTRACT(s.payload,'$.version')),'empty') AS current_revision FROM stock_snapshot s LEFT JOIN stock_read_version v ON v.id=1 WHERE s.id=1"
    );
    if (meta.length && meta[0].revision !== meta[0].current_revision)
      throw Error('Stock changed. Please try again.');
    const snapshot = meta[0]?.revision || 'empty';
    if (query.snapshot && query.snapshot !== snapshot) {
      const error = Error('Stock changed. Please download again.');
      error.status = 409;
      throw error;
    }
    const result = { ok: true, days, low, snapshot, pages: {}, counts: {} };
    for (const key of ['lowStock', 'expiring', 'expired']) {
      const search = String(query[key + 'Search'] || '')
          .trim()
          .slice(0, 200),
        args = [];
      let source, where;
      if (key === 'lowStock') {
        source =
          '(SELECT code,MAX(name) AS name,SUM(available) AS quantity FROM stock_records GROUP BY code HAVING SUM(available)<=?) groups_stock';
        args.push(low);
        where = '1=1';
      } else {
        source = 'stock_records';
        where =
          'available>0 AND expiry IS NOT NULL AND ' +
          (key === 'expired'
            ? 'expiry < ?'
            : 'expiry >= ? AND expiry <= DATE_ADD(?, INTERVAL ? DAY)');
        args.push(today);
        if (key === 'expiring') args.push(today, days);
      }
      if (search) {
        where +=
          ' AND (LOCATE(LOWER(?),LOWER(code))>0 OR LOCATE(LOWER(?),LOWER(name))>0' +
          (key === 'lowStock' ? '' : ' OR LOCATE(LOWER(?),LOWER(batch))>0') +
          ')';
        args.push(search, search);
        if (key !== 'lowStock') args.push(search);
      }
      const [count] = await c.query(
        'SELECT COUNT(*) AS total FROM ' + source + ' WHERE ' + where,
        args
      );
      const total = Number(count[0].total),
        page = Math.max(
          1,
          Math.min(
            Math.max(1, Math.ceil(total / 30)),
            Math.floor(Number(query[key + 'Page']) || Number(query.page) || 1)
          )
        );
      result.counts[key] = total;
      result.pages[key] = page;
      const fields =
        key === 'lowStock'
          ? 'code,name,quantity'
          : "code,name,batch,DATE_FORMAT(expiry,'%Y-%m-%d') AS expiry,available AS quantity,DATEDIFF(expiry,?) AS days";
      const [records] = await c.query(
        'SELECT ' +
          fields +
          ' FROM ' +
          source +
          ' WHERE ' +
          where +
          ' ORDER BY ' +
          require('./alert-sorting').orderBy(key, query) +
          ' LIMIT 30 OFFSET ?',
        [...(key === 'lowStock' ? [] : [today]), ...args, (page - 1) * 30]
      );
      result[key] = records.map((row) => ({ ...row, quantity: Number(row.quantity) }));
    }
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
async function cachedDashboard(pool, compute) {
  await setup(pool);
  const signature = async () => {
    const [rows] = await pool.query(
      "SELECT (SELECT COUNT(*) FROM stock_requests) AS orders_count,(SELECT COALESCE(MAX(id),0) FROM order_events) AS event_id,(SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.revision')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.version')),'empty') FROM stock_snapshot WHERE id=1) AS stock_revision"
    );
    const { dateKey } = require('./order-insights');
    return require('crypto')
      .createHash('sha256')
      .update(JSON.stringify([dateKey(new Date()), rows]))
      .digest('hex');
  };
  const fingerprint = await signature();
  const [cached] = await pool.query(
    'SELECT payload FROM dashboard_cache WHERE id=1 AND fingerprint=?',
    [fingerprint]
  );
  if (cached.length) return JSON.parse(cached[0].payload);
  const data = await compute();
  if ((await signature()) === fingerprint)
    await pool.query(
      'INSERT INTO dashboard_cache (id,fingerprint,payload) VALUES (1,?,?) ON DUPLICATE KEY UPDATE fingerprint=VALUES(fingerprint),payload=VALUES(payload)',
      [fingerprint, JSON.stringify(data)]
    );
  return data;
}
module.exports = { setup, sync, ensureRows, alerts, cachedDashboard, revision };
