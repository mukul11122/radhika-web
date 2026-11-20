const { chromium } = require('@playwright/test'),
  assert = require('assert'),
  fs = require('fs'),
  path = require('path');
(async () => {
  const base = process.env.TEST_BASE_URL,
    browser = await chromium.launch({ channel: 'chrome', headless: true }),
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage();
  let profile = null,
    demands = [],
    submitted = null;
  const token = 'isolated-profile-token';
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/kendra/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      body = req.postDataJSON();
    let data;
    if (url.pathname === '/api/kendra/register') {
      const { pin, confirmPin, remember, ...fields } = body;
      profile = { ...fields, updatedAt: '2026-11-15T06:00:00Z' };
      data = { ok: true, profile, token };
    } else if (url.pathname === '/api/kendra/profile') data = { ok: true, profile };
    else if (url.pathname === '/api/kendra/demands' && req.method() === 'POST') {
      demands = [{ ...body, status: 'New', admin_note: '' }];
      data = {
        ok: true,
        message: 'Demand registered. This is not an order and no stock has been reserved.',
      };
    } else data = { ok: true, demands, total: demands.length, page: 1 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('**/api/stock/submit', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, message: 'Preview: no live order placed.' }),
    });
  });
  try {
    await page.goto(base + '/kendra.html#demand');
    await page.locator('#show-register').click();
    const form = page.locator('#profile-register');
    for (const [name, value] of Object.entries({
      storeCode: '123',
      mobile: '9999999999',
      kendraName: 'Mobile Test Kendra',
      contactName: 'Test Contact',
      address: 'Test delivery address',
      city: 'Dehradun',
      state: 'Uttarakhand',
      pincode: '248001',
      gst: '05AAWFR4857N1Z7',
      pin: '123456',
      confirmPin: '123456',
    }))
      await form.locator('[name=' + name + ']').fill(value);
    await form.locator('[type=submit]').click();
    await page.locator('#profile-private').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('[data-code]').length > 0);
    await page.locator('[data-code]').first().click();
    await page.locator('#demand-form [name=quantity]').fill('5');
    await page.locator('#demand-form [type=submit]').click();
    await page
      .getByText('Demand registered. This is not an order and no stock has been reserved.', {
        exact: true,
      })
      .waitFor();
    assert.equal(demands[0].quantity, '5');
    assert(!('pin' in profile));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= 392));
    const dir = path.resolve('..', 'maintenance', 'qa');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'kendra-mobile.png'), fullPage: true });
    await page.goto(base + '/stock.html');
    await page.waitForFunction(
      () =>
        document.getElementById('order-store').value === '123' &&
        document.getElementById('order-mobile').value === '9999999999'
    );
    await page.waitForFunction(() => !document.getElementById('order-import').disabled);
    await page.locator('#order-import-file').setInputFiles({
      name: 'review.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('DC,Order QTY\n1,1\n'),
    });
    await page.locator('#stock-cart').waitFor({ state: 'visible' });
    assert(
      (await page.locator('#order-profile-summary').textContent()).includes('Test delivery address')
    );
    await page.locator('#cart-download').click();
    await page.getByText('Preview: no live order placed.', { exact: true }).waitFor();
    assert.equal(submitted.profileToken, token);
    assert.equal(submitted.storeCode, '123');
    await page.goto(base + '/admin-orders.html');
    await page.locator('[name=username]').fill('mukul');
    await page.locator('[name=password]').fill(process.env.ADMIN_TEST_PASSWORD);
    await page.locator('#login-button').click();
    await page.locator('#panel').waitFor({ state: 'visible' });
    await page.locator('[data-admin-view=kendras]').click();
    await page.getByText('No matching demand requests.', { exact: true }).waitFor();
    await page.getByText('No matching Kendra profiles.', { exact: true }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= 392));
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'Mobile profile creation, PIN exclusion, demand review, remembered autofill, delivery summary and order-token attachment passed. New customer submissions were intercepted; no live profile, demand or order was created.'
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
