const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const aliases = {
  code: ['drugcode', 'productcode', 'itemcode', 'code'],
  name: ['drugname', 'medicinename', 'productname', 'itemname', 'medicine', 'name'],
  uom: ['uomname', 'uom', 'unit', 'pack', 'packsize'],
  batch: ['batchno', 'batchnumber', 'batch'],
  expiry: ['expdate', 'expirydate', 'expiry', 'exp'],
  available: [
    'qtyavailable',
    'quantityavailable',
    'availablequantity',
    'stockqty',
    'quantity',
    'qty',
    'stock',
  ],
  mrp: ['mrp', 'price', 'unitprice'],
  salesRate: ['salesrate', 'salerate', 'sellingrate', 'sellingprice'],
  group: ['druggroup', 'group'],
  category: ['drugcategory', 'category'],
};
function text(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object') {
    if ('result' in v) return text(v.result);
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return String(v.text);
  }
  return String(v ?? '').trim();
}
function key(v) {
  return text(v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
function number(v) {
  const n = Number(text(v).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
async function parseStock(buffer, name) {
  const book = new ExcelJS.Workbook();
  let sheet;
  if (/\.csv$/i.test(name)) sheet = await book.csv.read(Readable.from(buffer), { map: (v) => v });
  else if (/\.xlsx$/i.test(name)) {
    await book.xlsx.load(buffer);
    sheet = book.worksheets[0];
  } else throw new Error('Choose an Excel .xlsx or CSV file.');
  if (!sheet) throw new Error('The file has no worksheet.');
  let columns,
    header = 0;
  for (let i = 1; i <= Math.min(20, sheet.rowCount); i++) {
    const found = {};
    sheet.getRow(i).eachCell((cell, col) => {
      const k = key(cell.value);
      for (const [field, names] of Object.entries(aliases))
        if (names.includes(k)) found[field] = col;
    });
    if (found.code && found.name && found.available) {
      columns = found;
      header = i;
      break;
    }
  }
  if (!columns)
    throw new Error(
      'Required columns: Drug Code, Drug Name and Qty Available. Download the template for the full format.'
    );
  const items = [];
  let bad = 0;
  for (let i = header + 1; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    if (!row.hasValues) continue;
    const read = (f) => (columns[f] ? text(row.getCell(columns[f]).value) : '');
    const code = read('code'),
      name = read('name'),
      available = number(read('available')),
      price = read('mrp'),
      mrp = price ? number(price) : null,
      sales = read('salesRate'),
      salesRate = sales ? number(sales) : null;
    if (!code && !name && !read('available')) continue;
    if (
      !code ||
      !name ||
      !Number.isFinite(available) ||
      (price && !Number.isFinite(mrp)) ||
      (sales && !Number.isFinite(salesRate))
    ) {
      bad++;
      continue;
    }
    const item = {
      id: String(items.length),
      code,
      name,
      strength: '',
      uom: read('uom'),
      batch: read('batch'),
      expiry: read('expiry'),
      available,
      mrp,
      salesRate,
      group: read('group'),
      category: read('category'),
    };
    if (Object.values(item).some((v) => typeof v === 'string' && v.length > 500))
      throw new Error(`Row ${i} contains a value longer than 500 characters.`);
    items.push(item);
  }
  if (bad)
    throw new Error(
      `${bad} row(s) have missing drug codes/names or invalid QTY, Sales Rate or MRP. Correct these rows and upload again. No stock was changed.`
    );
  if (!items.length) throw new Error('No valid stock rows found. No stock was changed.');

  return items;
}
module.exports = { parseStock };
