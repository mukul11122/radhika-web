const { chromium } = require('@playwright/test'),
  express = require('express'),
  assert = require('assert/strict'),
  ExcelJS = require('exceljs');
(async () => {
  const app = express();
  app.use(express.static(process.cwd()));
  const server = app.listen(0);
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const p = await b.newPage({ acceptDownloads: true });
    const base = 'http://localhost:' + server.address().port;
    let submitted;
    await p.route('**/api/**', async (r) => {
      const url = r.request().url();
      let out = { ok: true };
      if (url.endsWith('/api/stock'))
        out = {
          ok: true,
          version: 'v1',
          items: [
            {
              id: '1',
              code: '1',
              name: 'Test medicine',
              uom: "10's",
              batch: 'A',
              expiry: '2028-01-31',
              available: 5,
              salesRate: 10,
              mrp: 12,
            },
          ],
        };
      if (url.includes('/stock/submit')) {
        submitted = r.request().postDataJSON();
        out = { ok: false, message: 'Test intercepted' };
      }
      await r.fulfill({ json: out });
    });
    await p.goto(base + '/stock.html');
    await p.locator('[data-qty]').first().waitFor();
    await p.locator('#order-import-file').setInputFiles({
      name: 'order.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('DC,Order QTY\n1,10\n99,20'),
    });
    await p.locator('#stock-cart[open]').waitFor();
    await p.reload();
    await p.locator('[data-qty]').first().waitFor();
    await p.locator('#cart-open').click();
    await p.locator('#order-store').fill('123');
    await p.locator('#order-mobile').fill('9000000000');
    await p.locator('#cart-download').click();
    await p.waitForFunction(() =>
      document.querySelector('#cart-message').textContent.includes('Test intercepted')
    );
    assert.equal(submitted.unavailableItems.length, 2);
    assert.equal(submitted.unavailableItems[0].quantity, 5);
    await p.unroute('**/api/**');
    await p.route('**/api/**', async (r) => {
      const u = r.request().url();
      let out = { ok: true, orders: [], total: 0, page: 1 };
      if (u.includes('/stock/login'))
        out.token =
          Buffer.from(
            JSON.stringify({ scope: 'stock-upload-login', exp: Date.now() + 1800000 })
          ).toString('base64url') + '.fixture';
      if (u.includes('/admin/orders?'))
        out = {
          ok: true,
          orders: [
            {
              ...submitted,
              id: submitted.requestId,
              created_at: new Date().toISOString(),
              status: 'New',
              sent: [],
            },
          ],
          total: 1,
          page: 1,
          stats: [],
        };
      await r.fulfill({ json: out });
    });
    await p.goto(base + '/admin-orders.html');
    await p.locator('[name=username]').fill('test');
    await p.locator('[name=password]').fill('test');
    await p.locator('#login-button').click();
    await p.locator('[data-admin-view=orders]').click();
    const button = p.locator('[data-order-unavailable]');
    await button.waitFor();
    const [download] = await Promise.all([p.waitForEvent('download'), button.click()]);
    assert(download.suggestedFilename().startsWith('Not-Available-'));
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(await download.path());
    assert.equal(book.worksheets[0].getCell('D7').value, 5);
    assert.equal(book.worksheets[0].getCell('A8').value, '99');
    console.log(
      'Import, reload persistence, submission metadata and admin Not Available Excel download passed. No live data changed.'
    );
  } finally {
    await b.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
