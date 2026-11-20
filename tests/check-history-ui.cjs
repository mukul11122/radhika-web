const { chromium } = require('@playwright/test'),
  express = require('express'),
  assert = require('assert'),
  fs = require('fs'),
  path = require('path');
(async () => {
  const app = express();
  app.use(express.static(process.cwd()));
  const server = app.listen(0),
    base = 'http://localhost:' + server.address().port,
    browser = await chromium.launch({ channel: 'chrome', headless: true }),
    dir = path.resolve('..', 'maintenance', 'qa');
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport }),
        page = await context.newPage(),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let mode = 'orders';
      const data = {
        ok: true,
        hasMore: false,
        orders: [
          {
            id: '12345678-1234-1234-1234-123456789012',
            storeCode: '2551',
            createdAt: '2026-11-15T06:00:00Z',
            status: 'New',
            items: [
              { code: '1', name: 'Aceclofenac 100mg and Paracetamol 325mg Tablets', quantity: 20 },
              { code: '3', name: 'Pregabalin Capsules IP 75 mg', quantity: 10 },
            ],
          },
          {
            id: '87654321-1234-1234-1234-123456789012',
            storeCode: '2551',
            createdAt: '2026-11-12T06:00:00Z',
            status: 'Delivered',
            courier: 'OLS Logistics',
            docket: 'T123456',
            items: [{ code: '7', name: 'Diclofenac Gel IP 1.16%w/w', quantity: 5 }],
          },
        ],
      };
      await page.route('**/api/orders/history', async (route) => {
        await new Promise((r) => setTimeout(r, 200));
        await route.fulfill({
          status: mode === 'error' ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify(
            mode === 'error'
              ? { ok: false, message: 'Please try again.' }
              : mode === 'empty'
                ? { ok: true, orders: [], hasMore: false }
                : data
          ),
        });
      });
      await page.route('**/api/orders/repeat', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            storeCode: '2551',
            mobile: '',
            items: [{ code: '1', quantity: 20 }],
          }),
        })
      );
      await page.route('**/stock.html?repeat=1', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<p>Repeat review destination</p>' })
      );
      await page.goto(base + '/my-orders.html');
      assert(await page.getByText('Your orders, all in one place', { exact: true }).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({
        path: path.join(dir, 'my-orders-initial-' + viewport.width + '.png'),
        fullPage: true,
      });
      await page.locator('#history-store').fill('2551');
      await page.locator('#history-load').click();
      await page.getByText('Finding your orders', { exact: true }).waitFor();
      await page.locator('[data-repeat]').first().waitFor();
      assert.equal(await page.locator('.order-card').count(), 2);
      const downloaded = page.waitForEvent('download');
      await page.locator('[data-history-excel]').first().click();
      const download = await downloaded;
      const ExcelJS = require('exceljs'),
        book = new ExcelJS.Workbook();
      await book.xlsx.readFile(await download.path());
      assert.equal(book.getWorksheet('Order').getCell('A7').value, 'DC');
      assert.equal(book.getWorksheet('Order').getCell('B8').value, data.orders[0].items[0].name);
      assert.equal(
        book.getWorksheet('Order').getCell('C8').value,
        data.orders[0].items[0].quantity
      );
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({
        path: path.join(dir, 'my-orders-results-' + viewport.width + '.png'),
        fullPage: true,
      });
      mode = 'empty';
      await page.locator('#history-load').click();
      await page.getByText('No orders found', { exact: true }).waitFor();
      mode = 'error';
      await page.locator('#history-load').click();
      await page.getByText('We couldn’t load your orders', { exact: true }).waitFor();
      await page.locator('[type=reset]').click();
      assert(await page.getByText('Your orders, all in one place', { exact: true }).isVisible());
      mode = 'orders';
      await page.locator('#history-mobile').fill('9999999999');
      await page.locator('#history-load').click();
      await page.locator('[data-repeat]').first().click();
      await page.waitForURL('**/stock.html?repeat=1');
      assert(
        (await page.evaluate(() => sessionStorage.getItem('radhika-repeat-order'))).includes('2551')
      );
      assert.equal(errors.length, 0, errors.join('\n'));
      await context.close();
    }
    console.log(
      'Desktop/mobile layout, loader, Store Code/mobile searches, results, empty/error/reset states and repeat review passed. Isolated API fixtures only.'
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
