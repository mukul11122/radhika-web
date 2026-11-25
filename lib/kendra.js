const crypto = require('crypto'),
  { promisify } = require('util'),
  scrypt = promisify(crypto.scrypt);
const initialized = new WeakMap();
const STATUSES = ['New', 'Reviewing', 'Available', 'Closed'];
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
    'CREATE TABLE IF NOT EXISTS kendra_profiles (store_key VARCHAR(40) PRIMARY KEY,store_code VARCHAR(40) NOT NULL,mobile VARCHAR(10) NOT NULL,pin_salt VARCHAR(64) NOT NULL,pin_hash VARCHAR(128) NOT NULL,profile LONGTEXT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,INDEX(mobile))'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS kendra_login_limits (attempt_key VARCHAR(64) PRIMARY KEY,attempts INT NOT NULL DEFAULT 0,started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS medicine_demands (id VARCHAR(36) PRIMARY KEY,store_key VARCHAR(40) NOT NULL,code VARCHAR(100),medicine VARCHAR(500) NOT NULL,quantity INT NOT NULL,note VARCHAR(1000),status VARCHAR(20) NOT NULL DEFAULT 'New',admin_note VARCHAR(1000),request_hash VARCHAR(64) NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,INDEX demand_store_date(store_key,created_at,id),INDEX demand_status_date(status,created_at,id))"
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS demand_events (id BIGINT AUTO_INCREMENT PRIMARY KEY,demand_id VARCHAR(36) NOT NULL,status VARCHAR(20) NOT NULL,note VARCHAR(1000),actor VARCHAR(100) NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX(demand_id))'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS kendra_profile_events (id BIGINT AUTO_INCREMENT PRIMARY KEY,store_key VARCHAR(40) NOT NULL,actor VARCHAR(100) NOT NULL,before_profile LONGTEXT NOT NULL,after_profile LONGTEXT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX(store_key,created_at))'
  );
}
function storeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^pmbjk0*/, '')
    .replace(/^0+(?=\d)/, '');
}
function fields(input) {
  const out = {};
  for (const [key, max] of Object.entries({
    storeCode: 40,
    mobile: 10,
    dlForm20: 100,
    dlForm21: 100,
    contactName: 120,
    address: 600,
    city: 100,
    state: 100,
    pincode: 6,
    gst: 15,
    email: 160,
  })) {
    out[key] = String(input?.[key] || '').trim();
    if (out[key].length > max) throw Error('Please shorten ' + key + '.');
  }
  out.gst = out.gst.toUpperCase();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(out.storeCode) || !storeKey(out.storeCode))
    throw Error('Enter a valid Store Code.');
  if (!/^\d{10}$/.test(out.mobile)) throw Error('Enter a 10-digit mobile number.');
  for (const key of ['contactName', 'city'])
    if (!out[key]) throw Error('Complete all required profile details.');
  if (!/^[1-9]\d{5}$/.test(out.pincode)) throw Error('Enter a valid 6-digit delivery PIN code.');
  if (out.gst && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(out.gst))
    throw Error('Enter a valid 15-character GSTIN or leave it blank.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
    throw Error('Enter a valid email address. Email is required.');
  return out;
}
function pin(value) {
  const text = String(value || '');
  if (!/^\d{6}$/.test(text)) throw Error('Choose a 6-digit profile PIN.');
  return text;
}
async function pinHash(value, salt) {
  return (await scrypt(pin(value), salt, 64)).toString('hex');
}
function signToken(key, secret, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ scope: 'kendra-profile', storeKey: key, exp: now + 7 * 86400000 })
  ).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
function verifyToken(token, secret, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !secret) throw Error('Please sign in to your Kendra profile.');
  const [payload, sig] = parts,
    expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    throw Error('Please sign in to your Kendra profile.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (
    data.scope !== 'kendra-profile' ||
    !data.storeKey ||
    !Number.isFinite(data.exp) ||
    data.exp < now
  )
    throw Error('Profile session expired. Please sign in again.');
  return data.storeKey;
}
function profileVersion(row) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([row.mobile, row.profile]))
    .digest('hex');
}
function publicProfile(row) {
  return {
    ...JSON.parse(row.profile),
    storeCode: row.store_code,
    mobile: row.mobile,
    updatedAt: row.updated_at,
  };
}
async function forOrder(db, token, store, mobile) {
  if (!token) return null;
  const key = verifyToken(token, process.env.STOCK_UPLOAD_PASSWORD);
  if (storeKey(store) !== key) throw Error('Store Code does not match your signed-in profile.');
  const pool = await db.getPool();
  await setup(pool);
  await require('./pin-recovery').checkSession(pool, key, token);
  const [rows] = await pool.query('SELECT * FROM kendra_profiles WHERE store_key=?', [key]);
  if (!rows.length || rows[0].mobile !== mobile)
    throw Error(
      'Mobile number does not match your saved profile. Update your profile or sign out.'
    );
  return publicProfile(rows[0]);
}
function demandFields(body) {
  const id = String(body?.requestId || ''),
    code = String(body?.code || '').trim(),
    medicine = String(body?.medicine || '').trim(),
    note = String(body?.note || '').trim(),
    quantity = Number(body?.quantity);
  if (
    !/^[a-f0-9-]{36}$/i.test(id) ||
    code.length > 100 ||
    !medicine ||
    medicine.length > 500 ||
    note.length > 1000 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000000
  )
    throw Error('Enter a medicine name and a whole quantity between 1 and 1000000.');
  return { id, code, medicine, note, quantity };
}
function register(app, { db, stockAuth }) {
  const safe = (fn) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await fn(req, res);
    } catch (e) {
      console.error('[kendra]', e.message);
      res.status(e.status || (e.code ? 503 : 400)).json({
        ok: false,
        message:
          e.status === 503 || (e.code && !e.status) ? 'Please try again shortly.' : e.message,
      });
    }
  };
  app.get(
    '/api/kendra/store-code-check',
    safe(async (req, res) => {
      const code = String(req.query.storeCode || '').trim();
      if (!/^[0-9]{1,40}$/.test(code) || !storeKey(code)) throw Error('Enter a valid Store Code.');
      const pool = await db.getPool();
      await setup(pool);
      const [rows] = await pool.query(
        'SELECT store_code FROM kendra_profiles WHERE store_key=? LIMIT 1',
        [storeKey(code)]
      );
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, available: rows.length === 0 });
    })
  );
  const keyFrom = async (req) => {
    try {
      const key = verifyToken(
        String(req.headers.authorization || '').replace(/^Bearer /i, ''),
        process.env.STOCK_UPLOAD_PASSWORD
      );
      await require('./pin-recovery').checkSession(
        await db.getPool(),
        key,
        String(req.headers.authorization || '').replace(/^Bearer /i, '')
      );
      return key;
    } catch (e) {
      e.status = 401;
      throw e;
    }
  };
  async function attempt(pool, key, ip) {
    const hash = crypto
      .createHash('sha256')
      .update(key + '|' + ip)
      .digest('hex');
    await pool.query(
      'INSERT INTO kendra_login_limits (attempt_key) VALUES (?) ON DUPLICATE KEY UPDATE attempts=IF(started_at < NOW()-INTERVAL 15 MINUTE,0,attempts),started_at=IF(started_at < NOW()-INTERVAL 15 MINUTE,NOW(),started_at)',
      [hash]
    );
    await pool.query('UPDATE kendra_login_limits SET attempts=attempts+1 WHERE attempt_key=?', [
      hash,
    ]);
    const [rows] = await pool.query(
      'SELECT attempts FROM kendra_login_limits WHERE attempt_key=?',
      [hash]
    );
    if (rows[0].attempts > 10) {
      const e = Error('Too many attempts. Please try again after 15 minutes.');
      e.status = 429;
      throw e;
    }
    return hash;
  }
  app.post(
    '/api/kendra/register',
    safe(async (req, res) => {
      if (!/^[0-9]{1,40}$/.test(String(req.body?.storeCode || '').trim()))
        throw Error('Store Code must contain digits only (0-9).');
      const profile = fields(req.body),
        value = pin(req.body.pin),
        key = storeKey(profile.storeCode),
        pool = await db.getPool();
      await setup(pool);
      await attempt(pool, key, req.ip);
      const salt = crypto.randomBytes(24).toString('hex'),
        hash = await pinHash(value, salt);
      try {
        await pool.query(
          'INSERT INTO kendra_profiles (store_key,store_code,mobile,pin_salt,pin_hash,profile) VALUES (?,?,?,?,?,?)',
          [key, profile.storeCode, profile.mobile, salt, hash, JSON.stringify(profile)]
        );
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
          e.message = 'A profile already exists for this Store Code. Please sign in.';
          e.status = 409;
        }
        throw e;
      }
      res.json({ ok: true, profile, token: signToken(key, process.env.STOCK_UPLOAD_PASSWORD) });
    })
  );
  app.post(
    '/api/kendra/login',
    safe(async (req, res) => {
      const rawCode = String(req.body?.storeCode || '').trim();
      if (rawCode && !/^[0-9]{1,40}$/.test(rawCode))
        throw Error('Store Code must contain digits only (0-9).');
      const key = storeKey(rawCode),
        mobile = String(req.body?.mobile || '').trim(),
        value = pin(req.body?.pin);
      if ((!key && !mobile) || key.length > 40 || (mobile && !/^\d{10}$/.test(mobile)))
        throw Error('Enter either Store Code or a 10-digit mobile number, plus your profile PIN.');
      const pool = await db.getPool();
      await setup(pool);
      const rateKey = await attempt(pool, key || 'mobile:' + mobile, req.ip),
        [rows] = key
          ? await pool.query('SELECT * FROM kendra_profiles WHERE store_key=?', [key])
          : await pool.query('SELECT * FROM kendra_profiles WHERE mobile=? LIMIT 2', [mobile]);
      if (!key && rows.length > 1)
        throw Error(
          'This mobile has multiple Kendra profiles. Enter your Store Code to choose the correct profile.'
        );
      const salt = rows[0]?.pin_salt || 'no-profile',
        hash = await pinHash(value, salt),
        expected = rows[0]?.pin_hash || '0'.repeat(128);
      if (
        !rows.length ||
        (mobile && rows[0].mobile !== mobile) ||
        !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected))
      ) {
        const e = Error('Store Code, mobile or profile PIN is incorrect.');
        e.status = 401;
        throw e;
      }
      await pool.query('DELETE FROM kendra_login_limits WHERE attempt_key=?', [rateKey]);
      res.json({
        ok: true,
        profile: publicProfile(rows[0]),
        token: signToken(rows[0].store_key, process.env.STOCK_UPLOAD_PASSWORD),
      });
    })
  );
  app.get(
    '/api/kendra/profile',
    safe(async (req, res) => {
      const key = await keyFrom(req),
        pool = await db.getPool();
      await setup(pool);
      const [rows] = await pool.query('SELECT * FROM kendra_profiles WHERE store_key=?', [key]);
      if (!rows.length) {
        const e = Error('Profile not found. Please sign in again.');
        e.status = 401;
        throw e;
      }
      res.json({ ok: true, profile: publicProfile(rows[0]) });
    })
  );
  app.put(
    '/api/kendra/profile',
    safe(async (req, res) => {
      const key = await keyFrom(req),
        profile = fields(req.body);
      if (storeKey(profile.storeCode) !== key) throw Error('Store Code cannot be changed.');
      const pool = await db.getPool();
      await setup(pool);
      const [updated] = await pool.query(
        'UPDATE kendra_profiles SET mobile=?,profile=? WHERE store_key=?',
        [profile.mobile, JSON.stringify(profile), key]
      );
      if (!updated.affectedRows) {
        const [exists] = await pool.query(
          'SELECT store_key FROM kendra_profiles WHERE store_key=?',
          [key]
        );
        if (!exists.length) throw Error('Profile not found.');
      }
      res.json({ ok: true, profile });
    })
  );
  app.get(
    '/api/stock/unavailable',
    safe(async (req, res) => {
      const pool = await db.getPool();
      await require('./performance-store').ensureRows(pool);
      const q = String(req.query.q || '')
          .trim()
          .slice(0, 100),
        [rows] = await pool.query(
          'SELECT code,MAX(name) AS name,SUM(available) AS quantity FROM stock_records GROUP BY code'
        );
      res.json({ ok: true, medicines: require('./medicine-search').search(rows, q) });
    })
  );
  app.post(
    '/api/kendra/demands',
    safe(async (req, res) => {
      const key = await keyFrom(req),
        d = demandFields(req.body),
        pool = await db.getPool();
      await setup(pool);
      const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify([key, d.code, d.medicine, d.quantity, d.note]))
        .digest('hex');
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [existing] = await c.query(
          'SELECT store_key,request_hash FROM medicine_demands WHERE id=? FOR UPDATE',
          [d.id]
        );
        if (existing.length) {
          if (existing[0].store_key !== key || existing[0].request_hash !== hash)
            throw Error('Request changed. Please submit again.');
          await c.commit();
          return res.json({ ok: true, id: d.id, message: 'This demand is already registered.' });
        }
        if (d.code) {
          const [stock] = await c.query('SELECT payload FROM stock_snapshot WHERE id=1');
          const items = stock.length ? JSON.parse(stock[0].payload).items : [];
          const available = items
            .filter((row) => String(row.code) === d.code)
            .reduce((sum, row) => sum + (Number(row.available) || 0), 0);
          if (available > 0)
            throw Error('This medicine is available now. Add it from the Stock Directory.');
        }
        const [limited] = await c.query(
          'SELECT COUNT(*) AS total FROM medicine_demands WHERE store_key=? AND created_at > NOW()-INTERVAL 1 HOUR',
          [key]
        );
        if (Number(limited[0].total) >= 30)
          throw Error('Please try again later. You have reached the hourly demand limit.');
        await c.query(
          'INSERT INTO medicine_demands (id,store_key,code,medicine,quantity,note,request_hash) VALUES (?,?,?,?,?,?,?)',
          [d.id, key, d.code, d.medicine, d.quantity, d.note, hash]
        );
        await c.query('INSERT INTO demand_events (demand_id,status,note,actor) VALUES (?,?,?,?)', [
          d.id,
          'New',
          d.note,
          'Kendra',
        ]);
        await c.commit();
        res.json({
          ok: true,
          id: d.id,
          message: 'Demand registered. This is not an order and no stock has been reserved.',
        });
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    })
  );
  app.get(
    '/api/kendra/demands',
    safe(async (req, res) => {
      const key = await keyFrom(req),
        pool = await db.getPool();
      await setup(pool);
      const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page) || 1)));
      const [count] = await pool.query(
        'SELECT COUNT(*) AS total FROM medicine_demands WHERE store_key=?',
        [key]
      );
      const [demands] = await pool.query(
        'SELECT id,code,medicine,quantity,note,status,admin_note,created_at,updated_at FROM medicine_demands WHERE store_key=? ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?',
        [key, (page - 1) * 20]
      );
      res.json({ ok: true, demands, total: Number(count[0].total), page });
    })
  );
  app.get(
    '/api/admin/kendras',
    stockAuth,
    safe(async (req, res) => {
      const pool = await db.getPool();
      await setup(pool);
      const q = String(req.query.q || '').trim().slice(0, 100),
        requestedPage = Math.max(1, Math.floor(Number(req.query.page) || 1)),
        size = [10, 20, 50, 100, 200].includes(Number(req.query.size)) ? Number(req.query.size) : 20;
      const [count] = await pool.query(
        "SELECT COUNT(*) AS total FROM kendra_profiles WHERE LOCATE(LOWER(?),LOWER(CONCAT(store_code,' ',mobile,' ',profile)))>0",
        [q]
      );
      const total = Number(count[0].total), pages = Math.max(1, Math.ceil(total / size)),
        page = Math.min(requestedPage, pages);
      const jsonField = key => "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(profile, '$." + key + "')), '')";
      const sortFields = {
        store: 'store_code', contact: jsonField('contactName'), mobile: 'mobile',
        address: "CONCAT_WS(', ', " + ['address','city','state','pincode'].map(jsonField).join(', ') + ')',
        gst: jsonField('gst'), dl20: jsonField('dlForm20'), dl21: jsonField('dlForm21'),
      };
      const sort = Object.hasOwn(sortFields, req.query.sort) ? req.query.sort : '';
      const direction = req.query.direction === 'desc' ? 'DESC' : 'ASC';
      const order = sort ? sortFields[sort] + ' ' + direction + ', store_code ASC' : 'updated_at DESC,store_code ASC';
      const [rows] = await pool.query(
        "SELECT store_code,mobile,profile,updated_at FROM kendra_profiles WHERE LOCATE(LOWER(?),LOWER(CONCAT(store_code,' ',mobile,' ',profile)))>0 ORDER BY " + order + ' LIMIT ? OFFSET ?',
        [q, size, (page - 1) * size]
      );
      res.json({
        ok: true,
        profiles: rows.map((row) => ({ ...publicProfile(row), editVersion: profileVersion(row) })),
        total,
        page,
        size,
        pages,
      });
    })
  );
  app.put(
    '/api/admin/kendras/:storeCode',
    stockAuth,
    safe(async (req, res) => {
      const key = storeKey(req.params.storeCode),
        profile = fields(req.body);
      if (storeKey(profile.storeCode) !== key) throw Error('Store Code cannot be changed here.');
      const pool = await db.getPool();
      await setup(pool);
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [rows] = await c.query('SELECT * FROM kendra_profiles WHERE store_key=? FOR UPDATE', [
          key,
        ]);
        if (!rows.length) {
          const e = Error('Profile not found. Refresh the list.');
          e.status = 404;
          throw e;
        }
        const row = rows[0];
        if (req.body.editVersion !== profileVersion(row)) {
          const e = Error('This profile was updated elsewhere. Refresh the list and edit again.');
          e.status = 409;
          throw e;
        }
        profile.storeCode = row.store_code;
        await c.query('UPDATE kendra_profiles SET mobile=?,profile=? WHERE store_key=?', [
          profile.mobile,
          JSON.stringify(profile),
          key,
        ]);
        await c.query(
          'INSERT INTO kendra_profile_events (store_key,actor,before_profile,after_profile) VALUES (?,?,?,?)',
          [
            key,
            req.adminUser || 'Admin',
            JSON.stringify(publicProfile(row)),
            JSON.stringify(profile),
          ]
        );
        await c.commit();
        res.json({ ok: true, message: 'Kendra profile updated.', profile });
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    })
  );
  app.post(
    '/api/admin/kendras/:storeCode/store-code',
    stockAuth,
    safe(async (req, res) => {
      const oldKey = storeKey(req.params.storeCode),
        newCode = String(req.body.storeCode || '').trim(),
        newKey = storeKey(newCode);
      if (!/^[0-9]{1,40}$/.test(newCode) || !newKey)
        throw Error('Enter a different valid Store Code.');
      const pool = await db.getPool();
      await setup(pool);
      await require('./pin-recovery').setup(pool);
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [rows] = await c.query('SELECT * FROM kendra_profiles WHERE store_key=? FOR UPDATE', [
          oldKey,
        ]);
        if (!rows.length) throw Error('Profile not found. Refresh the list.');
        const row = rows[0];
        if (req.body.editVersion !== profileVersion(row))
          throw Error('Profile changed. Refresh before correcting Store Code.');
        const [target] = await c.query(
          'SELECT * FROM kendra_profiles WHERE store_key=? FOR UPDATE',
          [newKey]
        );
        if (newKey !== oldKey && target.length)
          throw Error('A profile already exists for the new Store Code.');
        const before = publicProfile(row),
          profile =
            req.body.contactName !== undefined
              ? fields(req.body)
              : { ...JSON.parse(row.profile), storeCode: newCode };
        if (req.body.contactName !== undefined) {
          await c.query('UPDATE kendra_profiles SET mobile=?,profile=? WHERE store_key=?', [
            profile.mobile,
            JSON.stringify(profile),
            oldKey,
          ]);
        }
        await c.query(
          'UPDATE kendra_profiles SET store_key=?,store_code=?,profile=? WHERE store_key=?',
          [newKey, newCode, JSON.stringify(profile), oldKey]
        );
        await c.query('UPDATE medicine_demands SET store_key=? WHERE store_key=?', [
          newKey,
          oldKey,
        ]);
        await c.query('UPDATE kendra_profile_events SET store_key=? WHERE store_key=?', [
          newKey,
          oldKey,
        ]);
        await c.query('DELETE FROM kendra_pin_recovery WHERE store_key=?', [newKey]);
        await c.query(
          'INSERT INTO kendra_pin_recovery (store_key,code_hash,revoked_before) VALUES (?,NULL,?) ON DUPLICATE KEY UPDATE code_hash=NULL,revoked_before=VALUES(revoked_before)',
          [oldKey, Date.now()]
        );
        await c.query(
          'INSERT INTO kendra_profile_events (store_key,actor,before_profile,after_profile) VALUES (?,?,?,?)',
          [
            newKey,
            req.adminUser || 'Admin',
            JSON.stringify(before),
            JSON.stringify({ ...profile, storeCode: newCode }),
          ]
        );
        await c.commit();
        res.json({
          ok: true,
          message: 'Store Code corrected.',
          profile: { ...before, storeCode: newCode },
        });
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    })
  );
  app.get(
    '/api/admin/demands',
    stockAuth,
    safe(async (req, res) => {
      const pool = await db.getPool();
      await setup(pool);
      const q = String(req.query.q || '')
          .trim()
          .slice(0, 100),
        status = STATUSES.includes(req.query.status) ? req.query.status : '',
        requestedPage = Math.max(1, Math.floor(Number(req.query.page) || 1)),
        size = [10, 20, 50, 100, 200].includes(Number(req.query.size)) ? Number(req.query.size) : 20;
      const where =
          " WHERE (?='' OR d.status=?) AND LOCATE(LOWER(?),LOWER(CONCAT(d.code,' ',d.medicine,' ',p.store_code)))>0",
        args = [status, status, q];
      const [count] = await pool.query(
        'SELECT COUNT(*) AS total FROM medicine_demands d JOIN kendra_profiles p ON p.store_key=d.store_key' +
          where,
        args
      );
      const total = Number(count[0].total), pages = Math.max(1, Math.ceil(total / size)),
        page = Math.min(requestedPage, pages);
      const [rows] = await pool.query(
        'SELECT d.id,d.code,d.medicine,d.quantity,d.note,d.status,d.admin_note,d.created_at,p.store_code,p.mobile,p.profile FROM medicine_demands d JOIN kendra_profiles p ON p.store_key=d.store_key' +
          where +
          ' ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?',
        [...args, size, (page - 1) * size]
      );
      res.json({
        ok: true,
        demands: rows.map((row) => ({ ...row, profile: JSON.parse(row.profile) })),
        total,
        page,
        size,
        pages,
        statuses: STATUSES,
      });
    })
  );
  app.post(
    '/api/admin/demands/:id/status',
    stockAuth,
    safe(async (req, res) => {
      const status = String(req.body.status || ''),
        note = String(req.body.note || '').trim();
      if (!STATUSES.includes(status) || note.length > 1000)
        throw Error('Choose a valid demand status.');
      const pool = await db.getPool();
      await setup(pool);
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [rows] = await c.query(
          'SELECT status,admin_note FROM medicine_demands WHERE id=? FOR UPDATE',
          [req.params.id]
        );
        if (!rows.length) throw Error('Demand not found.');
        if (rows[0].status === 'Closed' && status !== 'Closed')
          throw Error('Closed demand cannot be reopened.');
        if (rows[0].status !== status || (rows[0].admin_note || '') !== note) {
          await c.query('UPDATE medicine_demands SET status=?,admin_note=? WHERE id=?', [
            status,
            note,
            req.params.id,
          ]);
          await c.query(
            'INSERT INTO demand_events (demand_id,status,note,actor) VALUES (?,?,?,?)',
            [req.params.id, status, note, req.adminUser || 'Admin']
          );
        }
        await c.commit();
        res.json({ ok: true });
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    })
  );
}
module.exports = {
  setup,
  storeKey,
  fields,
  pinHash,
  signToken,
  verifyToken,
  publicProfile,
  profileVersion,
  forOrder,
  demandFields,
  register,
};
