const { restoreStock } = require('./stock-allocation');
const STATUSES = [
  'New',
  'Accepted',
  'Challan Ready',
  'Under Packing',
  'Packed',
  'Dispatched',
  'Delivered',
  'Cancelled',
];
const schemaReady = new WeakMap();
function schema(pool) {
  if (!schemaReady.has(pool)) {
    const pending = initializeSchema(pool).catch((error) => {
      schemaReady.delete(pool);
      throw error;
    });
    schemaReady.set(pool, pending);
  }
  return schemaReady.get(pool);
}
async function initializeSchema(pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS stock_requests (id VARCHAR(36) PRIMARY KEY, payload LONGTEXT NOT NULL, sent LONGTEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS order_serials (serial_number BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, request_id VARCHAR(36) NOT NULL UNIQUE)'
  );
  await pool.query(
    'INSERT IGNORE INTO order_serials (request_id) SELECT r.id FROM stock_requests r LEFT JOIN order_serials s ON s.request_id=r.id WHERE s.request_id IS NULL ORDER BY r.created_at ASC,r.id ASC'
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS order_management (request_id VARCHAR(36) PRIMARY KEY, status VARCHAR(20) NOT NULL DEFAULT 'New', receipt LONGTEXT, stock_version VARCHAR(100), returned TINYINT NOT NULL DEFAULT 0, note TEXT, docket VARCHAR(100), courier VARCHAR(100), updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)"
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS order_workflow (request_id VARCHAR(36) PRIMARY KEY, employee_id VARCHAR(36) NULL, employee_name VARCHAR(120) NULL, priority VARCHAR(10) NOT NULL DEFAULT 'Normal', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)"
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS order_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, request_id VARCHAR(36) NOT NULL, status VARCHAR(20) NOT NULL, note TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX(request_id))'
  );
}
async function recordReservation(connection, id, receipt, version) {
  await connection.query(
    'INSERT INTO order_serials (request_id) VALUES (?) ON DUPLICATE KEY UPDATE request_id=VALUES(request_id)',
    [id]
  );
  await connection.query(
    'INSERT INTO order_management (request_id,receipt,stock_version) VALUES (?,?,?)',
    [id, JSON.stringify(receipt), version]
  );
  await connection.query('INSERT INTO order_events (request_id,status,note) VALUES (?,?,?)', [
    id,
    'New',
    'Stock reserved at submission.',
  ]);
}
async function deliveryAllowed(connection, id) {
  const [rows] = await connection.query('SELECT status FROM order_management WHERE request_id=?', [
    id,
  ]);
  return !rows.length || rows[0].status !== 'Cancelled';
}
function register(app, { db, stockAuth }) {
  app.get('/api/admin/orders', stockAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const pool = await db.getPool();
      await schema(pool);
      const page = Math.max(1, Math.floor(Number(req.query.page) || 1)),
        limit = [10, 20, 30, 50, 100, 200].includes(Number(req.query.limit)) ? Number(req.query.limit) : 30,
        status = STATUSES.includes(req.query.status) ? req.query.status : '';
      const q = String(req.query.q || '').slice(0, 100);
      const statusStart = "COALESCE((SELECT MAX(e.created_at) FROM order_events e WHERE e.request_id=r.id AND e.status=COALESCE(m.status,'New')),r.created_at)";
      const overdueCondition = "COALESCE(m.status,'New') IN ('New','Accepted','Challan Ready','Under Packing','Packed') AND " + statusStart + ' <= CURRENT_TIMESTAMP - INTERVAL 24 HOUR';
      const where = [],
        args = [];
      const scope = req.employee ? 'EXISTS (SELECT 1 FROM order_workflow scoped WHERE scoped.request_id=r.id AND scoped.employee_id=?)' : '';
      const scopeArgs = req.employee ? [req.employee.id] : [];
      if (scope) { where.push(scope); args.push(...scopeArgs); }
      if (req.query.overdue === '1') where.push('(' + overdueCondition + ')');
      if (req.query.pending === '1') where.push("COALESCE(m.status,'New') IN ('New','Accepted','Challan Ready','Under Packing','Packed')");
      if (status) {
        where.push("COALESCE(m.status,'New')=?");
        args.push(status);
      }
      if (q) {
        where.push('(r.id LIKE ? OR r.payload LIKE ?)');
        args.push('%' + q + '%', '%' + q + '%');
      }
      const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
      const [counts] = await pool.query(
        'SELECT COUNT(*) AS total FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id' +
          clause,
        args
      );
      const [rows] = await pool.query(
        "SELECT r.id,r.payload,r.sent,r.created_at,s.serial_number AS serialNumber,COALESCE(m.status,'New') AS status,m.returned,m.note,m.docket,m.courier,m.updated_at,w.employee_id,w.employee_name,COALESCE(w.priority,'Normal') AS priority, " + statusStart + " AS status_since, (" + overdueCondition + ") AS overdue FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id LEFT JOIN order_workflow w ON w.request_id=r.id LEFT JOIN order_serials s ON s.request_id=r.id" +
          clause +
          ' ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?',
        [...args, limit, (page - 1) * limit]
      );
      const [stats] = await pool.query(
        "SELECT COALESCE(m.status,'New') AS status,COUNT(*) AS count FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id" + (scope ? ' WHERE ' + scope : '') + " GROUP BY COALESCE(m.status,'New')", scopeArgs
      );
      const [overdueCounts] = await pool.query("SELECT COUNT(*) AS total FROM stock_requests r LEFT JOIN order_management m ON m.request_id=r.id WHERE (" + overdueCondition + ')' + (scope ? ' AND ' + scope : ''), scopeArgs);
      res.json({
        ok: true,
        overdueTotal: Number(overdueCounts[0]?.total || 0),
        orders: rows.map((row) => ({
          ...row,
          ...JSON.parse(row.payload),
          serialNumber: row.serialNumber,
          employee_id: row.employee_id, employee_name: row.employee_name, priority: row.priority, overdue: row.overdue, status_since: row.status_since,
          items: Array.isArray(JSON.parse(row.payload))
            ? JSON.parse(row.payload)
            : JSON.parse(row.payload).items || [],
          payload: undefined,
          sent: JSON.parse(row.sent),
        })),
        total: counts[0].total,
        page: Math.floor(page),
        stats,
      });
    } catch (e) {
      console.error('[orders-list]', e.message);
      res.status(503).json({ ok: false, message: 'Orders could not be loaded. Try again.' });
    }
  });
  app.post('/api/admin/orders/:id/workflow', stockAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let c;
    try {
      const priority = req.body?.priority, employeeId = String(req.body?.employeeId || '').trim();
      if (!['High', 'Normal', 'Low'].includes(priority) || employeeId.length > 36) return res.status(400).json({ok:false,message:'Invalid assignment or priority.'});
      const pool = await db.getPool(); await schema(pool); await require('./employees').setup(pool);
      c = await pool.getConnection(); await c.beginTransaction();
      const [requests] = await c.query('SELECT id FROM stock_requests WHERE id=? FOR UPDATE', [req.params.id]);
      if (!requests.length) throw Error('Order not found.');
      let employeeName = null;
      if (employeeId) { const [employees] = await c.query('SELECT name,active FROM employees WHERE id=?', [employeeId]); if (!employees.length || !employees[0].active) throw Error('Choose an active employee.'); employeeName = employees[0].name; }
      await c.query('INSERT INTO order_workflow (request_id,employee_id,employee_name,priority) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id),employee_name=VALUES(employee_name),priority=VALUES(priority)', [req.params.id, employeeId || null, employeeName, priority]);
      await c.commit(); res.json({ok:true,message:'Assignment and priority saved.'});
    } catch(error) { if(c) await c.rollback().catch(()=>{}); res.status(400).json({ok:false,message:error.message || 'Could not save changes.'}); }
    finally { if(c) c.release(); }
  });
  app.post('/api/admin/orders/:id/status', stockAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let c;
    try {
      const id = req.params.id,
        target = req.body?.status,
        note = String(req.body?.note || '')
          .trim()
          .slice(0, 1000),
        docket = String(req.body?.docket || '')
          .trim()
          .slice(0, 100),
        courier = String(req.body?.courier || '')
          .trim()
          .slice(0, 100);
      if (!STATUSES.includes(target))
        return res.status(400).json({ ok: false, message: 'Invalid order status.' });
      const pool = await db.getPool();
      await schema(pool);
      c = await pool.getConnection();
      await c.beginTransaction();
      const [requests] = await c.query(
        'SELECT payload,sent FROM stock_requests WHERE id=? FOR UPDATE',
        [id]
      );
      if (!requests.length) throw Error('Order not found.');
      if (req.employee) {
        const [assignments] = await c.query('SELECT employee_id FROM order_workflow WHERE request_id=? FOR UPDATE', [id]);
        if (!assignments.length || assignments[0].employee_id !== req.employee.id) {
          await c.rollback();
          return res.status(403).json({ok:false,message:'This order is not assigned to you.'});
        }
      }
      await c.query('INSERT IGNORE INTO order_management (request_id) VALUES (?)', [id]);
      const [managed] = await c.query(
        'SELECT * FROM order_management WHERE request_id=? FOR UPDATE',
        [id]
      );
      const order = managed[0],
        current = order.status;
      if (current === target) {
        await c.commit();
        return res.json({ ok: true, message: 'Order already ' + target + '. No stock changed.' });
      }
      const allowed = {
        New: ['Accepted', 'Cancelled'],
        Accepted: ['Challan Ready', 'Cancelled'],
        'Challan Ready': ['Under Packing', 'Packed', 'Cancelled'],
        'Under Packing': ['Packed', 'Cancelled'],
        Packed: ['Dispatched', 'Cancelled'],
        Dispatched: ['Delivered'],
        Delivered: [],
        Cancelled: [],
      };
      if (!allowed[current]?.includes(target))
        throw Error(
          'This status change is not allowed. Dispatched or delivered orders cannot be cancelled here.'
        );
      if (target === 'Cancelled' && !note) throw Error('Enter a cancellation reason.');
      let returned = 0,
        message = 'Order marked ' + target + '.';
      if (target === 'Cancelled') {
        const [stocks] = await c.query('SELECT payload FROM stock_snapshot WHERE id=1 FOR UPDATE');
        const result = stocks.length
          ? restoreStock(
              JSON.parse(stocks[0].payload),
              order.receipt ? JSON.parse(order.receipt) : [],
              order.stock_version
            )
          : { returned: false, note: 'No current stock snapshot. Check stock manually.' };
        if (result.returned) {
          await c.query('UPDATE stock_snapshot SET payload=? WHERE id=1', [
            JSON.stringify(result.snapshot),
          ]);
          if (db.syncStockRows)
            await db.syncStockRows(c, result.snapshot, JSON.parse(stocks[0].payload));
          returned = 1;
        }
        message = 'Order cancelled. ' + result.note;
      }
      await c.query(
        'UPDATE order_management SET status=?,returned=?,note=?,docket=?,courier=? WHERE request_id=?',
        [
          target,
          returned,
          note + (target === 'Cancelled' ? '\n' + message : ''),
          docket || order.docket || '',
          courier || order.courier || '',
          id,
        ]
      );
      await c.query('INSERT INTO order_events (request_id,status,note) VALUES (?,?,?)', [
        id,
        target,
        note || message,
      ]);
      if (db.recordAudit)
        await db.recordAudit(c, req.adminUser || 'Admin', {
          from: current,
          to: target,
          stockReturned: !!returned,
          returnedQuantity: returned
            ? JSON.parse(order.receipt || '[]').reduce((sum, row) => sum + Number(row.quantity), 0)
            : 0,
          courier: courier || order.courier || '',
          docket: docket || order.docket || '',
        });
      await c.commit();
      res.json({ ok: true, message, returned: !!returned });
    } catch (e) {
      if (c) await c.rollback().catch(() => {});
      res.status(409).json({ ok: false, message: e.message || 'Order could not be updated.' });
    } finally {
      if (c) c.release();
    }
  });
}
module.exports = { schema, recordReservation, deliveryAllowed, register, STATUSES };
