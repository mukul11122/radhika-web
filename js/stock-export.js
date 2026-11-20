(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockExport = factory();
})(typeof window === 'undefined' ? this : window, function () {
  function workbook(ExcelJS, records, quantities = {}, stockDate = new Date()) {
    const book = new ExcelJS.Workbook();
    book.creator = 'Radhika Agencies';
    const sheet = book.addWorksheet('Stock', { views: [{ state: 'frozen', ySplit: 6 }] });
    sheet.columns = [
      { header: 'DC', width: 12 },
      { header: 'Drug Name', width: 65 },
      { header: 'UOM', width: 24 },
      { header: 'QTY', width: 14 },
      { header: 'MRP', width: 18 },
      { header: 'Order QTY', width: 16 },
    ];
    const tableRows = [];
    for (const r of records) {
      if (r.available <= 0) continue;
      const prices = r.mrpValues || [r.mrp];
      const mrp =
        prices.length === 1
          ? (prices[0] ?? null)
          : prices.map((p) => (p == null ? 'Unavailable' : p)).join(' / ');
      tableRows.push([
        String(r.code),
        String(r.name || ''),
        String(r.uom || ''),
        r.available,
        mrp,
        quantities[r.id] > 0 ? quantities[r.id] : null,
      ]);
    }
    sheet.getRow(1).values = [];
    sheet.mergeCells('A1:F2');
    sheet.mergeCells('A3:F3');
    sheet.mergeCells('A4:F4');
    sheet.mergeCells('A5:F5');
    sheet.addTable({
      name: 'StockTable',
      ref: 'A6',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true, showColumnStripes: false },
      columns: ['DC', 'Drug Name', 'UOM', 'QTY', 'MRP', 'Order QTY'].map((name) => ({
        name,
        filterButton: true,
      })),
      rows: tableRows,
    });
    sheet.getRow(6).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });
    sheet.getRow(6).height = 25;
    sheet.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };
    sheet.getColumn(5).numFmt = '0.00';
    sheet.getColumn(4).numFmt = '0';
    sheet.getColumn(6).numFmt = '0';
    function banner(cell, value, bg, fg, size, bold = true, italic = false) {
      const c = sheet.getCell(cell);
      c.value = value;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.font = { name: 'Calibri', size, bold, italic, color: { argb: fg } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
    const date = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
      .format(new Date(stockDate))
      .toUpperCase();
    banner('A1', '✦  RADHIKA AGENCIES  ✦', 'FF17212B', 'FFFFD43B', 28);
    banner(
      'A3',
      '93, Tagore Villa, Opp Sada Shiv Mandir, Chakrata Road, Dehradun  |  GST: 05AAWFR4857N1Z7',
      'FF1C3B5B',
      'FFBDDBF5',
      14,
      false,
      true
    );
    banner('A4', '▣  STOCK LIST — ' + date, 'FF145B36', 'FFFFFFFF', 16);
    banner(
      'A5',
      '☎  Order: 7906333973 · 9410513629 · 7037244958 · 7579484533 · 9456113503 · 9411388344',
      'FFD8F2E4',
      'FF075D43',
      13
    );
    sheet.getRow(1).height = 27;
    sheet.getRow(2).height = 27;
    sheet.getRow(3).height = 27;
    sheet.getRow(4).height = 32;
    sheet.getRow(5).height = 27;
    return book;
  }
  return { workbook };
});
