const { chromium } = require('@playwright/test'),
  express = require('express'),
  assert = require('assert'),
  fs = require('fs'),
  path = require('path');
const { render } = require('../js/operations-view');
const data = {
  emailPending: [
    { storeCode: '16749', id: 'e8047975-23b1-4560-8b4e-d74311b8d94e', delivered: 0 },
    { storeCode: '22721', id: 'ac06f564-8fee-46d9-9425-302a151c05e5', delivered: 0 },
    { storeCode: 'PMBJK14228', id: '9fa85f25-cf5a-4fdb-9f5f-2f14be539d03', delivered: 0 },
    { storeCode: '14228', id: '8bac1870-3445-47f0-a27d-198643bee189', delivered: 0 },
  ],
  duplicates: [],
  duplicateScope: 'Last 24 hours, up to 2000 recent orders. Cancelled orders excluded.',
  issues: [{ created_at: '2026-11-15T06:17:15Z', route: '/api/admin/backups', status: 503 }],
  backups: [
    {
      id: 'fixture',
      created_at: '2026-11-15T06:17:14Z',
      verified_at: '2026-11-15T06:22:42Z',
      counts: {
        submissions: 6,
        dockets: 2700,
        stock_snapshot: 1,
        stock_requests: 17,
        stock_allocations: 12,
        order_management: 9,
        order_events: 9,
        order_event_details: 0,
      },
    },
  ],
};
assert(
  !render({
    ...data,
    issues: [{ route: '<script>alert(1)</script>', created_at: 'invalid', status: 503 }],
  }).includes('<script>')
);
(async () => {
  const app = express();
  app.use(express.static(process.cwd()));
  const server = app.listen(0),
    base = 'http://localhost:' + server.address().port,
    browser = await chromium.launch({ channel: 'chrome', headless: true }),
    dir = path.resolve('..', 'maintenance', 'qa');
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } }),
        p = await context.newPage(),
        errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(base + '/admin-orders.html');
      await p.evaluate((markup) => {
        document.getElementById('login-card').hidden = true;
        document.getElementById('panel').hidden = false;
        for (const section of document.querySelectorAll('[id^=admin-view-]'))
          section.hidden = section.id !== 'admin-view-operations';
        document.getElementById('operations-content').innerHTML = markup;
      }, render(data));
      assert.equal(await p.locator('.ops-stat').count(), 4);
      assert.equal(await p.locator('[data-backup-download]').count(), 1);
      assert(await p.getByText('No possible duplicates found', { exact: true }).isVisible());
      await p.locator('#admin-view-operations').scrollIntoViewIfNeeded();
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await p.screenshot({
        path: path.join(dir, 'operations-redesign-' + width + '.png'),
        fullPage: true,
      });
      await p.getByText('Included records', { exact: true }).click();
      assert(await p.getByText('Stock reservations', { exact: true }).isVisible());
      assert.equal(errors.length, 0);
      await context.close();
    }
    console.log(
      'Operations desktop/mobile layout, backup controls, expandable counts and escaped content passed. No live requests modified.'
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
