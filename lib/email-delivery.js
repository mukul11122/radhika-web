const ready = new WeakMap();
async function setup(pool) {
  if (!ready.has(pool))
    ready.set(
      pool,
      pool
        .query(
          'CREATE TABLE IF NOT EXISTS order_email_attempts (request_id VARCHAR(36) PRIMARY KEY,last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,error_text VARCHAR(1000),attempts INT NOT NULL DEFAULT 1)'
        )
        .catch((e) => {
          ready.delete(pool);
          throw e;
        })
    );
  return ready.get(pool);
}
function errorText(e) {
  return [e.code, e.responseCode, e.command, e.response || e.message]
    .filter(Boolean)
    .join(' · ')
    .replace(/([A-Z0-9._%+-]+)@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .slice(0, 1000);
}
async function record(c, id, error) {
  await c.query(
    'INSERT INTO order_email_attempts (request_id,error_text) VALUES (?,?) ON DUPLICATE KEY UPDATE last_attempt=CURRENT_TIMESTAMP,error_text=VALUES(error_text),attempts=attempts+1',
    [id, error ? errorText(error) : null]
  );
}
function register(app, { db, stockAuth, transport, from }) {
  app.post('/api/admin/orders/:id/retry-email', stockAuth, async (req, res) => {
    let c;
    try {
      const pool = await db.getPool();
      await setup(pool);
      await require('./order-admin').schema(pool);
      c = await pool.getConnection();
      await c.beginTransaction();
      const [rows] = await c.query(
        'SELECT payload,sent FROM stock_requests WHERE id=? FOR UPDATE',
        [req.params.id]
      );
      if (!rows.length) throw Error('Order not found.');
      if (!(await require('./order-admin').deliveryAllowed(c, req.params.id)))
        throw Error('Cancelled orders cannot be emailed.');
      const { RECIPIENTS, mailContent } = require('./stock-order'),
        order = JSON.parse(rows[0].payload),
        sent = JSON.parse(rows[0].sent);
      let failure = null;
      for (const to of RECIPIENTS) {
        if (sent.includes(to)) continue;
        try {
          const out = await transport().sendMail({
            from,
            to,
            ...mailContent(req.params.id, order.items, order),
          });
          if (!out.accepted?.length) throw Error('Email was not accepted');
          sent.push(to);
          await c.query('UPDATE stock_requests SET sent=? WHERE id=?', [
            JSON.stringify(sent),
            req.params.id,
          ]);
        } catch (e) {
          failure = e;
          break;
        }
      }
      await record(c, req.params.id, failure);
      await c.commit();
      res.json({
        ok: true,
        delivered: sent.length,
        message: failure
          ? 'Delivery still pending: ' + errorText(failure)
          : 'All order emails have been sent.',
      });
    } catch (e) {
      if (c) await c.rollback();
      res.status(400).json({ ok: false, message: e.message });
    } finally {
      if (c) c.release();
    }
  });
}
module.exports = { setup, record, errorText, register };
