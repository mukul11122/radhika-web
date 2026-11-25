#!/usr/bin/env node
// Pull current Sales Rate + MRP from the DPOS MedicineMaster table and push
// them to the live site via POST /api/admin/stock/update-prices.
//
// The site (Vercel) cannot reach the DPOS SQL Server, so this script runs on
// this machine, reads DPOS, then uploads the prices using the stock password.
//
// Usage:
//   node tools/update-prices-from-dpos.js            # push prices
//   node tools/update-prices-from-dpos.js --dry-run  # show diff only
//
// Env (optional overrides):
//   DPOS_SERVER / DPOS_USER / DPOS_PASSWORD / DPOS_DATABASE
//   STOCK_SITE_URL   (default https://www.radhikaagencies.com)
//   STOCK_UPLOAD_PASSWORD  (or provided by .env.vercel / tools/.env)
const fs = require('fs');
const path = require('path');
const mssql = require('mssql');

const DPOS = {
  server: process.env.DPOS_SERVER || 'Desktop-nuquaav',
  user: process.env.DPOS_USER || 'sa',
  password: process.env.DPOS_PASSWORD || '123',
  database: process.env.DPOS_DATABASE || 'DPOS',
  options: { trustServerCertificate: true },
  requestTimeout: 60000,
  connectionTimeout: 15000,
};
const SITE = process.env.STOCK_SITE_URL || 'https://www.radhikaagencies.com';
const DRY_RUN = process.argv.includes('--dry-run');
const round = (v) => Math.round(Number(v) * 1000) / 1000;

function loadPassword() {
  if (process.env.STOCK_UPLOAD_PASSWORD) return process.env.STOCK_UPLOAD_PASSWORD;
  for (const file of [
    path.join(__dirname, '..', '.env.vercel'),
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
  ]) {
    if (!fs.existsSync(file)) continue;
    const line = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('STOCK_UPLOAD_PASSWORD='));
    const value = line
      .slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    // Vercel redacts "sensitive" variables in pulled env files.
    if (value && value !== '[SENSITIVE]') return value;
  }
  return null;
}

async function fetchDposPrices() {
  const pool = await new mssql.ConnectionPool(DPOS).connect();
  const { recordset } = await pool
    .request()
    .query('SELECT Mm_Code, Mm_SaleRate, Mm_MRP FROM MedicineMaster');
  await pool.close();
  const prices = new Map();
  let skippedBad = 0;
  for (const row of recordset) {
    const code = String(row.Mm_Code || '').trim();
    const mrp = round(row.Mm_MRP),
      rate = round(row.Mm_SaleRate);
    if (!code || !Number.isFinite(mrp) || !Number.isFinite(rate)) continue;
    if (mrp < 0 || rate < 0 || rate > mrp + 0.001) {
      skippedBad++;
      continue;
    }
    prices.set(code, { mrp, salesRate: rate });
  }
  return { prices, skippedBad, total: recordset.length };
}

async function fetchSiteStock() {
  const items = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(SITE + '/api/stock?offset=' + offset, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || 'Site stock request failed.');
    items.push(...(j.items || []));
    if (!j.nextOffset) break;
    offset = j.nextOffset;
    if (items.length > 20000) throw new Error('Site stock unexpectedly large.');
  }
  return items;
}

async function login(password) {
  const r = await fetch(SITE + '/api/stock/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'mukul', password }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.message || 'Stock login failed.');
  return j.token;
}

(async () => {
  console.log('Reading DPOS MedicineMaster from', DPOS.server + '/' + DPOS.database + '…');
  const { prices, skippedBad, total } = await fetchDposPrices();
  console.log('DPOS medicines:', prices.size, skippedBad ? '| skipped bad rates: ' + skippedBad : '');
  if (!prices.size) throw new Error('No usable DPOS prices found.');

  console.log('Reading live stock from', SITE + '…');
  const stock = await fetchSiteStock();
  const codes = new Set(stock.map((r) => String(r.code).trim()));
  console.log('Site stock rows:', stock.length, '| distinct codes:', codes.size);

  const byCode = new Map();
  for (const r of stock) byCode.set(String(r.code).trim(), r);
  let changedCodes = 0,
    changedRows = 0,
    missing = 0;
  const samples = [];
  for (const [code, row] of byCode) {
    const p = prices.get(code);
    if (!p) {
      missing++;
      continue;
    }
    const mrpDiff = Math.abs(Number(row.mrp) - p.mrp) > 0.001;
    const rateDiff = Math.abs(Number(row.salesRate) - p.salesRate) > 0.001;
    if (!mrpDiff && !rateDiff) continue;
    changedCodes++;
    const rows = stock.filter((r) => String(r.code).trim() === code);
    changedRows += rows.length;
    if (samples.length < 8)
      samples.push({
        code,
        name: String(row.name).slice(0, 40),
        site: { mrp: row.mrp, salesRate: row.salesRate },
        dpos: p,
      });
  }
  console.log(
    '\nCodes needing update:',
    changedCodes,
    '| rows affected:',
    changedRows,
    '| site codes missing from DPOS:',
    missing
  );
  if (samples.length) {
    console.log('\nSamples:');
    for (const s of samples) console.log(' ', JSON.stringify(s));
  }
  if (DRY_RUN) {
    console.log('\nDry run - nothing pushed.');
    return;
  }
  if (!changedCodes) {
    console.log('\nNothing to update. Site already matches DPOS.');
    return;
  }

  const password = loadPassword();
  if (!password)
    throw new Error(
      'STOCK_UPLOAD_PASSWORD not found. Run `vercel env pull .env.vercel` in the repo root.'
    );
  const token = await login(password);
  const payload = {};
  for (const code of codes) if (prices.has(code)) payload[code] = prices.get(code);
  console.log('\nPushing', Object.keys(payload).length, 'medicine prices…');
  const r = await fetch(SITE + '/api/admin/stock/update-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ prices: payload }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.message || 'Price update failed.');
  console.log('Done:', j.message || JSON.stringify(j));
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
