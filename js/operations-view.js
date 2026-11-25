(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OperationsView = factory();
})(typeof window === 'undefined' ? this : window, function () {
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const paths = {
    mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
    copy: 'M8 3h12v14H8z M4 7v14h12',
    alert: 'M12 3 2 21h20L12 3z M12 9v5 M12 17v1',
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3z M8 12l3 3 5-6',
    download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
    check: 'M5 12l4 4L19 6',
    clock: 'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  };
  function icon(name) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
      paths[name] +
      '"/></svg>'
    );
  }
  function date(value, time = false) {
    const d = new Date(value);
    if (!value || !Number.isFinite(d.getTime())) return '—';
    return new Intl.DateTimeFormat(
      'en-IN',
      time
        ? { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }
        : { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }
    ).format(d);
  }
  function table(headers, rows, kind) {
    return (
      '<div class="insight-table ops-table ' +
      kind +
      '"><table><thead><tr>' +
      headers.map((h) => '<th scope="col">' + esc(h) + '</th>').join('') +
      '</tr></thead><tbody>' +
      rows
        .map((row) => '<tr>' + row.map((value) => '<td>' + value + '</td>').join('') + '</tr>')
        .join('') +
      '</tbody></table></div>'
    );
  }
  function panel(title, subtitle, count, body, className = '') {
    return (
      '<section class="ops-panel ' +
      className +
      '"><header class="ops-panel-heading"><div><h3>' +
      esc(title) +
      '</h3><p>' +
      esc(subtitle) +
      '</p></div><span class="ops-count">' +
      esc(count) +
      '</span></header>' +
      body +
      '</section>'
    );
  }
  function empty(title, detail) {
    return (
      '<div class="ops-empty"><span>' +
      icon('check') +
      '</span><div><strong>' +
      esc(title) +
      '</strong><p>' +
      esc(detail) +
      '</p></div></div>'
    );
  }
  function render(data) {
    const emails = data.emailPending || [],
      duplicates = data.duplicates || [],
      issues = data.issues || [],
      backups = data.backups || [],
      latest = backups[0];
    const stats = [
      [
        'mail',
        'Pending email delivery',
        emails.length,
        emails.length ? 'Needs attention' : 'Up to date',
        'amber',
      ],
      [
        'copy',
        'Possible duplicates',
        duplicates.length,
        'Last 24 hours',
        duplicates.length ? 'amber' : 'green',
      ],
      [
        'alert',
        'Recorded failures',
        issues.length,
        'Recent request history',
        issues.length ? 'red' : 'green',
      ],
      [
        'shield',
        'Latest backup',
        latest ? (latest.verified_at ? 'Verified' : 'Not verified') : 'No backup',
        latest ? date(latest.created_at) : 'Create your first backup',
        latest?.verified_at ? 'green' : 'blue',
      ],
    ];
    const summary =
      '<div class="ops-overview">' +
      stats
        .map(
          ([glyph, label, value, detail, tone]) =>
            '<article class="ops-stat ops-tone-' +
            tone +
            '"><span class="ops-stat-icon">' +
            icon(glyph) +
            '</span><span class="ops-stat-label">' +
            esc(label) +
            '</span><strong>' +
            esc(value) +
            '</strong><small>' +
            esc(detail) +
            '</small></article>'
        )
        .join('') +
      '</div>';
    const emailBody = emails.length
      ? '<div class="ops-email-list">' +
        emails
          .map(
            (row) =>
              '<article class="ops-email-card"><header><strong>Store ' +
              esc(row.storeCode || 'Unknown') +
              '</strong><span class="ops-pill ops-pill-amber">' +
              esc(row.delivered) +
              '/3 sent</span></header><div class="ops-email-reference"><span>Order reference</span><code>' +
              esc(row.id) +
              '</code></div><div class="ops-email-attempt"><span>Last attempt</span><p>' +
              esc(
                row.last_attempt
                  ? date(row.last_attempt) + ' · ' + date(row.last_attempt, true) + ' IST'
                  : 'Previous attempt details unavailable'
              ) +
              '</p></div><div class="ops-email-error"><span>Delivery details</span><p>' +
              esc(
                row.error_text ||
                  (row.last_attempt
                    ? 'Email delivery is pending.'
                    : 'No error was saved for this older order. Retry to record the current result.')
              ) +
              '</p></div><footer><small>Only pending recipients will be retried.</small><button type="button" data-email-retry="' +
              esc(row.id) +
              '">Retry pending email</button></footer></article>'
          )
          .join('') +
        '</div>'
      : empty('All email deliveries complete', 'No pending email delivery was found.');
    const duplicateBody =
      (duplicates.length
        ? table(
            ['Store', 'Orders', 'References'],
            duplicates.map((group) => [
              esc(group[0]?.storeCode),
              '<span class="ops-pill ops-pill-amber">' + group.length + '</span>',
              group.map((row) => '<code>' + esc(row.id) + '</code>').join('<br>'),
            ]),
            'ops-duplicate-table'
          )
        : empty(
            'No possible duplicates found',
            'No repeated medicine lists were found in the checked orders.'
          )) +
      '<p class="ops-scope">' +
      esc(data.duplicateScope || 'Last 24 hours.') +
      ' Alerts do not cancel orders.</p>';
    const issueIds = issues.map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
    const issueBody = issues.length
      ? (issueIds.length ? '<div class="ops-issue-actions"><button type="button" data-clear-failures="' + Math.max(...issueIds) + '">Clear failures</button></div>' : '') + table(
          ['When', 'Page / action', 'Status'],
          issues.map((row) => [
            '<span>' +
              esc(date(row.created_at)) +
              '</span><small class="ops-cell-time">' +
              esc(date(row.created_at, true)) +
              ' IST</small>',
            '<code>' + esc(row.route) + '</code>',
            '<span class="ops-pill ' +
              (Number(row.status) >= 500 ? 'ops-pill-red' : 'ops-pill-amber') +
              '">HTTP ' +
              esc(row.status) +
              '</span>',
          ]),
          'ops-issue-table'
        )
      : empty(
          'No request failures recorded',
          'Recorded failures will appear here when an action needs attention.'
        );
    const labels = {
      submissions: 'Enquiries',
      dockets: 'Dockets',
      stock_snapshot: 'Stock snapshots',
      stock_requests: 'Orders',
      stock_allocations: 'Stock reservations',
      order_management: 'Order status records',
      order_events: 'Order history',
      order_event_details: 'Audit details',
      kendra_profiles: 'Kendra profiles',
      medicine_demands: 'Medicine demands',
      demand_events: 'Demand history',
    };
    const backupBody = backups.length
      ? '<div class="ops-backup-list">' +
        backups
          .map((row) => {
            const counts = row.counts || {};
            return (
              '<article class="ops-backup-card"><div class="ops-backup-heading"><span class="ops-backup-icon">' +
              icon('shield') +
              '</span><div><strong>' +
              esc(date(row.created_at)) +
              '</strong><small>' +
              esc(date(row.created_at, true)) +
              ' IST</small></div></div><span class="ops-pill ' +
              (row.verified_at ? 'ops-pill-green' : 'ops-pill-amber') +
              '">' +
              (row.verified_at ? icon('check') + 'Restore verified' : 'Verification pending') +
              '</span><div class="ops-backup-totals"><span><strong>' +
              Number(counts.stock_requests || 0).toLocaleString('en-IN') +
              '</strong> orders</span><span><strong>' +
              Number(counts.dockets || 0).toLocaleString('en-IN') +
              '</strong> dockets</span></div><details class="ops-included"><summary>Included records</summary><dl>' +
              Object.entries(counts)
                .map(
                  ([key, value]) =>
                    '<div><dt>' + esc(labels[key] || key) + '</dt><dd>' + esc(value) + '</dd></div>'
                )
                .join('') +
              '</dl></details><p class="ops-verified-time">' +
              icon('clock') +
              (row.verified_at
                ? 'Checked ' + esc(date(row.verified_at)) + ' · ' + esc(date(row.verified_at, true))
                : 'No restore test recorded') +
              '</p><div class="ops-backup-actions"><button type="button" class="ops-download" data-backup-download="' +
              esc(row.id) +
              '">' +
              icon('download') +
              'Download backup</button><button type="button" data-backup-verify="' +
              esc(row.id) +
              '">Verify restore</button></div></article>'
            );
          })
          .join('') +
        '</div>'
      : empty('No backup saved yet', 'Use Create / verify backup to save your first copy.');
    return (
      summary +
      '<div class="ops-layout"><div class="ops-main">' +
      panel(
        'Pending email delivery',
        'Orders waiting for all recipients to receive the email.',
        emails.length,
        emailBody
      ) +
      panel(
        'Possible duplicate orders',
        'Review repeated requests before processing.',
        duplicates.length,
        duplicateBody
      ) +
      panel(
        'Recent request failures',
        'Previously recorded errors; check the time and action.',
        issues.length,
        issueBody
      ) +
      '</div>' +
      panel(
        'Backups',
        'Recent saved copies and restore checks.',
        backups.length,
        backupBody +
          '<div class="ops-storage-note">' +
          icon('clock') +
          '<div><strong>Daily backup · 5:30 am IST</strong><p>Copies are stored in this database. Keep a downloaded copy separately.</p><small>Restore verification does not replace live data.</small></div></div>',
        'ops-backups-panel'
      ) +
      '</div>'
    );
  }
  function loading() {
    return '<div class="ops-loading" role="status"><span class="medicine-spinner" aria-hidden="true"></span><strong>Loading operations…</strong><p>Checking delivery, alerts and backup status.</p></div>';
  }
  return { render, loading };
});
