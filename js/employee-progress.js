window.EmployeeProgress = (() => {
  const keys = ['challan', 'packing', 'invoice'];
  const labels = { challan: 'Challans', packing: 'Sent for packing', invoice: 'Final invoices' };
  let sequence = 0;
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const fmt = (n) => Number(n).toLocaleString('en-IN');
  const sum = (c) => keys.reduce((n, k) => n + (Number(c[k]) || 0), 0);
  function dates(from, to) {
    const list = [];
    const d = new Date(from + 'T00:00:00Z');
    while (d.toISOString().slice(0, 10) <= to) {
      list.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return list;
  }
  function shortDate(date) {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(date + 'T00:00:00Z'));
  }
  function legend() {
    return (
      '<div class="progress-legend">' +
      keys.map((k) => '<span><i class="progress-' + k + '"></i>' + labels[k] + '</span>').join('') +
      '</div>'
    );
  }
  function barRows(rows) {
    if (!rows.length)
      return '<div class="progress-empty">No reports submitted for this period.</div>';
    const max = Math.max(1, ...rows.map((r) => sum(r.counts)));
    return (
      '<div class="progress-rows">' +
      rows
        .map((r) => {
          const total = sum(r.counts);
          const description = keys.map((k) => labels[k] + ': ' + fmt(r.counts[k] || 0)).join(', ');
          return (
            '<div class="progress-row"><span class="progress-row-label" title="' +
            esc(r.label) +
            '">' +
            esc(r.label) +
            '</span><span class="progress-track" role="img" title="' +
            esc(r.hasReport ? description : 'No report submitted') +
            '" aria-label="' +
            esc(r.label + ': ' + (r.hasReport ? description : 'No report submitted')) +
            '">' +
            keys
              .map(
                (k) =>
                  '<i class="progress-' +
                  k +
                  '" style="width:' +
                  (((Number(r.counts[k]) || 0) / max) * 100).toFixed(3) +
                  '%"></i>'
              )
              .join('') +
            '</span><strong>' +
            (r.hasReport ? fmt(total) : '—') +
            '</strong></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  function card(title, period, body) {
    return (
      '<section class="progress-card"><div class="progress-card-head"><div><h3>' +
      esc(title) +
      '</h3><p>' +
      esc(period) +
      '</p></div></div>' +
      body +
      '</section>'
    );
  }
  function render(data) {
    const reports = Array.isArray(data.reports) ? data.reports : [],
      selected = data.date;
    const daily = reports
      .filter((r) => r.date === selected)
      .map((r) => ({
        label: r.name + ' (@' + r.username + ')',
        counts: r.counts || {},
        hasReport: true,
      }));
    function series(start) {
      return dates(start, selected).map((date) => {
        const items = reports.filter((r) => r.date === date),
          counts = { challan: 0, packing: 0, invoice: 0 };
        for (const item of items)
          for (const key of keys) counts[key] += Number(item.counts?.[key]) || 0;
        return { label: shortDate(date), counts, hasReport: items.length > 0 };
      });
    }
    const totals = { challan: 0, packing: 0, invoice: 0 };
    for (const item of daily) for (const key of keys) totals[key] += Number(item.counts[key]) || 0;
    const total = sum(totals),
      a = total ? (totals.challan / total) * 100 : 0,
      b = total ? ((totals.challan + totals.packing) / total) * 100 : 0;
    const pie = total
      ? '<div class="progress-pie-layout"><div class="progress-pie" role="img" aria-label="' +
        esc('Selected date: ' + keys.map((k) => labels[k] + ' ' + fmt(totals[k])).join(', ')) +
        '" style="background:conic-gradient(#315fd3 0% ' +
        a.toFixed(3) +
        '%,#e1a43b ' +
        a.toFixed(3) +
        '% ' +
        b.toFixed(3) +
        '%,#31a27b ' +
        b.toFixed(3) +
        '% 100%)"><span>' +
        fmt(total) +
        '<small>activities</small></span></div><div class="progress-pie-legend">' +
        keys
          .map(
            (k) =>
              '<div><span><i class="progress-' +
              k +
              '"></i>' +
              labels[k] +
              '</span><strong>' +
              fmt(totals[k]) +
              '</strong></div>'
          )
          .join('') +
        '</div></div>'
      : '<div class="progress-empty">No reported activity on this date.</div>';
    return (
      '<div class="progress-grid">' +
      card('Daily progress', shortDate(selected) + ' · by employee', legend() + barRows(daily)) +
      card('Work breakdown', shortDate(selected) + ' · share of reported activities', pie) +
      card(
        'Weekly progress',
        shortDate(data.weekStart) + ' – ' + shortDate(selected) + ' · Monday to selected date',
        legend() + barRows(series(data.weekStart))
      ) +
      card(
        'Monthly progress',
        shortDate(data.monthStart) + ' – ' + shortDate(selected) + ' · month to date',
        legend() + barRows(series(data.monthStart))
      ) +
      '</div><p class="progress-footnote">Bars show reported activity counts. A dash means no report was submitted for that day; it does not mean zero work.</p>'
    );
  }
  return {
    render,
    clear() {
      sequence++;
      document.getElementById('employee-progress').replaceChildren();
    },
    async load(request, date) {
      const seq = ++sequence,
        box = document.getElementById('employee-progress');
      box.textContent = 'Loading progress…';
      try {
        const d = await request('/api/admin/employee-progress?date=' + encodeURIComponent(date));
        if (seq !== sequence) return;
        box.innerHTML = render(d);
      } catch (e) {
        if (seq === sequence) box.textContent = e.message || 'Progress could not be loaded.';
      }
    },
  };
})();
