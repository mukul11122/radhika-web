const { chromium } = require('@playwright/test'),
  express = require('express'),
  assert = require('node:assert/strict');
(async () => {
  const app = express();
  app.use(express.static(process.cwd()));
  const server = app.listen(0),
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let entries = [];
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url()),
          method = route.request().method();
        let data = { ok: true, orders: [], stats: [], total: 0 };
        if (url.pathname === '/api/employee/login')
          data = { ok: true, token: 'test-token', name: 'Test Employee' };
        else if (url.pathname === '/api/employee/report' && method === 'GET')
          data = { ok: true, name: 'Test Employee', entries };
        else if (url.pathname === '/api/employee/report' && method === 'POST') {
          entries = route.request().postDataJSON().entries;
          data = { ok: true, message: 'Daily report saved.' };
        } else if (url.pathname === '/api/stock/login')
          data.token =
            Buffer.from(
              JSON.stringify({ scope: 'stock-upload-login', exp: Date.now() + 1800000 })
            ).toString('base64url') + '.fixture';
        else if (url.pathname === '/api/admin/employees')
          data = {
            ok: true,
            employees: [{ id: 'test-id', name: 'Test Employee', username: 'employee1', active: 1 }],
          };
        else if (url.pathname === '/api/admin/employee-progress') {
          const date = url.searchParams.get('date');
          const day = new Date(date + 'T00:00:00Z');
          day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
          data = {
            ok: true,
            date,
            weekStart: day.toISOString().slice(0, 10),
            monthStart: date.slice(0, 8) + '01',
            reports: [
              {
                date,
                name: 'Test Employee',
                username: 'employee1',
                counts: { challan: 2, packing: 3, invoice: 1 },
              },
            ],
          };
        } else if (url.pathname === '/api/admin/employee-reports')
          data = {
            ok: true,
            reports: [
              {
                name: 'Test Employee',
                username: 'employee1',
                entries: [{ storeCode: '02533', challan: 2, packing: 3, invoice: 1 }],
              },
            ],
          };
        await route.fulfill({ json: data });
      });
      let base = 'http://127.0.0.1:' + server.address().port;
      await page.goto(base + '/employee.html');
      await page.locator('#login-form [name=username]').fill('employee1');
      await page.locator('#login-form [name=password]').fill('testpassword');
      await page.locator('#login-form button[type=submit]').click();
      await page.locator('#report-section').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[name=challan]').inputValue(), '');
      assert.equal(
        await page.locator('[name=challan]').getAttribute('placeholder'),
        'Enter challan count'
      );
      await page.locator('[name=challan]').focus();
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.locator('[name=challan]').inputValue(), '');
      await page.screenshot({
        path: '../maintenance/qa/employee-report-' + width + '.png',
        fullPage: true,
      });
      await page.locator('[name=storeCode]').fill('02533');
      await page.locator('[name=challan]').fill('2');
      await page.locator('[name=packing]').fill('3');
      await page.locator('[name=invoice]').fill('1');
      assert.equal(await page.locator('#total-packing').textContent(), '3');
      await page.locator('[data-summary="challan"]').click();
      assert.match(await page.locator('#summary-details').innerText(), /Store 02533/);
      assert.equal(await page.locator('.summary-detail-row strong').innerText(), '2');
      await page.locator('[data-summary="packing"]').click();
      assert.equal(await page.locator('.summary-detail-row strong').innerText(), '3');
      await page.locator('[name=packing]').fill('4');
      assert.equal(await page.locator('.summary-detail-row strong').innerText(), '4');
      await page.locator('[data-summary="invoice"]').click();
      assert.equal(await page.locator('.summary-detail-row strong').innerText(), '1');
      await page.locator('#summary-close').click();
      assert.equal(await page.locator('#summary-details').isVisible(), false);
      await page.locator('#save-report').click();
      await page.locator('#message').filter({ hasText: 'Daily report saved.' }).waitFor();
      assert.equal(entries[0].storeCode, '02533');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true
      );
      await page.goto(base + '/admin-orders.html');
      await page.locator('#login-form [name=username]').fill('test');
      await page.locator('#login-form [name=password]').fill('test');
      await page.locator('#login-button').click();
      await page.locator('[data-admin-view=employee-accounts]').click();
      await page.locator('#admin-view-employee-accounts').waitFor({ state: 'visible' });
      await page.getByText('Test Employee', { exact: true }).waitFor();
      assert.equal(await page.locator('#admin-view-employees').isVisible(), false);
      await page.locator('[data-admin-view=employees]').click();
      assert.equal(await page.locator('#admin-view-employee-accounts').isVisible(), false);
      await page.getByRole('heading', { name: 'Daily reports' }).waitFor();
      await page.getByText('02533', { exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Daily progress' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Weekly progress' }).count(), 1);
      assert.equal(await page.getByRole('heading', { name: 'Monthly progress' }).count(), 1);
      assert.equal(await page.getByRole('img', { name: /Selected date: Challans 2/ }).count(), 1);
      await page.screenshot({
        path: '../maintenance/qa/employee-admin-' + width + '.png',
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Employee report and admin review passed on desktop and mobile.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
