(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrderExcel = factory();
})(typeof window === 'undefined' ? this : window, function () {
  function workbook(ExcelJS, order) {
    const book = new ExcelJS.Workbook();
    book.creator = 'Radhika Agencies';
    const sheet = book.addWorksheet('Order', { views: [{ state: 'frozen', ySplit: 11 }] });
    sheet.columns = [{ width: 24 }, { width: 55 }];
    sheet.mergeCells('A1:B2');
    const title = sheet.getCell('A1');
    title.value = 'RADHIKA AGENCIES — ORDER';
    title.font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2355CB' } };
    title.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 24;
    sheet.getRow(2).height = 24;
    const metadata = [
      ['Store Code', String(order.storeCode || '')],
      ['Mobile No.', String(order.mobile || '')],
      ['Order reference', String(order.id)],
      ['Status', String(order.status)],
      [
        'Order date',
        new Date(order.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      ],
      ['Courier', String(order.courier || '')],
      ['Docket number', String(order.docket || '')],
    ];
    metadata.forEach((row, i) => {
      sheet.getRow(i + 3).values = row;
      sheet.getCell(i + 3, 1).font = { bold: true };
    });
    sheet.addTable({
      name: 'OrderItems',
      ref: 'A11',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: [
        { name: 'DC', filterButton: true },
        { name: 'Order QTY', filterButton: true },
      ],
      rows: order.items.map((item) => [String(item.code), Number(item.quantity)]),
    });
    sheet.getColumn(2).alignment = { vertical: 'middle', wrapText: true };
    if (order.contactProfile) {
      const details = book.addWorksheet('Kendra delivery');
      details.columns = [{ width: 24 }, { width: 90 }];
      const profile = order.contactProfile;
      for (const [label, key] of [
        ['Store Code', 'storeCode'],
        ['Contact person', 'contactName'],
        ['Mobile', 'mobile'],
        ['Delivery address', 'address'],
        ['City', 'city'],
        ['State', 'state'],
        ['PIN code', 'pincode'],
        ['GSTIN', 'gst'],
        ['Email', 'email'],
        ['DL Form 20', 'dlForm20'],
        ['DL Form 21', 'dlForm21'],
      ])
        details.addRow([label, String(profile[key] || '')]);
      details.getColumn(2).alignment = { wrapText: true };
    }
    return book;
  }
  function unavailableWorkbook(ExcelJS, order) {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Not Available', { views: [{ state: 'frozen', ySplit: 6 }] });
    sheet.columns = [{ width: 22 }, { width: 22 }, { width: 22 }, { width: 25 }];
    sheet.addRow(['RADHIKA AGENCIES - NOT AVAILABLE']);
    sheet.addRow(['Store Code', String(order.storeCode || '')]);
    sheet.addRow(['Mobile', String(order.mobile || '')]);
    sheet.addRow(['Order reference', String(order.id)]);
    sheet.addRow([
      'Order date',
      new Date(order.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    ]);
    sheet.addRow(['DC', 'Requested QTY', 'Available QTY', 'Not Available QTY']);
    for (const item of order.unavailableItems || [])
      sheet.addRow([
        String(item.code),
        item.requestedQuantity,
        item.availableQuantity,
        item.quantity,
      ]);
    sheet.getRow(1).font = { bold: true, size: 16 };
    sheet.getRow(6).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2355CB' } };
    sheet.eachRow((row) => {
      row.height = 26;
      row.alignment = { vertical: 'middle', wrapText: true };
    });
    sheet.autoFilter = 'A6:D6';
    return book;
  }
  return { workbook, unavailableWorkbook };
});
