const crypto = require('crypto');
const ready = new WeakMap();
async function setup(pool) {
  if (!ready.has(pool))
    ready.set(
      pool,
      pool
        .query(
          'CREATE TABLE IF NOT EXISTS kendra_pin_recovery (store_key VARCHAR(40) PRIMARY KEY,code_hash VARCHAR(64),expires_at DATETIME,attempts INT NOT NULL DEFAULT 0,requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,revoked_before BIGINT NOT NULL DEFAULT 0)'
        )
        .catch((e) => {
          ready.delete(pool);
          throw e;
        })
    );
  return ready.get(pool);
}
function digest(key, code) {
  return crypto
    .createHmac('sha256', process.env.STOCK_UPLOAD_PASSWORD)
    .update(key + ':' + code)
    .digest('hex');
}
async function checkSession(pool, key, token) {
  await setup(pool);
  const [rows] = await pool.query(
    'SELECT revoked_before FROM kendra_pin_recovery WHERE store_key=?',
    [key]
  );
  const data = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
  if (rows[0]?.revoked_before && data.exp - 7 * 86400000 <= Number(rows[0].revoked_before))
    throw Error('PIN changed. Please sign in again.');
}
function register(app, { db, transport, from }) {
  const k = require('./kendra');
  const safe = (fn) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await fn(req, res);
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message });
    }
  };
  async function rate(pool, identity) {
    const key = crypto
      .createHash('sha256')
      .update('recovery:' + identity)
      .digest('hex');
    await pool.query(
      'INSERT INTO kendra_login_limits (attempt_key) VALUES (?) ON DUPLICATE KEY UPDATE attempts=IF(started_at < NOW()-INTERVAL 15 MINUTE,0,attempts),started_at=IF(started_at < NOW()-INTERVAL 15 MINUTE,NOW(),started_at)',
      [key]
    );
    await pool.query('UPDATE kendra_login_limits SET attempts=attempts+1 WHERE attempt_key=?', [
      key,
    ]);
    const [rows] = await pool.query(
      'SELECT attempts FROM kendra_login_limits WHERE attempt_key=?',
      [key]
    );
    if (rows[0].attempts > 10) throw Error('Too many recovery attempts. Please wait 15 minutes.');
  }
  app.post(
    '/api/kendra/forgot-pin',
    safe(async (req, res) => {
      const key = k.storeKey(req.body.storeCode);
      if (!key || key.length > 40) throw Error('Enter your Store Code.');
      const pool = await db.getPool();
      await k.setup(pool);
      await setup(pool);
      await rate(pool, req.ip);
      await rate(pool, 'store:' + key);
      const c = await pool.getConnection();
      let email, code;
      try {
        await c.beginTransaction();
        const [profiles] = await c.query(
          'SELECT * FROM kendra_profiles WHERE store_key=? FOR UPDATE',
          [key]
        );
        if (profiles.length) {
          const [old] = await c.query('SELECT * FROM kendra_pin_recovery WHERE store_key=?', [key]);
          if (old.length && Date.now() - new Date(old[0].requested_at).getTime() < 60000)
            throw Error('Please wait one minute before requesting another code.');
          email = k.publicProfile(profiles[0]).email;
          if (email) {
            code = String(crypto.randomInt(100000, 1000000));
            await c.query(
              'INSERT INTO kendra_pin_recovery (store_key,code_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE)) ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),attempts=0,requested_at=CURRENT_TIMESTAMP',
              [key, digest(key, code)]
            );
          }
        }
        await c.commit();
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
      if (email) {
        try {
          await transport().sendMail({
            from,
            to: email,
            subject: 'Radhika Agencies — Profile PIN recovery',
            text:
              'Your one-time recovery code is ' +
              code +
              '. It expires in 10 minutes. Do not share it. If you did not request this, ignore this email.',
          });
        } catch {
          throw Error(
            'Recovery email could not be sent. Please contact Radhika Agencies for identity verification.'
          );
        }
      }
      res.json({
        ok: true,
        message:
          'If this Store Code has a saved email, a recovery code has been sent. If you have no saved email, contact Radhika Agencies for identity verification.',
      });
    })
  );
  app.post(
    '/api/kendra/reset-pin',
    safe(async (req, res) => {
      const key = k.storeKey(req.body.storeCode),
        code = String(req.body.code || '');
      if (!/^\d{6}$/.test(code) || !/^\d{6}$/.test(String(req.body.pin || '')))
        throw Error('Enter the 6-digit recovery code and new profile PIN.');
      const pool = await db.getPool();
      await k.setup(pool);
      await setup(pool);
      await rate(pool, req.ip);
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [rows] = await c.query(
          'SELECT * FROM kendra_pin_recovery WHERE store_key=? FOR UPDATE',
          [key]
        );
        const row = rows[0];
        if (
          !row ||
          !row.code_hash ||
          row.attempts >= 5 ||
          new Date(row.expires_at).getTime() < Date.now()
        )
          throw Error('Recovery code expired or invalid. Request a new code.');
        if (digest(key, code) !== row.code_hash) {
          await c.query('UPDATE kendra_pin_recovery SET attempts=attempts+1 WHERE store_key=?', [
            key,
          ]);
          await c.commit();
          throw Error('Incorrect recovery code.');
        }
        const salt = crypto.randomBytes(24).toString('hex'),
          hash = await k.pinHash(req.body.pin, salt);
        await c.query('UPDATE kendra_profiles SET pin_salt=?,pin_hash=? WHERE store_key=?', [
          salt,
          hash,
          key,
        ]);
        await c.query(
          'UPDATE kendra_pin_recovery SET code_hash=NULL,revoked_before=? WHERE store_key=?',
          [Date.now(), key]
        );
        await c.commit();
        res.json({ ok: true, message: 'Profile PIN reset. Sign in with your new PIN.' });
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    })
  );
}
module.exports = { setup, register, checkSession, digest };
