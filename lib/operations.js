const crypto = require('crypto');
const zlib = require('zlib');
const TABLES = [
  'submissions',
  'dockets',
  'stock_snapshot',
  'stock_removals',
  'stock_requests',
  'order_serials',
  'stock_allocations',
  'order_management',
  'order_workflow',
  'order_events',
  'employees',
  'employee_access',
  'employee_reports',
  'kendra_profiles',
  'kendra_profile_events',
  'medicine_demands',
  'demand_events',
];
const initialized = new WeakMap();
function setup(pool) {
  if (!initialized.has(pool))
    initialized.set(
      pool,
      initialize(pool).catch((e) => {
        initialized.delete(pool);
        throw e;
      })
    );
  return initialized.get(pool);
}
async function initialize(pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS operational_issues (id BIGINT AUTO_INCREMENT PRIMARY KEY,route VARCHAR(200) NOT NULL,status INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX(created_at))'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS operational_issue_state (id TINYINT PRIMARY KEY, cleared_through_id BIGINT NOT NULL DEFAULT 0)'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS agency_backups (id VARCHAR(36) PRIMARY KEY,day_key DATE NOT NULL UNIQUE,payload LONGBLOB NOT NULL,checksum VARCHAR(64) NOT NULL,counts LONGTEXT NOT NULL,verified_at TIMESTAMP NULL,verification LONGTEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
  );
  // Separate audit metadata keeps older events intact.
  await pool.query(
    'CREATE TABLE IF NOT EXISTS order_event_details (event_id BIGINT PRIMARY KEY,actor VARCHAR(100) NOT NULL,details LONGTEXT NOT NULL)'
  );
}
function canonical(rows) {
  return JSON.stringify(
    rows
      .map((row) =>
        JSON.stringify(
          Object.fromEntries(
            Object.keys(row)
              .sort()
              .map((key) => [key, row[key]])
          )
        )
      )
      .sort()
  );
}
function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function encode(data) {
  const raw = Buffer.from(JSON.stringify(data));
  return { payload: zlib.gzipSync(raw), checksum: digest(raw) };
}
function decode(payload, checksum) {
  const raw = zlib.gunzipSync(payload, { maxOutputLength: 128 * 1024 * 1024 });
  if (digest(raw) !== checksum) throw Error('Backup checksum does not match.');
  const data = JSON.parse(raw.toString());
  if (data.format !== 'radhika-backup-v1' || !data.tables) throw Error('Invalid backup format.');
  return data;
}
async function createBackup(pool) {
  await setup(pool);
  const c = await pool.getConnection();
  try {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await c.beginTransaction();
    const [locks] = await c.query("SELECT GET_LOCK('radhika_backup',10) AS acquired");
    if (!Number(locks[0].acquired)) throw Error('A backup is already running.');
    const { dateKey } = require('./order-insights'),
      day = dateKey(new Date());
    const [existing] = await c.query('SELECT id FROM agency_backups WHERE day_key=?', [day]);
    if (existing.length) {
      await c.commit();
      return existing[0].id;
    }
    const tables = {};
    for (const table of TABLES) {
      const [present] = await c.query(
        'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
        [table]
      );
      if (present.length) {
        const [rows] = await c.query('SELECT * FROM ' + table);
        tables[table] = rows;
      }
    }
    const [metadata] = await c.query('SELECT * FROM order_event_details');
    tables.order_event_details = metadata;
    const data = { format: 'radhika-backup-v1', createdAt: new Date().toISOString(), tables };
    const { payload, checksum } = encode(data),
      id = crypto.randomUUID(),
      counts = Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length]));
    await c.query(
      'INSERT INTO agency_backups (id,day_key,payload,checksum,counts) VALUES (?,?,?,?,?)',
      [id, day, payload, checksum, JSON.stringify(counts)]
    );
    await c.commit();
    return id;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    await c.query("SELECT RELEASE_LOCK('radhika_backup')").catch(() => {});
    c.release();
  }
}
async function verifyBackup(pool, id) {
  await setup(pool);
  const [backups] = await pool.query('SELECT payload,checksum FROM agency_backups WHERE id=?', [
    id,
  ]);
  if (!backups.length) throw Error('Backup not found.');
  const data = decode(backups[0].payload, backups[0].checksum),
    c = await pool.getConnection(),
    verified = {};
  try {
    for (const table of [...TABLES, 'order_event_details']) {
      if (!Array.isArray(data.tables[table])) continue;
      const temp = 'restore_test_' + table;
      await c.query('DROP TEMPORARY TABLE IF EXISTS ' + temp);
      await c.query('CREATE TEMPORARY TABLE ' + temp + ' LIKE ' + table);
      const [columns] = await c.query(
        'SELECT COLUMN_NAME,DATA_TYPE,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
        [table]
      );
      const writable = columns.filter(
        (col) => !/VIRTUAL GENERATED|STORED GENERATED/.test(String(col.EXTRA))
      );
      const rows = data.tables[table];
      for (let i = 0; i < rows.length; i += 150) {
        const values = rows.slice(i, i + 150).map((row) =>
          writable.map((col) => {
            const value = row[col.COLUMN_NAME];
            return value && ['timestamp', 'datetime'].includes(col.DATA_TYPE)
              ? new Date(value)
              : value;
          })
        );
        await c.query(
          'INSERT INTO ' +
            temp +
            ' (' +
            writable.map((col) => '`' + col.COLUMN_NAME + '`').join(',') +
            ') VALUES ?',
          [values]
        );
      }
      const [restored] = await c.query('SELECT * FROM ' + temp);
      if (canonical(restored) !== canonical(rows))
        throw Error('Restore comparison failed for ' + table);
      verified[table] = restored.length;
    }
    await pool.query(
      'UPDATE agency_backups SET verified_at=CURRENT_TIMESTAMP,verification=? WHERE id=?',
      [JSON.stringify(verified), id]
    );
    return verified;
  } finally {
    for (const table of [...TABLES, 'order_event_details'])
      await c.query('DROP TEMPORARY TABLE IF EXISTS restore_test_' + table).catch(() => {});
    c.release();
  }
}
function duplicateGroups(rows, now = Date.now()) {
  const groups = new Map();
  for (const row of rows) {
    if (row.status === 'Cancelled') continue;
    let order;
    try {
      order = JSON.parse(row.payload);
    } catch {
      continue;
    }
    if (Array.isArray(order)) continue;
    const store = String(order.storeCode || '')
      .trim()
      .toLowerCase()
      .replace(/^pmbjk0*/, '')
      .replace(/^0+(?=\d)/, '');
    const identity = store || String(order.mobile || '').trim();
    if (!identity || !Array.isArray(order.items) || !order.items.length) continue;
    const totals = new Map();
    for (const item of order.items)
      totals.set(String(item.code), (totals.get(String(item.code)) || 0) + Number(item.quantity));
    const key = digest(
      JSON.stringify([identity, [...totals].sort((a, b) => a[0].localeCompare(b[0]))])
    );
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      id: row.id,
      storeCode: order.storeCode || '',
      createdAt: row.created_at,
      status: row.status || 'New',
    });
  }
  return [...groups.values()].filter(
    (group) =>
      group.length > 1 &&
      group.some((row) => now - new Date(row.createdAt).getTime() <= 24 * 60 * 60 * 1000)
  );
}
async function summary(pool) {
  await setup(pool);
  await require('./email-delivery').setup(pool);
  const [[backups], [issues], [delivery], [recent]] = await Promise.all([
    pool.query(
      'SELECT id,day_key,counts,verified_at,created_at FROM agency_backups ORDER BY created_at DESC LIMIT 14'
    ),
    pool.query(
      'SELECT id,route,status,created_at FROM operational_issues WHERE id > COALESCE((SELECT cleared_through_id FROM operational_issue_state WHERE id=1),0) ORDER BY id DESC LIMIT 50'
    ),
    pool.query(
      "SELECT r.id,r.created_at,JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.storeCode')) AS storeCode,JSON_LENGTH(r.sent) AS delivered,e.last_attempt,e.error_text,e.attempts FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id LEFT JOIN order_email_attempts e ON e.request_id=r.id WHERE COALESCE(m.status,'New') <> 'Cancelled' AND JSON_LENGTH(r.sent)<3 ORDER BY r.created_at DESC LIMIT 30"
    ),
    pool.query(
      "SELECT r.id,r.payload,r.created_at,COALESCE(m.status,'New') AS status FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id WHERE r.created_at >= NOW() - INTERVAL 1 DAY ORDER BY r.created_at DESC LIMIT 2000"
    ),
  ]);
  return {
    backups: backups.map((row) => ({ ...row, counts: JSON.parse(row.counts) })),
    issues,
    emailPending: delivery,
    duplicates: duplicateGroups(recent),
    duplicateScope: 'Last 24 hours, up to 2000 recent orders. Cancelled orders excluded.',
  };
}
function register(app, { db, stockAuth }) {
  const safe = (handler) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await handler(req, res);
    } catch (e) {
      console.error('[operations]', e.message);
      res
        .status(503)
        .json({ ok: false, message: 'This action could not be completed. Please try again.' });
    }
  };
  app.get(
    '/api/admin/operations',
    stockAuth,
    safe(async (req, res) => {
      if (req.employee) {
        const pool = await db.getPool();
        await setup(pool);
        await require('./email-delivery').setup(pool);
        const scope = 'EXISTS (SELECT 1 FROM order_workflow w WHERE w.request_id=r.id AND w.employee_id=?)';
        const [[delivery], [recent]] = await Promise.all([
          pool.query("SELECT r.id,r.created_at,JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.storeCode')) AS storeCode,JSON_LENGTH(r.sent) AS delivered FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id WHERE COALESCE(m.status,'New') <> 'Cancelled' AND JSON_LENGTH(r.sent)<3 AND " + scope + ' ORDER BY r.created_at DESC LIMIT 30', [req.employee.id]),
          pool.query("SELECT r.id,r.payload,r.created_at,COALESCE(m.status,'New') AS status FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id WHERE r.created_at >= NOW() - INTERVAL 1 DAY AND " + scope + ' ORDER BY r.created_at DESC LIMIT 2000', [req.employee.id])
        ]);
        return res.json({ok:true, backups:[], issues:[], emailPending:delivery, duplicates:duplicateGroups(recent), duplicateScope:'Assigned orders from the last 24 hours.'});
      }
      res.json({ ok: true, ...(await summary(await db.getPool())) });
    })
  );
  app.post(
    '/api/admin/operations/clear-failures',
    stockAuth,
    safe(async (req, res) => {
      const throughId = Number(req.body?.throughId);
      if (!Number.isSafeInteger(throughId) || throughId < 1)
        return res.status(400).json({ ok: false, message: 'Invalid failure list. Refresh and try again.' });
      const pool = await db.getPool();
      await setup(pool);
      const [rows] = await pool.query('SELECT MAX(id) AS latest FROM operational_issues');
      const latest = Number(rows[0]?.latest || 0);
      if (throughId > latest)
        return res.status(400).json({ ok: false, message: 'Invalid failure list. Refresh and try again.' });
      await pool.query(
        'INSERT INTO operational_issue_state (id,cleared_through_id) VALUES (1,?) ON DUPLICATE KEY UPDATE cleared_through_id=GREATEST(cleared_through_id,VALUES(cleared_through_id))',
        [throughId]
      );
      res.json({ ok: true, message: 'Failure list cleared.' });
    })
  );
  app.post(
    '/api/admin/backups',
    stockAuth,
    safe(async (req, res) => {
      const pool = await db.getPool(),
        id = await createBackup(pool),
        verified = await verifyBackup(pool, id);
      res.json({ ok: true, id, verified });
    })
  );
  app.post(
    '/api/admin/backups/:id/verify',
    stockAuth,
    safe(async (req, res) =>
      res.json({ ok: true, verified: await verifyBackup(await db.getPool(), req.params.id) })
    )
  );
  app.get(
    '/api/admin/backups/:id/download',
    stockAuth,
    safe(async (req, res) => {
      const pool = await db.getPool();
      await setup(pool);
      const [rows] = await pool.query('SELECT payload,checksum FROM agency_backups WHERE id=?', [
        req.params.id,
      ]);
      if (!rows.length) return res.status(404).json({ ok: false, message: 'Backup not found.' });
      const offset = Number(req.query.offset || 0);
      if (!Number.isSafeInteger(offset) || offset < 0)
        return res.status(400).json({ ok: false, message: 'Invalid backup part.' });
      const payload = rows[0].payload;
      res.json({
        ok: true,
        part: payload.subarray(offset, offset + 512 * 1024).toString('base64'),
        nextOffset: offset + 512 * 1024 < payload.length ? offset + 512 * 1024 : null,
        checksum: rows[0].checksum,
      });
    })
  );
  app.get(
    '/api/admin/orders/:id/history',
    stockAuth,
    safe(async (req, res) => {
      const pool = await db.getPool();
      await setup(pool);
      if (req.employee) {
        const [assigned] = await pool.query('SELECT request_id FROM order_workflow WHERE request_id=? AND employee_id=?', [req.params.id, req.employee.id]);
        if (!assigned.length) return res.status(403).json({ok:false,message:'This order is not assigned to you.'});
      }
      const [events] = await pool.query(
        'SELECT e.id,e.status,e.note,e.created_at,d.actor,d.details FROM order_events e LEFT JOIN order_event_details d ON d.event_id=e.id WHERE e.request_id=? ORDER BY e.id',
        [req.params.id]
      );
      res.json({
        ok: true,
        events: events.map((e) => ({
          ...e,
          actor: e.actor || 'Not recorded (older event)',
          details: e.details ? JSON.parse(e.details) : null,
        })),
      });
    })
  );
  app.get(
    '/api/cron/backup',
    safe(async (req, res) => {
      const expected = process.env.CRON_SECRET;
      if (!expected || req.headers.authorization !== 'Bearer ' + expected)
        return res.status(401).json({ ok: false, message: 'Unauthorized' });
      const pool = await db.getPool(),
        id = await createBackup(pool);
      const verified = await verifyBackup(pool, id);
      res.json({ ok: true, id, verified });
    })
  );
}
function monitor(db) {
  return (req, res, next) => {
    const original = res.json;
    res.json = function (body) {
      const tracked = res.statusCode >= 500 || res.statusCode === 409;
      if (!tracked || req.path.startsWith('/api/admin/operations')) return original.call(res, body);
      const route = req.path.slice(0, 200),
        status = res.statusCode;
      let sent = false;
      const send = () => {
        if (!sent) {
          sent = true;
          original.call(res, body);
        }
      };
      const timeout = setTimeout(send, 1500);
      db.getPool()
        .then((pool) =>
          setup(pool).then(() =>
            pool.query('INSERT INTO operational_issues (route,status) VALUES (?,?)', [
              route,
              status,
            ])
          )
        )
        .catch(() => {})
        .finally(() => {
          clearTimeout(timeout);
          send();
        });
      return res;
    };
    next();
  };
}
module.exports = {
  setup,
  encode,
  decode,
  canonical,
  createBackup,
  verifyBackup,
  duplicateGroups,
  register,
  monitor,
};
