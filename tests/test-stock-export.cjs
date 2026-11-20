const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { workbook } = require('../js/stock-export');

(async () => {
  const book = workbook(
    ExcelJS,
    [
      {
        id: 'first',
        code: '001',
        name: '=Literal medicine',
        uom: "10's",
        available: 12,
        mrpValues: [9.38],
      },
      { id: 'empty', code: '002', available: 0 },
    ],
    { first: 5 },
    '2026-11-14T10:00:00Z'
  );
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(await book.xlsx.writeBuffer());
  const sheet = read.worksheets[0];
  assert.equal(sheet.getCell('F2').master.address, 'A1');
  assert(sheet.getCell('A4').value.includes('14 NOVEMBER 2026'));
  assert(sheet.getCell('A5').value.includes('9411388344'));
  assert.deepEqual(sheet.getRow(6).values.slice(1), [
    'DC',
    'Drug Name',
    'UOM',
    'QTY',
    'MRP',
    'Order QTY',
  ]);
  assert.equal(sheet.getCell('A7').value, '001');
  assert.equal(sheet.getCell('B7').value, '=Literal medicine');
  assert.equal(sheet.getCell('D7').value, 12);
  assert.equal(sheet.getCell('E7').value, 9.38);
  assert.equal(sheet.getCell('F7').value, 5);
  assert.equal(sheet.rowCount, 7);
  assert(sheet.getTable('StockTable').table.style.showRowStripes);
  console.log('Excel banner, table, values and zero-stock exclusion passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
