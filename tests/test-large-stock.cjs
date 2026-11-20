const assert = require('assert/strict'),
  path = require('path');
const root = path.join(__dirname, '..');
const express = require(path.join(root, 'node_modules/express'));
const parser = require(path.join(root, 'lib/stock'));
const { register, MAX, CHUNK } = require(path.join(root, 'lib/stock-large-upload'));
(async () => {
  const csv =
    'Drug Code,Drug Name,QTY\n' +
    Array.from({ length: 6001 }, (_, i) => `${i},Medicine ${i},10`).join('\n');
  assert.equal((await parser.parseStock(Buffer.from(csv), 'stock.csv')).length, 6001);
  let session,
    chunks = new Map(),
    published = null,
    commits = 0;
  const query = async (sql, args) => {
    if (sql.startsWith('INSERT INTO stock_upload_sessions'))
      session = { id: args[0], filename: args[1], size: args[2], completed: 0 };
    if (sql.startsWith('SELECT size,completed') || sql.startsWith('SELECT filename,size'))
      return [[session]];
    if (sql.startsWith('INSERT INTO stock_upload_chunks')) chunks.set(args[1], args[2]);
    if (sql.startsWith('SELECT part,data'))
      return [[...chunks].sort((a, b) => a[0] - b[0]).map(([part, data]) => ({ part, data }))];
    if (sql.startsWith('INSERT INTO stock_snapshot')) published = JSON.parse(args[0]);
    if (sql.startsWith('UPDATE stock_upload_sessions')) session.completed = 1;
    if (sql.startsWith('DELETE FROM stock_upload_chunks')) chunks.clear();
    return [{}];
  };
  const connection = {
    query,
    beginTransaction: async () => {},
    commit: async () => commits++,
    rollback: async () => {},
    release() {},
  };
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  register(app, {
    stockAuth: (req, res, next) => next(),
    db: { getPool: async () => ({ query, getConnection: async () => connection }) },
  });
  const server = app.listen(0),
    url = 'http://127.0.0.1:' + server.address().port + '/api/admin/stock/upload/';
  const post = (p, b) =>
    fetch(url + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    });
  const original = parser.parseStock;
  try {
    assert.equal((await post('start', { name: 'stock.csv', size: MAX + 1 })).status, 400);
    const start = await (await post('start', { name: 'stock.csv', size: MAX })).json();
    assert(start.ok);
    const bytes = Buffer.alloc(MAX, 65);
    for (let offset = 0, part = 0; offset < MAX; offset += CHUNK, part++) {
      assert.equal(
        (
          await post('part', {
            uploadId: start.uploadId,
            part,
            data: bytes.subarray(offset, offset + CHUNK).toString('base64'),
          })
        ).status,
        200
      );
    }
    parser.parseStock = async (b) => {
      assert.equal(b.length, MAX);
      assert(b.equals(bytes));
      return Array.from({ length: 6001 }, (_, i) => ({
        id: String(i),
        code: String(i),
        available: 1,
      }));
    };
    assert.equal((await post('finish', { uploadId: start.uploadId })).status, 200);
    assert.equal(published.items.length, 6001);
    assert.equal(chunks.size, 0);
    assert.equal((await post('finish', { uploadId: start.uploadId })).status, 200);
    assert.equal(commits, 2);
    console.log(
      '20 MB chunk upload, over-limit rejection, 6001-row CSV parsing, atomic publish and finish retry checks passed; no live stock changed.'
    );
  } finally {
    parser.parseStock = original;
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
