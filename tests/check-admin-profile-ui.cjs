const { chromium } = require('@playwright/test'),
  express = require('express'),
  assert = require('assert');
(async () => {
  const app = express();
  app.use(express.static(process.cwd()));
  const server = app.listen(0);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let saves = 0;
      let profile = {
        storeCode: '123',
        mobile: '9999999999',
        kendraName: 'Test Kendra',
        contactName: 'Test User',
        address: 'Test address',
        city: 'Dehradun',
        state: 'UK',
        pincode: '248001',
        gst: '',
        email: 'test@example.test',
        editVersion: 'v1',
      };
      await page.route('**/api/**', async (route) => {
        const url = route.request().url();
        let data = { ok: true, orders: [], total: 0, page: 1 };
        if (url.includes('/stock/login'))
          data.token =
            Buffer.from(
              JSON.stringify({ scope: 'stock-upload-login', exp: Date.now() + 1800000 })
            ).toString('base64url') + '.fixture';
        if (url.includes('/admin/kendras')) {
          if (route.request().method() === 'PUT') {
            profile = { ...profile, ...route.request().postDataJSON(), editVersion: 'v2' };
            saves++;
            data.message = 'Kendra profile updated.';
          } else data = { ...data, profiles: [profile], total: 1 };
        }
        if (url.includes('/admin/demands')) data.demands = [];
        await route.fulfill({ json: data });
      });
      await page.goto('http://localhost:' + server.address().port + '/admin-orders.html');
      await page.locator('[name=username]').fill('test');
      await page.locator('[name=password]').fill('test');
      await page.locator('#login-button').click();
      await page.locator('[data-admin-view=kendras]').click();
      await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
      const dialog = page.locator('#admin-profile-dialog');
      await dialog.waitFor({ state: 'visible' });
      assert.equal(await dialog.locator('[name=storeCode]').evaluate((e) => e.readOnly), false);
      await dialog.locator('[name=address]').fill('Updated test address');
      await page.locator('#profile-editor-save').click();
      await page.locator('#admin-profile-message').filter({ hasText: 'updated' }).waitFor();
      assert.equal(saves, 1);
      await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
      assert.equal(await dialog.locator('[name=address]').inputValue(), 'Updated test address');
      assert(await dialog.evaluate((e) => e.getBoundingClientRect().width <= innerWidth));
      await page.locator('#profile-editor-cancel').click();
      assert.equal(saves, 1);
      await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
      await page.evaluate(() => dispatchEvent(new Event('blur')));
      assert(await dialog.isVisible());
      await page.locator('#profile-editor-cancel').click();
      await page.reload();
      await page.locator('#panel').waitFor({ state: 'visible' });
      await page.locator('#logout').click();
      await page.reload();
      await page.locator('#login-card').waitFor({ state: 'visible' });
      await page.close();
    }
    console.log(
      'Desktop/mobile profile edit, save, cancel, persistent login and manual logout passed.'
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
