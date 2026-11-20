const { chromium } = require('@playwright/test');
const assert = require('assert'),
  fs = require('fs'),
  path = require('path');
(async () => {
  const base = process.env.TEST_BASE_URL;
  if (!base) throw Error('TEST_BASE_URL required');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/stock/submit', (route) => route.abort());
  try {
    await page.goto(base + '/stock.html');
    await page.waitForFunction(() => !document.getElementById('order-import').disabled, {
      timeout: 30000,
    });
    await page.locator('#stock-search').fill('Aceclofenac');
    await page.waitForTimeout(400);
    assert((await page.locator('tbody tr').count()) > 0);
    await page.locator('#order-import-file').setInputFiles({
      name: 'mobile-test.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('DC,Order QTY\n1,1\n'),
    });
    await page.locator('#stock-cart').waitFor({ state: 'visible', timeout: 15000 });
    assert((await page.locator('#cart-count').textContent()).trim() !== '0');
    await page.locator('#cart-close').click();
    await page.goto(base + '/admin-orders.html');
    await page.locator('[name=username]').fill('mukul');
    await page.locator('[name=password]').fill(process.env.ADMIN_TEST_PASSWORD);
    await page.locator('#login-button').click();
    await page.locator('#panel').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#dashboard-order-counts table').waitFor({ timeout: 30000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 392);
    assert(!overflow, 'admin page should fit mobile viewport');
    await page.locator('[data-admin-view=alerts]').click();
    await page.locator('[data-alert-search=lowStock]').waitFor({ timeout: 30000 });
    await page.locator('[data-alert-search=lowStock] input').fill('missing-qa-record');
    await page.locator('[data-alert-search=lowStock] button[type=submit]').click();
    await page
      .getByText('No matching medicines found.', { exact: true })
      .waitFor({ timeout: 30000 });
    await page.locator('[data-admin-view=orders]').click();
    await page.locator('[data-order-history]').first().click();
    await page.locator('[data-order-history-content] table').first().waitFor({ timeout: 15000 });
    await page.locator('[data-admin-view=operations]').click();
    await page.getByRole('heading', { name: 'Backups', exact: true }).waitFor({ timeout: 30000 });
    const dir = path.resolve('..', 'maintenance', 'qa');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'operations-mobile.png'), fullPage: true });
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.locator('#login-card').waitFor({ state: 'visible' });
    console.log(
      'Mobile stock search/import review, admin layout, alert search, audit history, operations and strict exit lock passed. No order submitted.'
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
