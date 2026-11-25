const assert = require('node:assert/strict');
const db = require('../api/db');
const app = require('../api/index');
db.getDocketsByStore = async () => [
  { courier: 'OLS LOGISTICS', tracking: '', docketNo: '' },
  { courier: 'DELHIVERY&#x20;', tracking: '', docketNo: '323110182' },
  { courier: 'DTDC', tracking: '', docketNo: 'ABC' },
  { courier: 'Unknown', tracking: '', docketNo: 'ABC' },
];
(async () => {
  const server = app.listen(0);
  try {
    const r = await fetch('http://127.0.0.1:' + server.address().port + '/api/docket?store=123');
    const body = await r.json();
    assert.deepEqual(
      body.dockets.map((d) => d.trackUrl),
      [
        'https://www.olslogistics.in/tracking',
        'https://www.delhivery.com/tracking',
        'https://www.dtdc.com/track-your-shipment/',
        '',
      ]
    );
    console.log('Courier URL mapping and missing tracking number passed.');
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
