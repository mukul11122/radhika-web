const { chromium } = require('@playwright/test');
const express = require('express');
const assert = require('node:assert/strict');
(async () => {
  let version = 'v1',
    available = 10,
    expiry = '2028-01-31',
    submitted = [];
  const app = express();
  app.use(express.json());
  app.get('/api/stock', (req, res) =>
    res.json({
      ok: true,
      version,
      items: [
        {
          id: version,
          code: '123',
          name: 'Test medicine',
          uom: '10 tablets',
          expiry,
          batch: 'A',
          available,
          salesRate: 5,
          mrp: 6,
        },
      ],
    })
  );
  app.post('/api/stock/submit', (req, res) => {
    submitted.push(req.body);
    res.json({ ok: true, requestId: req.body.requestId });
  });
  app.use(express.static('.'));
  const server = app.listen(0);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port + '/stock.html');
    await page.waitForSelector('[data-qty]');
    await page.locator('[data-qty]').first().fill('5');
    version = 'v2';
    await page.reload();
    await page.waitForSelector('[data-qty]');
    assert.equal(await page.locator('[data-qty]').first().inputValue(), '5');
    await page.locator('#stock-cart').evaluate((e) => e.showModal());
    await page.locator('#order-store').fill('12345');
    await page.locator('#order-mobile').fill('9876543210');
    await page.locator('#cart-download').click();
    await page.waitForFunction(() =>
      document.querySelector('#cart-message').textContent.includes('Submitted Successfully')
    );
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].stockVersion, 'v2');
    assert.equal(submitted[0].items[0].quantity, 5);
    assert.deepEqual(submitted[0].items[0].stockIds, ['v2']);
    await page.locator('#stock-cart').evaluate((e) => e.close());
    await page.locator('[data-qty]').first().fill('5');
    await page.locator('#stock-cart').evaluate((e) => e.showModal());
    available = 2;
    await page.locator('#cart-download').click();
    await page.waitForFunction(() =>
      document.querySelector('#cart-message').textContent.includes('Please review')
    );
    assert.equal(submitted.length, 1);
    assert.match(await page.locator('#cart-items').innerText(), /Only 2 available/);
    expiry = '2029-01-31';
    version = 'v3';
    await page.reload();
    await page.waitForSelector('[data-qty]');
    assert.match(await page.locator('#cart-items').innerText(), /No longer available/);
    console.log(
      'Saved list survives uploads; current batch and availability validated before submission.'
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
