const assert = require('node:assert/strict'),
  ExcelJS = require('exceljs');
const Import = require('../js/stock-order-import');
const { workbook } = require('../js/stock-export');
const { compare } = require('../js/stock-grouping');
(async () => {
  const records = [
    {
      id: 'later',
      code: '1',
      name: 'Medicine',
      uom: '10',
      available: 10,
      expiry: '31/05/2028',
      mrpValues: [4],
    },
    {
      id: 'early',
      code: '1',
      name: 'Medicine',
      uom: '10',
      available: 5,
      expiry: '31/01/2028',
      mrpValues: [4],
    },
  ];
  const shortage = Import.repeat(
    [
      { code: '1', quantity: 20 },
      { code: '99', quantity: 10 },
    ],
    records,
    compare
  );
  assert.deepEqual(shortage.unavailableItems, [
    { code: '1', quantity: 5, requestedQuantity: 20, availableQuantity: 15 },
    { code: '99', quantity: 10, requestedQuantity: 10, availableQuantity: 0 },
  ]);
  const validated = require('../lib/stock-order').unavailableItems(shortage.unavailableItems);
  assert.deepEqual(validated, shortage.unavailableItems);
  assert.throws(() =>
    require('../lib/stock-order').unavailableItems([{ code: '1', quantity: -2 }])
  );
  const missingBook = require('../js/order-excel').unavailableWorkbook(ExcelJS, {
    id: 'test-id',
    storeCode: '001',
    mobile: '9000000000',
    created_at: new Date().toISOString(),
    unavailableItems: validated,
  });
  const missingRead = new ExcelJS.Workbook();
  await missingRead.xlsx.load(await missingBook.xlsx.writeBuffer());
  assert.equal(missingRead.worksheets[0].getCell('D7').value, 5);
  assert.equal(missingRead.worksheets[0].getCell('A8').value, '99');
  const book = workbook(ExcelJS, records, { later: 7, early: 3 });
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(await book.xlsx.writeBuffer());
  const rows = [];
  read.worksheets[0].eachRow({ includeEmpty: true }, (r) => rows.push(r.values.slice(1)));
  const items = Import.parse(rows);
  assert.deepEqual(items, [{ code: '1', quantity: 10 }]);
  assert.deepEqual(Import.allocate(items, records, compare), { early: 5, later: 5 });
  assert.throws(() => Import.allocate([{ code: '1', quantity: 16 }], records, compare));
  assert.throws(() =>
    Import.parse([
      ['DC', 'QTY'],
      ['1', 10],
    ])
  );
  assert.throws(() =>
    Import.parse([
      ['DC', 'Order QTY'],
      ['1', -1],
    ])
  );
  assert.deepEqual(Import.parse(Import.csv('DC,Order QTY\r\n"1","5"\r\n')), [
    { code: '1', quantity: 5 },
  ]);
  console.log(
    'Downloaded Excel roundtrip, CSV, duplicate DC totals, earliest expiry allocation and invalid quantities passed.'
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
