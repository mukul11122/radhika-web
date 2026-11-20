const crypto = require('crypto');
const MAX = 20 * 1024 * 1024,
  CHUNK = 512 * 1024;
function register(app, { db, stockAuth }) {
  async function tables() {
    const p = await db.getPool();
    await p.query(
      'CREATE TABLE IF NOT EXISTS stock_upload_sessions (id VARCHAR(36) PRIMARY KEY, filename VARCHAR(255) NOT NULL, size INT NOT NULL, completed TINYINT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
    );
    await p.query(
      'CREATE TABLE IF NOT EXISTS stock_upload_chunks (upload_id VARCHAR(36), part INT, data MEDIUMBLOB NOT NULL, PRIMARY KEY(upload_id,part))'
    );
    return p;
  }
  app.post('/api/admin/stock/upload/start', stockAuth, async (req, res) => {
    try {
      const name = String(req.body?.name || ''),
        size = Number(req.body?.size);
      if (
        !/\.(csv|xlsx)$/i.test(name) ||
        name.length > 255 ||
        !Number.isInteger(size) ||
        size <= 0 ||
        size > MAX
      )
        return res
          .status(400)
          .json({ ok: false, message: 'Choose an .xlsx or CSV file up to 20 MB.' });
      const pool = await tables();
      await pool.query(
        'DELETE c FROM stock_upload_chunks c JOIN stock_upload_sessions s ON s.id=c.upload_id WHERE s.created_at < NOW() - INTERVAL 1 HOUR'
      );
      await pool.query(
        'DELETE FROM stock_upload_sessions WHERE created_at < NOW() - INTERVAL 1 HOUR'
      );
      const id = crypto.randomUUID();
      await pool.query('INSERT INTO stock_upload_sessions (id,filename,size) VALUES (?,?,?)', [
        id,
        name,
        size,
      ]);
      res.json({ ok: true, uploadId: id, chunkSize: CHUNK });
    } catch (e) {
      console.error('[stock-start]', e.message);
      res.status(503).json({ ok: false, message: 'Upload could not start. Please try again.' });
    }
  });
  app.post('/api/admin/stock/upload/part', stockAuth, async (req, res) => {
    try {
      const { uploadId, part, data } = req.body || {};
      if (
        typeof uploadId !== 'string' ||
        !Number.isInteger(part) ||
        part < 0 ||
        typeof data !== 'string' ||
        data.length > Math.ceil(CHUNK / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
      )
        return res.status(400).json({ ok: false, message: 'Invalid upload part.' });
      const pool = await tables(),
        [rows] = await pool.query(
          'SELECT size,completed FROM stock_upload_sessions WHERE id=? AND created_at > NOW() - INTERVAL 1 HOUR',
          [uploadId]
        );
      if (!rows.length || rows[0].completed)
        return res
          .status(409)
          .json({ ok: false, message: 'Upload expired. Choose your file again.' });
      const size = rows[0].size,
        parts = Math.ceil(size / CHUNK),
        buffer = Buffer.from(data, 'base64');
      if (part >= parts || buffer.length !== Math.min(CHUNK, size - part * CHUNK))
        return res.status(400).json({ ok: false, message: 'Invalid upload part size.' });
      await pool.query(
        'INSERT INTO stock_upload_chunks (upload_id,part,data) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)',
        [uploadId, part, buffer]
      );
      res.json({ ok: true });
    } catch (e) {
      console.error('[stock-part]', e.message);
      res.status(503).json({ ok: false, message: 'Upload interrupted. Please try again.' });
    }
  });
  app.post('/api/admin/stock/upload/finish', stockAuth, async (req, res) => {
    let c;
    try {
      const id = String(req.body?.uploadId || '');
      const pool = await tables();
      await pool.query(
        'CREATE TABLE IF NOT EXISTS stock_snapshot (id INT PRIMARY KEY,payload LONGTEXT NOT NULL)'
      );
      c = await pool.getConnection();
      await c.beginTransaction();
      const [sessions] = await c.query(
        'SELECT filename,size,completed FROM stock_upload_sessions WHERE id=? AND created_at > NOW() - INTERVAL 1 HOUR FOR UPDATE',
        [id]
      );
      if (!sessions.length) throw Error('Upload expired. Choose your file again.');
      if (sessions[0].completed) {
        await c.commit();
        return res.json({ ok: true });
      }
      const session = sessions[0],
        [parts] = await c.query(
          'SELECT part,data FROM stock_upload_chunks WHERE upload_id=? ORDER BY part',
          [id]
        );
      if (parts.length !== Math.ceil(session.size / CHUNK) || parts.some((p, i) => p.part !== i))
        throw Error('Some file parts are missing. Upload the file again.');
      const buffer = Buffer.concat(parts.map((p) => p.data));
      if (buffer.length !== session.size) throw Error('Incomplete file. Upload again.');
      const items = await require('./stock').parseStock(buffer, session.filename);
      const snapshot = { items, updatedAt: new Date().toISOString(), version: crypto.randomUUID() };
      await c.query(
        'INSERT INTO stock_snapshot (id,payload) VALUES (1,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)',
        [JSON.stringify(snapshot)]
      );
      if (db.syncStockRows) await db.syncStockRows(c, snapshot);
      await c.query('UPDATE stock_upload_sessions SET completed=1 WHERE id=?', [id]);
      await c.query('DELETE FROM stock_upload_chunks WHERE upload_id=?', [id]);
      await c.commit();
      res.json({ ok: true, count: items.length });
    } catch (e) {
      if (c) await c.rollback().catch(() => {});
      console.error('[stock-finish]', e.message);
      res.status(400).json({
        ok: false,
        message: e.message || 'Stock could not be published. Previous stock was kept.',
      });
    } finally {
      if (c) c.release();
    }
  });
}
module.exports = { register, MAX, CHUNK };
