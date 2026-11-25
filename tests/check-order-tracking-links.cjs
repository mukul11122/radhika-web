const { chromium } = require('@playwright/test');
const express = require('express');
const assert = require('node:assert/strict');
(async () => {
  const app = express();
  app.use(express.static(process.cwd()));
  const server = app.listen(0);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const orders = ['21442', '22102', '12345'].map((storeCode, i) => ({
      id: 'order' + i,
      serialNumber: [42, 17, 9][i],
      storeCode,
      mobile: '9999999999',
      created_at: '2026-11-18T10:00:00Z',
      status: 'Dispatched',
      sent: [],
      items: [],
    }));
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      let data = { ok: true, orders: [], stats: [], total: 0 };
      if (url.pathname === '/api/stock/login')
        data.token =
          Buffer.from(
            JSON.stringify({ scope: 'stock-upload-login', exp: Date.now() + 1800000 })
          ).toString('base64url') + '.fixture';
      else if (url.pathname === '/api/admin/orders')
        data = { ok: true, orders: url.searchParams.get('page') === '2' ? [orders[0]] : orders, stats: [], total: 31 };
      else if (url.pathname === '/api/docket') {
        const couriers = {
          21442: ['OLS LOGISTICS', 'https://www.olslogistics.in/tracking'],
          22102: ['DELHIVERY&#x20;', 'https://www.delhivery.com/tracking'],
          12345: ['DTDC', 'https://www.dtdc.com/track-your-shipment/'],
        };
        const [courier, trackUrl] = couriers[url.searchParams.get('store')];
        data = {
          ok: true,
          dockets: [{ courier, docketNo: 'Z123', dispatchDate: '18/11/2026', trackUrl }],
        };
      }
      await route.fulfill({ json: data });
    });
    await page.goto('http://localhost:' + server.address().port + '/admin-orders.html');
    await page.locator('[name=username]').fill('test');
    await page.locator('[name=password]').fill('test');
    await page.locator('#login-button').click();
    await page.locator('[data-admin-view=orders]').click();
    await page.locator('[data-id="order0"] h2').waitFor();
    assert.equal(await page.locator('[data-id="order0"] h2').innerText(), 'Sr. No. 42 · Store 21442');
    assert.equal(await page.locator('[data-id="order1"] h2').innerText(), 'Sr. No. 17 · Store 22102');
    for (const [id, name, url] of [
      ['order0', 'OLS LOGISTICS', 'https://www.olslogistics.in/tracking'],
      ['order1', 'DELHIVERY', 'https://www.delhivery.com/tracking'],
      ['order2', 'DTDC', 'https://www.dtdc.com/track-your-shipment/'],
    ]) {
      const card = page.locator('[data-id="' + id + '"]');
      await card.locator('[data-order-track]').click();
      const link = card.locator('.order-tracking-result a');
      await link.waitFor();
      assert.equal(await link.innerText(), name + ' ↗');
      assert.equal(await link.getAttribute('href'), url);
      assert.equal(await link.getAttribute('target'), '_blank');
    }
    await page.locator('#next').click();
    await page.getByRole('heading', { name: 'Sr. No. 42 · Store 21442' }).waitFor();
    console.log('Courier names link to their official tracking pages.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
