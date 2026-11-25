(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DashboardExcel = factory();
})(typeof window === 'undefined' ? this : window, function () {
  function workbook(ExcelJS, data) {
    const book = new ExcelJS.Workbook();
    book.creator = 'Radhika Agencies';
    const summary = book.addWorksheet('Dashboard');
    summary.columns = [{ width: 32 }, { width: 85 }];
    summary.mergeCells('A1:B2');
    summary.getCell('A1').value = 'RADHIKA AGENCIES — DASHBOARD';
    summary.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
    summary.getCell('A1').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2355CB' },
    };
    summary.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    const rows = [
      ['Dashboard date (IST)', data.today],
      ['Today’s orders', data.todayOrders],
      ['Pending dispatch', data.pendingDispatch],
      ['Estimated order value · All time (INR)', data.estimatedValue],
      ['Estimated value · Today (INR)', data.estimatedValues?.today || 0],
      ['Estimated value · This week (INR)', data.estimatedValues?.weekly || 0],
      ['Estimated value · This month (INR)', data.estimatedValues?.monthly || 0],
      ['Estimated value · This year (INR)', data.estimatedValues?.yearly || 0],
      ['Week starts (Monday, IST)', data.periodStarts?.weekly || ''],
      ['Unpriced orders excluded', data.unpricedOrders],
      ['Older orders using current rates', data.legacyEstimates],
      [
        'Value basis',
        'Non-cancelled orders. Saved Sales Rates where available; older orders use current rates.',
      ],
    ];
    rows.forEach((row, i) => {
      summary.getRow(i + 4).values = row;
      summary.getCell(i + 4, 1).font = { bold: true };
    });
    for (let row = 7; row <= 11; row++) summary.getCell('B' + row).numFmt = '#,##0.00';
    summary.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };
    summary.getRow(rows.length + 3).height = 40;
    const top = book.addWorksheet('Most-ordered medicines', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    top.columns = [{ width: 14 }, { width: 80 }, { width: 18 }, { width: 14 }];
    top.addTable({
      name: 'TopMedicines',
      ref: 'A1',
      headerRow: true,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: ['DC', 'Medicine', 'Ordered QTY', 'Orders'].map((name) => ({
        name,
        filterButton: true,
      })),
      rows: data.topMedicines.map((r) => [
        String(r.code),
        String(r.name),
        Number(r.quantity),
        Number(r.orders),
      ]),
    });
    top.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };
    const counts = book.addWorksheet('Order status counts', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const statuses = [
      'New',
      'Accepted',
      'Challan Ready',
      'Under Packing',
      'Packed',
      'Dispatched',
      'Delivered',
      'Cancelled',
    ];
    counts.columns = Array.from({ length: 10 }, () => ({ width: 19 }));
    counts.addTable({
      name: 'OrderStatusCounts',
      ref: 'A1',
      headerRow: true,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: ['Period', 'Total orders', ...statuses].map((name) => ({
        name,
        filterButton: true,
      })),
      rows: [
        ['today', 'Today'],
        ['weekly', 'This week'],
        ['monthly', 'This month'],
        ['yearly', 'This year'],
      ].map(([key, label]) => [
        label,
        data.orderCounts?.[key]?.total || 0,
        ...statuses.map((status) => data.orderCounts?.[key]?.[status] || 0),
      ]),
    });
    counts.getCell('A7').value =
      'Based on order placed date and current status. India time; Monday starts the week.';
    counts.mergeCells('A7:J7');
    counts.getCell('A7').alignment = { wrapText: true };
    return book;
  }
  return { workbook };
});
